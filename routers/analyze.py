import re
import os
import asyncio
import base64
import functools
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends, Request, Header

import sqlalchemy as sa
from sqlalchemy.orm import Session

from config import logger
from database.models import engine, SubmissionORM, ClaimORM
from pipeline import AnalysisPipeline
from pipeline.preprocessing import PreprocessingModule
from pipeline.evidence_retrieval import get_unverified_log
from pipeline.file_input import extract_text_from_file, SUPPORTED_ACCEPT
import json
import urllib.request

from schemas import (
    AnalyzeRequest, AnalyzeResponse, UserClaimRequest, ValidateClaimRequest,
    ClaimResult, EvidenceResult, AnnotationSegment,
    SourceStepResponse, FactCheckResult, MBFCRating,
)
from config import OLLAMA_URL, OLLAMA_MODEL
from routers.auth import get_current_user

router    = APIRouter()

# ── C-Rate: Redis-backed sliding-window rate limiter for /analyze ─────────────
# Falls back to in-process memory (single-worker dev only).
# Set REDIS_URL in .env to enable cross-worker, cross-restart enforcement.
import time as _time
from collections import defaultdict

_ANALYZE_RATE_WINDOW  = int(os.environ.get("ANALYZE_RATE_WINDOW_SECONDS", "60"))
_ANALYZE_RATE_LIMIT   = int(os.environ.get("ANALYZE_RATE_LIMIT",          "10"))

_analyze_redis = None
_REDIS_URL = os.getenv("REDIS_URL", "")
if _REDIS_URL:
    try:
        import redis as _redis_lib
        _analyze_redis = _redis_lib.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        _analyze_redis.ping()
        logger.info("Analyze rate limiter: Redis connected (sliding window, persistent).")
    except Exception as _re:
        logger.warning(
            f"Analyze rate limiter: Redis connection failed ({_re}). "
            "Falling back to in-process memory — NOT safe for multi-worker deployments."
        )
        _analyze_redis = None
else:
    logger.warning(
        "Analyze rate limiter: REDIS_URL not set. Using in-process memory. "
        "Rate limit is per-worker and resets on restart. Set REDIS_URL in .env for production."
    )

_ip_request_times: dict = defaultdict(list)   # fallback only


def _check_analyze_rate_limit(ip: str, token: str) -> None:
    """
    Sliding-window rate limiter: max ANALYZE_RATE_LIMIT requests per
    ANALYZE_RATE_WINDOW seconds, keyed on IP + session_token.
    Raises HTTP 429 when the limit is exceeded.
    """
    key = f"sp:analyze_rl:{ip}:{token}"
    now = _time.time()

    if _analyze_redis:
        pipe = _analyze_redis.pipeline()
        # Add current timestamp as a member; score = timestamp for ZRANGEBYSCORE
        pipe.zadd(key, {str(now): now})
        # Remove entries older than the window
        pipe.zremrangebyscore(key, 0, now - _ANALYZE_RATE_WINDOW)
        # Count remaining entries
        pipe.zcard(key)
        # Set TTL so keys expire automatically
        pipe.expire(key, _ANALYZE_RATE_WINDOW * 2)
        results = pipe.execute()
        count = results[2]
    else:
        window_start = now - _ANALYZE_RATE_WINDOW
        _ip_request_times[key] = [t for t in _ip_request_times[key] if t > window_start]
        _ip_request_times[key].append(now)
        count = len(_ip_request_times[key])

    if count > _ANALYZE_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded: maximum {_ANALYZE_RATE_LIMIT} requests "
                f"per {_ANALYZE_RATE_WINDOW} seconds. Please wait and try again."
            ),
        )

_pipeline = AnalysisPipeline()

# H-6: configurable worker count; default cpu_count * 2, min 2
_PIPELINE_WORKERS = int(os.environ.get("PIPELINE_WORKERS", max(2, (os.cpu_count() or 2) * 2)))
_executor = ThreadPoolExecutor(max_workers=_PIPELINE_WORKERS)

# H-6: overall pipeline timeout in seconds (configurable)
_PIPELINE_TIMEOUT = float(os.environ.get("PIPELINE_TIMEOUT_SECONDS", "120"))

# C-2 / H-5: session token format
_SESSION_TOKEN_RE = re.compile(r"^[0-9a-f]{32,64}$")

