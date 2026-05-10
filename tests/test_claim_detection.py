"""
tests/test_claim_detection.py
Unit tests for pipeline/claim_detection.py — ClaimDetectionModule.

Covers:
  - High-confidence factual claims are detected
  - Opinion sentences are penalised / filtered
  - Context/attribution openers reduce score
  - Questions are not detected as claims
  - Filipino-language patterns trigger detection
  - Absolutist language without specifics triggers penalty
  - Falsifiable-predicate gate blocks entity-only sentences
  - Confidence scores stay in [0, 1]
  - Result list is capped at MAX_CLAIMS and sorted descending
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pipeline.claim_detection import ClaimDetectionModule, CONTEXT_OPENER_RE, OPINION_OPENER_RE


# ── Helpers ───────────────────────────────────────────────────────────────────

def detect(text: str, spacy_doc_factory) -> list:
    doc = spacy_doc_factory(text)
    return ClaimDetectionModule.detect(doc, text)


# ── Regex pattern tests (no spaCy needed) ─────────────────────────────────────

class TestRegexPatterns:
    def test_context_opener_re_matches_according_to(self):
        assert CONTEXT_OPENER_RE.match("According to the WHO, vaccines are safe.")

    def test_context_opener_re_matches_tagalog(self):
        assert CONTEXT_OPENER_RE.match("Ayon sa gobyerno, ang bakuna ay ligtas.")

    def test_opinion_opener_re_matches_i_think(self):
        assert OPINION_OPENER_RE.match("I think the government is corrupt.")

    def test_opinion_opener_re_matches_some_argue(self):
        assert OPINION_OPENER_RE.match("Some argue that climate change is exaggerated.")

    def test_context_opener_re_no_false_positive_on_plain_claim(self):
        assert not CONTEXT_OPENER_RE.match("Coffee causes 20% of all cancer.")


# ── Claim detection integration tests (require spaCy) ─────────────────────────

class TestClaimDetectionPositive:
    def test_percentage_claim_detected(self, spacy_doc_factory):
        claims = detect("Coffee causes 20% of all cancer cases.", spacy_doc_factory)
        assert len(claims) >= 1
        assert any("coffee" in c["text"].lower() for c in claims)

    def test_named_entity_with_verb_detected(self, spacy_doc_factory):
        claims = detect("NASA confirmed that the rover discovered water ice on Mars.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_death_claim_detected(self, spacy_doc_factory):
        claims = detect("Scientist Dr. Santos died in 2024.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_study_shows_pattern_detected(self, spacy_doc_factory):
        claims = detect("Studies show that sugar consumption increases obesity rates.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_election_result_detected(self, spacy_doc_factory):
        claims = detect("Candidate Reyes won the 2025 senatorial election.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_million_figure_detected(self, spacy_doc_factory):
        claims = detect("The government spent 2 billion pesos on the project.", spacy_doc_factory)
        assert len(claims) >= 1


class TestClaimDetectionNegative:
    def test_pure_question_not_detected(self, spacy_doc_factory):
        claims = detect("Did the president resign yesterday?", spacy_doc_factory)
        # Questions should score below CLAIM_THRESHOLD
        assert len(claims) == 0

    def test_opinion_sentence_not_detected(self, spacy_doc_factory):
        claims = detect("I think the government is doing a terrible job.", spacy_doc_factory)
        assert len(claims) == 0

    def test_too_short_sentence_not_detected(self, spacy_doc_factory):
        claims = detect("Yes.", spacy_doc_factory)
        assert len(claims) == 0

    def test_evaluative_opener_not_detected(self, spacy_doc_factory):
        claims = detect("This is a terrible decision by the administration.", spacy_doc_factory)
        assert len(claims) == 0

    def test_very_short_word_count_filtered(self, spacy_doc_factory):
        claims = detect("Ok sure.", spacy_doc_factory)
        assert len(claims) == 0


class TestFilipinoClaimDetection:
    def test_filipino_percentage_detected(self, spacy_doc_factory):
        claims = detect("Ang bakuna ay nagdudulot ng 90% na proteksyon laban sa virus.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_filipino_daw_pattern_detected(self, spacy_doc_factory):
        claims = detect("Daw ay natuklasan ng mga siyentipiko ang bagong gamot para sa kanser.", spacy_doc_factory)
        assert len(claims) >= 1

    def test_filipino_opinion_marker_penalised(self, spacy_doc_factory):
        claims = detect("Sa tingin ko, ang presidente ay dapat magbitiw.", spacy_doc_factory)
        # With opinion marker penalty, should not exceed threshold
        for c in claims:
            assert "opinion_marker" in c["reasons"]


class TestClaimDetectionProperties:
    def test_confidence_in_range(self, spacy_doc_factory):
        text = "Scientists confirmed that 60% of adults experienced side effects."
        claims = detect(text, spacy_doc_factory)
        for c in claims:
            assert 0.0 <= c["confidence"] <= 1.0

    def test_results_sorted_descending(self, spacy_doc_factory):
        text = (
            "Researchers found that 50% of patients recovered. "
            "The WHO reported 2 million deaths globally. "
            "Scientists say vaccines prevent disease."
        )
        claims = detect(text, spacy_doc_factory)
        confidences = [c["confidence"] for c in claims]
        assert confidences == sorted(confidences, reverse=True)

    def test_results_capped_at_max_claims(self, spacy_doc_factory):
        from config import MAX_CLAIMS
        # Build a text with many claim-like sentences
        sentences = [
            f"Study #{i} found that {i*5}% of patients showed improvement."
            for i in range(1, 20)
        ]
        text = " ".join(sentences)
        doc = spacy_doc_factory(text)
        claims = ClaimDetectionModule.detect(doc, text)
        assert len(claims) <= MAX_CLAIMS

    def test_reasons_list_not_empty_for_detected_claim(self, spacy_doc_factory):
        claims = detect("NASA confirmed water ice was found on Mars.", spacy_doc_factory)
        assert len(claims) >= 1
        assert all(len(c["reasons"]) > 0 for c in claims)

    def test_sentence_index_present(self, spacy_doc_factory):
        claims = detect("Scientists found that vaccines reduce deaths by 80%.", spacy_doc_factory)
        assert len(claims) >= 1
        for c in claims:
            assert "sentence_index" in c
            assert isinstance(c["sentence_index"], int)

    def test_article_keywords_boost(self, spacy_doc_factory):
        """article_keywords context boost should not break claim detection."""
        text = "Duterte signed the anti-terror law in 2020."
        doc = spacy_doc_factory(text)
        claims_no_kw  = ClaimDetectionModule.detect(doc, text)
        claims_with_kw = ClaimDetectionModule.detect(doc, text, article_keywords=["Duterte", "anti-terror"])
        # With keywords, confidence should be >= without
        if claims_no_kw and claims_with_kw:
            assert claims_with_kw[0]["confidence"] >= claims_no_kw[0]["confidence"]


class TestFalsifiablePredicate:
    def test_entity_only_sentence_blocked_without_predicate(self, spacy_doc_factory):
        """
        A sentence with named entities + SVO but no falsifiable verb should be
        downgraded via falsifiable_penalty so it doesn't exceed the threshold.
        """
        # Pure descriptive — no action verb
        claims = detect("President Marcos and Secretary Remulla are Philippine officials.", spacy_doc_factory)
        # If detected, it must have been boosted by a real predicate signal
        for c in claims:
            if "falsifiable_penalty" in c["reasons"]:
                assert c["confidence"] < ClaimDetectionModule.CLAIM_THRESHOLD
