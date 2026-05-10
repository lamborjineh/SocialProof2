"""
tests/test_nli.py
Unit tests for pipeline/nli.py — NLIModule.

Covers:
  - classify() returns valid structure
  - classify() label is one of support/contradict/neutral
  - classify() confidence in [0, 1]
  - Low-confidence decisive labels are downgraded to neutral
  - classify_multi() returns valid structure with empty input
  - classify_multi() vote_breakdown keys are correct
  - classify_multi() evidence_count reflects filtered pieces
  - Token overlap gate filters truly unrelated evidence
  - Reranker gate filters very negative logit scores
  - Similarity gate filters below-threshold evidence
  - FEVER dev benchmark: support/contradict accuracy > 0.50
    (weak threshold — model may not be loaded in all CI envs)
"""
import sys
import os
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.nli import NLIModule, _token_overlap, _sigmoid


# ── Unit: helper functions ────────────────────────────────────────────────────

class TestHelpers:
    def test_token_overlap_identical(self):
        assert _token_overlap("vaccines prevent disease", "vaccines prevent disease") == 1.0

    def test_token_overlap_zero(self):
        assert _token_overlap("vaccines prevent disease", "weather is cloudy today") == 0.0

    def test_token_overlap_partial(self):
        score = _token_overlap("vaccines prevent disease outbreaks", "vaccines stop the outbreaks")
        assert 0.0 < score < 1.0

    def test_token_overlap_ignores_stopwords(self):
        # All stop words — no content words
        assert _token_overlap("the a an", "is are was") == 0.0

    def test_sigmoid_zero(self):
        assert abs(_sigmoid(0.0) - 0.5) < 1e-6

    def test_sigmoid_positive(self):
        assert _sigmoid(5.0) > 0.5

    def test_sigmoid_negative(self):
        assert _sigmoid(-5.0) < 0.5


# ── Unit: classify() with mocked model ───────────────────────────────────────

class TestClassify:
    def _mock_nli(self, label: str, score: float):
        mock = MagicMock(return_value={"label": label, "score": score})
        return patch("pipeline.nli.ModelRegistry.nli", return_value=mock)

    def test_classify_returns_dict_with_required_keys(self):
        with self._mock_nli("ENTAILMENT", 0.85):
            result = NLIModule.classify("vaccines prevent disease", "Vaccines are effective against disease.")
        assert "type" in result
        assert "nli_confidence" in result

    def test_classify_entailment_mapped_to_support(self):
        with self._mock_nli("ENTAILMENT", 0.85):
            result = NLIModule.classify("vaccines prevent disease", "Vaccines are effective.")
        assert result["type"] == "support"

    def test_classify_contradiction_mapped_to_contradict(self):
        with self._mock_nli("CONTRADICTION", 0.80):
            result = NLIModule.classify("vaccines prevent disease", "Vaccines have no effect.")
        assert result["type"] == "contradict"

    def test_classify_neutral_stays_neutral(self):
        with self._mock_nli("NEUTRAL", 0.60):
            result = NLIModule.classify("vaccines prevent disease", "The weather is sunny.")
        assert result["type"] == "neutral"

    def test_classify_low_confidence_decisive_downgraded(self):
        # Confidence below MIN_NLI_CONFIDENCE_FOR_DECISIVE → neutral
        with self._mock_nli("ENTAILMENT", 0.20):
            result = NLIModule.classify("vaccines prevent disease", "Vaccines are effective.")
        assert result["type"] == "neutral"

    def test_classify_confidence_in_range(self):
        with self._mock_nli("NEUTRAL", 0.65):
            result = NLIModule.classify("anything", "anything else")
        assert 0.0 <= result["nli_confidence"] <= 1.0

    def test_classify_model_failure_fallback(self):
        with patch("pipeline.nli.ModelRegistry.nli", side_effect=RuntimeError("model not loaded")):
            result = NLIModule.classify("claim", "evidence")
        assert result["type"] == "neutral"
        assert result["nli_confidence"] == 0.5


# ── Unit: classify_multi() ────────────────────────────────────────────────────