# Bug fix: input size caps — prevent OOM on huge text/file payloads
_MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", 50_000))   # chars
_MAX_FILE_MB     = float(os.environ.get("MAX_FILE_MB", 10))         # MB


# ── POST /analyze ─────────────────────────────────────────────────────────────
@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest, background_tasks: BackgroundTasks, req: Request = None):
    """
    Main analysis endpoint.
    Supports input_type: text | url | image | file.
    Requires a valid session_token (from GET /auth/session).
    """
    # C-2 / H-5: Hard-reject missing or malformed session_token
    if not request.session_token or not _SESSION_TOKEN_RE.match(request.session_token):
        raise HTTPException(
            status_code=422,
            detail=(
                "A valid session_token is required. "
                "Obtain one from GET /auth/session before calling this endpoint."
            ),
        )

    # C-Rate: Redis-backed sliding-window rate limit (IP + session_token)
    _client_ip = (req.client.host if req and req.client else "unknown")
    _check_analyze_rate_limit(_client_ip, request.session_token)

    # Bug fix: enforce input size caps before any processing
    if request.text and len(request.text) > _MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"Text input exceeds maximum length of {_MAX_TEXT_LENGTH} characters.",
        )
    if request.file_data:
        file_bytes = len(request.file_data) * 3 // 4  # approximate decoded size
        if file_bytes > _MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds maximum size of {_MAX_FILE_MB} MB.",
            )

    # ── Input validation ──────────────────────────────────────────────────────
    if request.input_type == "image":
        if not request.image_data:
            raise HTTPException(
                status_code=422,
                detail="image_data is required when input_type='image'. Send a base64-encoded string."
            )
        try:
            request_image_bytes = base64.b64decode(request.image_data)
        except Exception:
            raise HTTPException(status_code=422, detail="image_data is not valid base64.")

    elif request.input_type == "file":
        if not request.file_data:
            raise HTTPException(
                status_code=422,
                detail="file_data is required when input_type='file'. Send base64-encoded file bytes."
            )
        if not request.file_name:
            raise HTTPException(
                status_code=422,
                detail="file_name is required when input_type='file' so the server can detect the format."
            )
        try:
            file_bytes = base64.b64decode(request.file_data)
        except Exception:
            raise HTTPException(status_code=422, detail="file_data is not valid base64.")

        extracted = extract_text_from_file(file_bytes, filename=request.file_name)
        if not extracted or len(extracted.strip()) < 15:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Could not extract text from '{request.file_name}'. "
                    "If it's a scanned PDF, try re-submitting as input_type='image'. "
                    f"Supported formats: {SUPPORTED_ACCEPT}"
                )
            )
        request.text = extracted

    elif not request.text and not request.url:
        raise HTTPException(status_code=422, detail="Either 'text' or 'url' must be provided.")
    elif request.text and len(request.text.strip()) < 15:
        raise HTTPException(status_code=422, detail="Text content is too short to analyze.")

    # ── Save pending evaluation ───────────────────────────────────────────────
    db       = Session(engine)
    eval_orm = SubmissionORM(
        user_id       = request.user_id,
        session_token = request.session_token,
        input_type    = request.input_type,
        raw_content   = (
            request.text or request.url
            or ("[file]" if request.input_type == "file" else "[image]")
        ),
        status        = "pending",
    )
    try:
        db.add(eval_orm)
        db.commit()
        db.refresh(eval_orm)
        eval_id = eval_orm.id
    except Exception as e:
        logger.warning(f"DB save (pending) failed: {e}")
        eval_id = 0
    finally:
        db.close()

    # ── Run pipeline (H-6: with executor + timeout) ───────────────────────────
    try:
        loop   = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(_executor, functools.partial(_pipeline.run, request)),
            timeout=_PIPELINE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.error(f"Pipeline timeout after {_PIPELINE_TIMEOUT}s for eval {eval_id}")
        raise HTTPException(status_code=504, detail="Analysis timed out. Please try again.")
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred during analysis.")

    # ── Persist results in background ─────────────────────────────────────────
    def _save_results():
        """
        Persist pipeline results.  Retries up to 3 times with exponential
        backoff so transient DB errors (connection blip, lock timeout) don't
        leave submissions stuck in 'pending' forever.
        """
        _MAX_ATTEMPTS   = 3
        _BASE_DELAY_SEC = 1.5

        for attempt in range(1, _MAX_ATTEMPTS + 1):
            db2 = None
            try:
                db2 = Session(engine)
                orm = db2.get(SubmissionORM, eval_id)
                if orm:
                    orm.parsed_text = PreprocessingModule.clean(request.text or "")
                    orm.status      = "analyzed"
                    db2.commit()

                    saved_claim_ids: dict = {}
                    for c in result["claims"]:
                        claim_orm = ClaimORM(
                            submission_id  = eval_id,
                            claim_text     = c["text"],
                            sentence_index = c["sentence_index"],
                            label          = c["label"],
                            confidence     = c["confidence"],
                        )
                        db2.add(claim_orm)
                        db2.flush()
                        saved_claim_ids[c["text"][:80]] = claim_orm.id
                    db2.commit()
                return  # success — exit retry loop
            except Exception as exc:
                if db2:
                    try:
                        db2.rollback()
                    except Exception:
                        pass
                if attempt < _MAX_ATTEMPTS:
                    delay = _BASE_DELAY_SEC * (2 ** (attempt - 1))  # 1.5s, 3s
                    logger.warning(
                        f"Background DB save failed (attempt {attempt}/{_MAX_ATTEMPTS}), "
                        f"retrying in {delay:.1f}s: {exc}"
                    )
                    _time.sleep(delay)
                else:
                    logger.error(
                        f"Background DB save PERMANENTLY FAILED after {_MAX_ATTEMPTS} attempts "
                        f"for eval_id={eval_id}. Submission will remain in 'pending' status. "
                        f"Error: {exc}",
                        exc_info=True,
                    )
            finally:
                if db2:
                    try:
                        db2.close()
                    except Exception:
                        pass

    background_tasks.add_task(_save_results)

    return AnalyzeResponse(
        evaluation_id               = eval_id,
        submission_id               = eval_id,
        score                       = result["score"],
        label                       = result["label"],
        is_inconclusive             = result.get("is_inconclusive", False),
        explanation                 = result["explanation"],
        explanation_source          = result.get("explanation_source", "rule_based"),
        claims                      = [ClaimResult(**c) for c in result["claims"]],
        evidence                    = [EvidenceResult(**e) for e in result["evidence"]],
        annotated                   = [AnnotationSegment(**s) for s in result["annotated"]],
        source_score                = result["source_score"],
        bias_score                  = result["bias_score"],
        processing_ms               = result["processing_ms"],
        is_partial                  = result["is_partial"],
        no_claims_detected          = result.get("no_claims_detected", False),
        live_search_used            = result.get("live_search_used", False),
        evidence_coverage           = result["evidence_coverage"],
        unverified_claims           = result["unverified_claims"],
        suggest_secondary_retrieval = result["suggest_secondary_retrieval"],
        sub_scores                  = result["sub_scores"],
        mil_tip                     = result.get("mil_tip", ""),
        mil_tip_source              = result.get("mil_tip_source", "rule_based"),
        all_evidence_neutral        = result.get("all_evidence_neutral", False),
        url_fetch_failed            = result.get("url_fetch_failed", False),
        url_fetch_error             = result.get("url_fetch_error", ""),
        evidence_quality_note       = result.get("evidence_quality_note", ""),
    )


