"""
SocialProof — pytest conftest
Provides shared fixtures for all test modules.
"""
import os
import pytest

# ── Set env vars BEFORE any app imports ──────────────────────────────────────
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-only-not-production")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("NLI_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")


@pytest.fixture(scope="session")
def spacy_doc_factory():
    """
    Return a factory that creates a spaCy Doc from a string.
    Uses a real en_core_web_sm model so dependency/entity tests are accurate.
    Loaded once per session to avoid repeated model-load overhead.
    """
    import spacy
    nlp = spacy.load("en_core_web_sm")

    def _make(text: str):
        return nlp(text)

    return _make


@pytest.fixture(scope="session")
def fever_samples():
    """
    Load the first 100 FEVER dev examples for NLI benchmark tests.
    Skipped automatically if the file is absent (CI without large data files).
    """
    import json
    path = os.path.join(os.path.dirname(__file__), "..", "data", "fever_dev.jsonl")
    if not os.path.exists(path):
        pytest.skip("data/fever_dev.jsonl not found — skipping FEVER benchmarks")

    samples = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            samples.append(json.loads(line))
            if len(samples) >= 100:
                break
    return samples