class TestClassifyMulti:
    def _evidence(self, text: str, sim: float, rerank: float = None) -> dict:
        ev = {"text": text, "similarity_score": sim}
        if rerank is not None:
            ev["rerank_score"] = rerank
        return ev

    def test_empty_evidence_returns_neutral(self):
        result = NLIModule.classify_multi("any claim", [])
        assert result["type"] == "neutral"
        assert result["evidence_count"] == 0
        assert result["vote_breakdown"] == {"support": 0.0, "contradict": 0.0, "neutral": 0.0}

    def test_result_has_required_keys(self):
        ev = [self._evidence("vaccines are effective", 0.8)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.85}):
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        for key in ("type", "nli_confidence", "vote_breakdown", "evidence_results", "evidence_count"):
            assert key in result

    def test_vote_breakdown_keys_correct(self):
        ev = [self._evidence("vaccines are effective", 0.8)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.85}):
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        assert set(result["vote_breakdown"].keys()) == {"support", "contradict", "neutral"}

    def test_winning_label_has_highest_weight(self):
        ev = [
            self._evidence("vaccines are effective against flu", 0.9),
            self._evidence("vaccines prevent multiple diseases", 0.85),
            self._evidence("vaccines cause side effects", 0.4),
        ]
        side_effects = ["support", "support", "contradict"]
        call_count = [0]

        def mock_classify(claim, evidence_text):
            label = side_effects[call_count[0] % len(side_effects)]
            call_count[0] += 1
            return {"type": label, "nli_confidence": 0.85}

        with patch.object(NLIModule, "classify", side_effect=mock_classify):
            result = NLIModule.classify_multi("vaccines prevent disease", ev)

        assert result["type"] == "support"

    def test_low_similarity_evidence_filtered(self):
        ev = [self._evidence("completely unrelated text about weather", 0.05)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.9}) as mock_c:
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        # Low sim should be filtered; classify should not be called
        assert result["evidence_count"] == 0

    def test_low_rerank_score_filtered(self):
        ev = [self._evidence("vaccines are effective", 0.8, rerank=-5.0)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.9}) as mock_c:
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        assert result["evidence_count"] == 0

    def test_zero_overlap_low_sim_filtered(self):
        """Topic coherence gate: zero content-word overlap + sim < 0.70 → filtered."""
        ev = [self._evidence("The cat sat on the mat.", 0.55)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.9}):
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        assert result["evidence_count"] == 0

    def test_nli_confidence_is_normalised_vote_share(self):
        ev = [self._evidence("vaccines are effective against disease", 0.9)]
        with patch.object(NLIModule, "classify", return_value={"type": "support", "nli_confidence": 0.85}):
            result = NLIModule.classify_multi("vaccines prevent disease", ev)
        assert 0.0 <= result["nli_confidence"] <= 1.0

    def test_processes_at_most_5_evidence_pieces(self):
        ev = [self._evidence(f"vaccines evidence piece {i}", 0.9) for i in range(10)]
        call_count = [0]

        def mock_classify(claim, evidence_text):
            call_count[0] += 1
            return {"type": "support", "nli_confidence": 0.8}

        with patch.object(NLIModule, "classify", side_effect=mock_classify):
            NLIModule.classify_multi("vaccines prevent disease", ev)

        assert call_count[0] <= 5


# ── FEVER benchmark (skipped if file absent) ──────────────────────────────────

class TestFeverBenchmark:
    """
    Light FEVER dev benchmark.
    Maps FEVER labels: SUPPORTS→support, REFUTES→contradict, NOT ENOUGH INFO→neutral.
    Tests that the model's accuracy on decisive labels (SUPPORTS/REFUTES) is above 0.50.
    Only runs when data/fever_dev.jsonl exists AND the NLI model can be loaded.
    """

    LABEL_MAP = {
        "SUPPORTS":          "support",
        "REFUTES":           "contradict",
        "NOT ENOUGH INFO":   "neutral",
    }

    def test_fever_decisive_accuracy(self, fever_samples):
        try:
            from core.model_registry import ModelRegistry
            ModelRegistry.nli()  # will raise if model not loaded
        except Exception:
            pytest.skip("NLI model not available in this environment")

        decisive = [
            s for s in fever_samples
            if s.get("label") in ("SUPPORTS", "REFUTES")
            and s.get("evidence")
        ]

        if not decisive:
            pytest.skip("No decisive FEVER samples with evidence found")

        correct = 0
        total = 0

        for sample in decisive[:50]:  # cap at 50 to keep CI fast
            claim = sample["claim"]
            # Flatten evidence sentences
            evidence_texts = []
            for ev_group in sample["evidence"]:
                for ev_piece in ev_group:
                    if len(ev_piece) >= 3 and ev_piece[2]:
                        evidence_texts.append(str(ev_piece[2]))

            if not evidence_texts:
                continue

            # Use first evidence piece for single-pair test
            result = NLIModule.classify(claim, evidence_texts[0])
            expected = self.LABEL_MAP[sample["label"]]

            if result["type"] == expected:
                correct += 1
            total += 1

        if total == 0:
            pytest.skip("No valid FEVER pairs could be evaluated")

        accuracy = correct / total
        assert accuracy >= 0.50, (
            f"FEVER decisive accuracy {accuracy:.2%} is below 0.50 "
            f"({correct}/{total} correct)"
        )