# ── POST /analyze/validate-claim ─────────────────────────────────────────────
@router.post("/analyze/validate-claim")
async def validate_claim(request: ValidateClaimRequest, req: Request = None):
    """
    Ask Ollama whether the user-typed text is a checkable factual claim.
    Returns {is_claim: bool, reason: str}.
    Raises 503 if Ollama is unavailable.
    M-4 FIX: Requires valid session_token and enforces rate limiting.
    """
    if not request.session_token or not _SESSION_TOKEN_RE.match(request.session_token):
        raise HTTPException(
            status_code=422,
            detail=(
                "A valid session_token is required. "
                "Obtain one from GET /auth/session before calling this endpoint."
            ),
        )
    _client_ip = (req.client.host if req and req.client else "unknown")
    _check_analyze_rate_limit(_client_ip, request.session_token)
    prompt = (
        "You are a claim detection assistant. "
        "Determine whether the following user input is a checkable factual claim — "
        "a statement that asserts something as fact and could be verified with evidence. "
        "Opinions, questions, greetings, and vague statements are NOT claims.\n\n"
        f"User input: \"{request.claim_text}\"\n\n"
        "Respond ONLY with valid JSON in this exact format, no other text:\n"
        "{\"is_claim\": true, \"reason\": \"brief one-sentence explanation\"}"
    )

    try:
        payload = json.dumps({
            "model":  OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
        }).encode()

        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data     = json.loads(resp.read().decode())
            raw_text = data.get("response", "").strip()

        raw_text = raw_text.replace("```json", "").replace("```", "").strip()

        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError:
            logger.warning(f"[ValidateClaim] Could not parse Ollama JSON: {raw_text!r}")
            return {"is_claim": True, "reason": "Validation parsing failed — proceeding."}

        return {
            "is_claim": bool(parsed.get("is_claim", False)),
            "reason":   parsed.get("reason", ""),
        }

    except Exception as e:
        logger.warning(f"[ValidateClaim] Ollama unavailable: {e}")
        raise HTTPException(
            status_code=503,
            detail="Ollama validation service is offline. Skipping claim check.",
        )


# ── POST /analyze/user-claim ──────────────────────────────────────────────────
@router.post("/analyze/user-claim")
async def analyze_user_claim(
    request: UserClaimRequest,
    background_tasks: BackgroundTasks,
    req: Request,
    authorization: str = Header(None),
):
    """
    §4.3 — Re-analyze with a user-typed claim when the system detected none.
    C-4: Requires auth for logged-in users; anonymous users verified by session_token.
    H-3: Pipeline runs in executor — does not block the event loop.
    """
    db = Session(engine)
    try:
        eval_orm = db.get(SubmissionORM, request.submission_id)
        if not eval_orm:
            raise HTTPException(status_code=404, detail="Evaluation not found.")

        if authorization and authorization.startswith("Bearer "):
            try:
                current_user = get_current_user(req, authorization)
                if eval_orm.user_id is not None and eval_orm.user_id != current_user["sub"]:
                    raise HTTPException(status_code=403, detail="Access denied.")
            except HTTPException as e:
                if e.status_code == 401:
                    if eval_orm.session_token != request.session_token:
                        raise HTTPException(status_code=403, detail="Access denied.")
                else:
                    raise
        else:
            if eval_orm.session_token != request.session_token:
                raise HTTPException(status_code=403, detail="Access denied.")

        original_text = eval_orm.parsed_text or eval_orm.raw_content
    finally:
        db.close()

    synthetic_request = AnalyzeRequest(
        text          = original_text,
        input_type    = "text",
        session_token = request.session_token,
        user_id       = request.user_id,
    )

    try:
        loop   = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                functools.partial(_pipeline.run, synthetic_request, user_submitted_claim=request.claim_text),
            ),
            timeout=_PIPELINE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Analysis timed out. Please try again.")
    except Exception as e:
        logger.error(f"User claim pipeline error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An internal error occurred during analysis.")

    def _save_user_claim_results():
        db2 = None
        try:
            db2 = Session(engine)
            claim_orm = ClaimORM(
                submission_id  = request.submission_id,
                claim_text     = request.claim_text,
                sentence_index = None,
                label          = result["claims"][0]["label"] if result["claims"] else "unverified",
                confidence     = 1.0,
            )
            db2.add(claim_orm)
            db2.flush()

            orm = db2.get(SubmissionORM, request.submission_id)
            if orm:
                orm.status = "analyzed"

            db2.commit()
        except Exception as exc:
            logger.warning(f"User claim DB save failed: {exc}")
            try:
                if db2: db2.rollback()
            except Exception:
                pass
        finally:
            if db2: db2.close()

    background_tasks.add_task(_save_user_claim_results)

    return {
        "evaluation_id":    request.submission_id,
        "claim_text":       request.claim_text,
        "score":            result["score"],
        "label":            result["label"],
        "explanation":      result["explanation"],
        "claims":           result["claims"],
        "evidence":         result["evidence"],
        "is_partial":       result["is_partial"],
        "live_search_used": result.get("live_search_used", False),
        "processing_ms":    result["processing_ms"],
    }


# ── GET /evaluations/{id} ─────────────────────────────────────────────────────
# C-1: Requires auth; verifies ownership by user_id or session_token
@router.get("/evaluations/{evaluation_id}")
async def get_evaluation(
    evaluation_id: int,
    req: Request,
    session_token: str = None,
    authorization: str = Header(None),
):
    db = Session(engine)
    try:
        row = db.get(SubmissionORM, evaluation_id)
        if not row:
            raise HTTPException(status_code=404, detail="Evaluation not found.")

        if authorization and authorization.startswith("Bearer "):
            current_user = get_current_user(req, authorization)
            if row.user_id is not None and row.user_id != current_user["sub"]:
                raise HTTPException(status_code=403, detail="Access denied.")
        elif session_token:
            if row.session_token != session_token:
                raise HTTPException(status_code=403, detail="Access denied.")
        else:
            raise HTTPException(status_code=401, detail="Authentication required.")

        return {
            "id":         row.id,
            "status":     row.status,
            "created_at": row.created_at.isoformat(),
        }
    finally:
        db.close()


# ── GET /evaluations/{id}/comparison ─────────────────────────────────────────
@router.get("/evaluations/{evaluation_id}/comparison")
async def get_comparison(
    evaluation_id: int,
    req: Request,
    session_token: str = None,
    authorization: str = Header(None),
):
    db = Session(engine)
    try:
        row_check = db.get(SubmissionORM, evaluation_id)
        if not row_check:
            raise HTTPException(status_code=404, detail="Evaluation not found.")

        if authorization and authorization.startswith("Bearer "):
            current_user = get_current_user(req, authorization)
            if row_check.user_id is not None and row_check.user_id != current_user["sub"]:
                raise HTTPException(status_code=403, detail="Access denied.")
        elif session_token:
            if row_check.session_token != session_token:
                raise HTTPException(status_code=403, detail="Access denied.")
        else:
            raise HTTPException(status_code=401, detail="Authentication required.")

        row = db.execute(
            sa.text("""
                SELECT s.id, s.raw_content, s.status, s.created_at,
                       s.input_type, s.parsed_text
                FROM submissions s
                WHERE s.id = :eid
                LIMIT 1
            """),
            {"eid": evaluation_id},
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=404, detail="Submission not found."
            )
        return dict(row._mapping)
    finally:
        db.close()


# ── GET /evaluations ──────────────────────────────────────────────────────────
# H-1: user_id is derived from JWT — never accepted from query string
@router.get("/evaluations")
async def list_evaluations(
    req: Request,
    session_token: str = None,
    limit: int = 20,
    authorization: str = Header(None),
):
    db = Session(engine)
    try:
        if authorization and authorization.startswith("Bearer "):
            current_user = get_current_user(req, authorization)
            rows = db.execute(
                sa.text("""
                    SELECT s.id, s.raw_content, s.status, s.created_at, s.input_type
                    FROM submissions s
                    WHERE s.user_id = :uid
                    ORDER BY s.created_at DESC LIMIT :lim
                """),
                {"uid": current_user["sub"], "lim": limit},
            ).fetchall()
        elif session_token:
            rows = db.execute(
                sa.text("""
                    SELECT s.id, s.raw_content, s.status, s.created_at, s.input_type
                    FROM submissions s
                    WHERE s.session_token = :tok
                    ORDER BY s.created_at DESC LIMIT :lim
                """),
                {"tok": session_token, "lim": limit},
            ).fetchall()
        else:
            raise HTTPException(status_code=422, detail="Authorization header or session_token required.")
        return [dict(r._mapping) for r in rows]
    finally:
        db.close()


# ── GET /corpus-gaps ──────────────────────────────────────────────────────────
# H-4: Requires authentication (admin or any logged-in user)
@router.get("/corpus-gaps")
async def corpus_gaps(
    req: Request,
    authorization: str = Header(None),
):
    get_current_user(req, authorization)   # H-4: auth required
    return {"gaps": get_unverified_log()}


# ── POST /user-evaluation ─────────────────────────────────────────────────────
# Accepts the user's step answers, runs lesson_trigger + behavior_tracker,
# saves triggered lessons, and returns comparison feedback for the results panel.
# NOTE: user_evaluations table was removed in v4.0 — evaluation data is derived
# from the submission + live comparison logic only; nothing is persisted per-eval.
@router.post("/user-evaluation")
async def post_user_evaluation(body: dict):
    submission_id   = body.get("evaluation_id") or body.get("submission_id")
    session_token   = body.get("session_token", "")
    user_id         = body.get("user_id")
    user_score      = int(body.get("user_score") or 50)
    user_label      = body.get("user_label") or ""
    confidence      = body.get("confidence_level") or "medium"
    skipped_steps   = body.get("skipped_steps") or []
    identified_claims = body.get("identified_claims") or []
    source_credible = body.get("source_credible")
    bias_detected   = bool(body.get("bias_detected"))
    evidence_assessed = bool(body.get("evidence_assessed"))

    db = Session(engine)
    try:
        # ── Pull submission so we have system score + label ──────────────────
        row = db.get(SubmissionORM, submission_id) if submission_id else None
        system_score = 50
        system_label = "Uncertain"

        # ── Build comparison feedback items (rule-based, no DB table needed) ─
        feedback_items: list[dict] = []
        triggered_lessons: list[dict] = []

        steps_done = 8 - len(skipped_steps)
        if steps_done >= 7:
            feedback_items.append({"type": "good", "text": "You completed most analysis steps — thorough work."})
        elif steps_done >= 4:
            feedback_items.append({"type": "warn", "text": f"You completed {steps_done} of 8 analysis steps."})
        else:
            feedback_items.append({"type": "bad",  "text": f"Only {steps_done} of 8 steps completed — try not to skip."})

        if "source" in skipped_steps or source_credible is None:
            feedback_items.append({"type": "warn", "text": "Source credibility was not assessed — this is a key step."})
        elif source_credible == "yes":
            feedback_items.append({"type": "good", "text": "You checked the source credibility."})

        if bias_detected:
            feedback_items.append({"type": "good", "text": "Good catch — you flagged potential bias in the content."})

        if evidence_assessed:
            feedback_items.append({"type": "good", "text": "You assessed the evidence — that's the most important step."})
        elif "evidence" in skipped_steps:
            feedback_items.append({"type": "bad",  "text": "Evidence assessment was skipped — claims need to be checked against evidence."})

        # ── Run lesson triggers and save to lessons_triggered ────────────────
        try:
            from services.lesson_trigger import compute_triggers
            from services.behavior_tracker import get_behavior_triggers

            comparison_data = {
                "system_label":   system_label,
                "missed_bias":    not bias_detected,
                "missed_claims":  len(identified_claims) == 0,
                "source_mismatch": source_credible == "yes" and system_score < 40,
                "score_diff":     user_score - system_score,
                "label_match":    True,
            }
            user_eval_data = {
                "skipped_steps":    skipped_steps,
                "confidence_level": confidence,
                "source_credible":  source_credible,
                "bias_detected":    bias_detected,
                "user_label":       user_label,
                "user_score":       user_score,
                "user_id":          user_id,
                "identified_claims": identified_claims,
                "evidence_assessed": evidence_assessed,
                "time_spent_seconds": body.get("time_spent_seconds") or 0,
            }

            raw_triggers = compute_triggers(comparison_data, user_eval_data, db)

            behavior_extra = get_behavior_triggers(
                user_eval_data,
                {"bias_score": 0.0, "score": system_score, "claims": []},
            )
            behavior_flags = [t["lesson_key"].replace("behavior_", "") for t in behavior_extra]
            user_eval_data["behavior_flags"] = behavior_flags

            all_triggers = raw_triggers + behavior_extra
            seen_keys: set = set()
            deduped = []
            for t in all_triggers:
                if t["lesson_key"] not in seen_keys:
                    seen_keys.add(t["lesson_key"])
                    deduped.append(t)

            if submission_id and deduped:
                for t in deduped:
                    lesson_row = db.execute(
                        sa.text("SELECT id FROM lessons WHERE lesson_key = :k LIMIT 1"),
                        {"k": t["lesson_key"]},
                    ).fetchone()
                    if lesson_row:
                        db.execute(
                            sa.text(
                                "INSERT INTO lessons_triggered "
                                "(submission_id, lesson_id, trigger_reason) "
                                "VALUES (:sid, :lid, :reason)"
                            ),
                            {
                                "sid":    submission_id,
                                "lid":    lesson_row.id,
                                "reason": t.get("trigger_reason", ""),
                            },
                        )
                db.commit()

            triggered_lessons = [
                {"key": t["lesson_key"], "trigger_reason": t.get("trigger_reason", "")}
                for t in deduped
            ]

        except Exception as te:
            logger.warning(f"[user-evaluation] lesson trigger error: {te}")

        return {
            "user_evaluation_id": None,   # table removed in v4.0
            "comparison": {
                "score_diff":         0,
                "score_diff_label":   "Low",
                "user_label":         user_label,
                "system_label":       system_label,
                "label_match":        True,
                "missed_bias":        not bias_detected,
                "missed_claims":      len(identified_claims) == 0,
                "source_mismatch":    False,
                "confidence_level":   confidence,
                "triggered_lessons":  triggered_lessons,
                "feedback_items":     feedback_items,
                "feedback_summary":   "",
                "evidence_was_missing": False,
                "lesson_context_map": {},
            },
        }
    except Exception as e:
        logger.error(f"[user-evaluation] error: {e}")
        return {"user_evaluation_id": None, "comparison": {"feedback_items": [], "triggered_lessons": []}}
    finally:
        db.close()


# ── POST /user-reflection ─────────────────────────────────────────────────────
# Stores a user's free-text reflection on an analysis (position + reasoning).
# user_evaluations removed in v4.0 — reflections are acknowledged but not persisted.
@router.post("/user-reflection")
async def post_user_reflection(body: dict):
    return {"status": "ok", "message": "Reflection noted."}


# ── POST /re-evaluation ───────────────────────────────────────────────────────
# Accepts a revised credibility score after the user re-thinks their verdict.
# re_evaluations table removed in v4.0 — acknowledged but not persisted.
@router.post("/re-evaluation")
async def post_re_evaluation(body: dict):
    revised_score = body.get("revised_score") or 50
    return {
        "status":      "ok",
        "score_shift": 0,
        "message":     f"Revised rating ({revised_score}/100) recorded.",
    }


# ── POST /analyze/pre-share-check ────────────────────────────────────────────
@router.post("/analyze/pre-share-check", response_model=SourceStepResponse)
async def pre_share_check(body: dict, req: Request = None):
    """
    Lightweight source check surfaced before the user shares content.

    Per guide §7 / §8:
      - Runs Source metadata + Google Fact Check API + MBFC lookup only.
      - Does NOT run NLI, bias analysis, or full evidence retrieval.
      - Optional and non-blocking — prompts the user to verify before sharing.
      - Accepts: { url: str, claim_text?: str, session_token: str }

    Returns SourceStepResponse with factcheck_results and mbfc populated.
    """
    url         = (body.get("url") or "").strip()
    claim_text  = (body.get("claim_text") or "").strip()
    session_tok = (body.get("session_token") or "").strip()

    # M-3 FIX: validate session_token and enforce rate limit
    if not session_tok or not _SESSION_TOKEN_RE.match(session_tok):
        raise HTTPException(
            status_code=422,
            detail=(
                "A valid session_token is required. "
                "Obtain one from GET /auth/session before calling this endpoint."
            ),
        )
    _client_ip = (req.client.host if req and req.client else "unknown")
    _check_analyze_rate_limit(_client_ip, session_tok)

    if not url and not claim_text:
        raise HTTPException(
            status_code=422,
            detail="Either 'url' or 'claim_text' must be provided."
        )

    from pipeline.source_credibility import (
        SourceCredibilityModule,
        get_mbfc_rating,
        get_factcheck_results,
    )

    source_result = SourceCredibilityModule.evaluate(url or None, claim_text)

    mbfc_raw = get_mbfc_rating(url or None)
    mbfc     = MBFCRating(**mbfc_raw) if mbfc_raw else None

    factcheck_raw: list = []
    if claim_text:
        try:
            factcheck_raw = await asyncio.wait_for(
                get_factcheck_results(claim_text), timeout=10.0
            )
        except asyncio.TimeoutError:
            logger.warning("[PreShareCheck] Fact Check API timed out — returning empty")
        except Exception as e:
            logger.warning(f"[PreShareCheck] Fact Check API error: {e}")

    from urllib.parse import urlparse as _urlparse
    parsed_domain = ""
    if url:
        try:
            parsed_domain = _urlparse(url if url.startswith("http") else "https://" + url).netloc.replace("www.", "")
        except Exception:
            parsed_domain = url

    return SourceStepResponse(
        domain            = parsed_domain or "(no domain)",
        source_type       = "url" if url else "text",
        trust_signals     = source_result.get("signals", []),
        source_score      = source_result.get("score", 0.5),
        source_label      = source_result.get("label", "Unknown"),
        mbfc              = mbfc,
        factcheck_results = [FactCheckResult(**r) for r in factcheck_raw],
    )
