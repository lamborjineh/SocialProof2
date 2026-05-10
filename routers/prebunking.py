"""
SocialProof — Router: Prebunking Lab  v2.0
routers/prebunking.py

v2.0 changes:
  - Techniques are no longer hardcoded. They live in `prebunking_techniques`
    (admin-managed). Admins add/remove techniques without touching code.
  - POST /prebunking/attempt validates against the live DB technique list.
  - `techniques_total` reflects the current active DB count.
  - image_url is returned on all question objects.
"""

from typing import Optional
from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import logger
from database.models import engine

router = APIRouter()


# ── Table bootstrap ───────────────────────────────────────────────────────────

def _ensure_tables():
    """Lazily create prebunking_techniques and prebunking_attempts if missing."""
    ddl_techniques = """
    CREATE TABLE IF NOT EXISTS prebunking_techniques (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        technique_id VARCHAR(64)  NOT NULL UNIQUE,
        name         VARCHAR(255) NOT NULL,
        description  TEXT         NULL,
        module       INT          NULL,
        sort_order   INT          NOT NULL DEFAULT 0,
        is_active    TINYINT(1)   NOT NULL DEFAULT 1,
        created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pbt_active (is_active)
    )
    """
    ddl_attempts = """
    CREATE TABLE IF NOT EXISTS prebunking_attempts (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        session_token   VARCHAR(128) NOT NULL,
        user_id         INT          NULL,
        technique_id    VARCHAR(64)  NOT NULL,
        correct         TINYINT(1)   NOT NULL DEFAULT 0,
        attempted_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_session_tech (session_token, technique_id),
        INDEX idx_pb_user (user_id),
        INDEX idx_pb_session (session_token)
    )
    """
    seed = """
    INSERT IGNORE INTO prebunking_techniques
        (technique_id, name, description, module, sort_order)
    VALUES
        ('emotional_override', 'Emotional Override',
         'Manipulates by triggering strong emotions to bypass critical thinking.', 6, 10),
        ('false_authority',    'False Authority',
         'Cites fake or irrelevant experts to lend undeserved credibility.', 6, 20),
        ('cherry_pick',        'Cherry-Picked Statistics',
         'Selects only data points that support a conclusion while hiding contradictions.', 7, 30),
        ('false_dichotomy',    'False Dichotomy',
         'Presents only two options when more exist, forcing a manufactured choice.', 7, 40),
        ('conspiracy_framing', 'Conspiracy Framing',
         'Frames events as secret plots without verifiable evidence.', 8, 50),
        ('impersonation',      'Source Impersonation',
         'Fakes the identity of a credible source to spread misinformation.', 8, 60)
    """
    try:
        with engine.begin() as conn:
            conn.execute(sa.text(ddl_techniques))
            conn.execute(sa.text(ddl_attempts))
            conn.execute(sa.text(seed))
    except Exception as e:
        logger.warning(f"[Prebunking] Could not ensure tables: {e}")


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_active_techniques() -> list:
    try:
        with engine.connect() as conn:
            rows = conn.execute(sa.text("""
                SELECT technique_id, name, description, module, sort_order
                FROM prebunking_techniques
                WHERE is_active = 1
                ORDER BY sort_order, id
            """)).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception:
        return []


def _get_active_technique_ids() -> set:
    return {t["technique_id"] for t in _get_active_techniques()}


def _get_completions(session_token: str, user_id: Optional[int]) -> list:
    try:
        with engine.connect() as conn:
            if user_id:
                rows = conn.execute(sa.text("""
                    SELECT technique_id, correct, attempted_at
                    FROM prebunking_attempts
                    WHERE user_id = :uid
                    ORDER BY attempted_at DESC
                """), {"uid": user_id}).fetchall()
            else:
                rows = conn.execute(sa.text("""
                    SELECT technique_id, correct, attempted_at
                    FROM prebunking_attempts
                    WHERE session_token = :tok
                    ORDER BY attempted_at DESC
                """), {"tok": session_token}).fetchall()
        return [{"technique_id": r[0], "correct": bool(r[1]), "attempted_at": str(r[2])} for r in rows]
    except Exception as e:
        logger.debug(f"[Prebunking] _get_completions error: {e}")
        return []


def _compute_score(completions: list) -> Optional[float]:
    if not completions:
        return None
    correct = sum(1 for c in completions if c["correct"])
    return round((correct / len(completions)) * 100, 1)


# ── Pydantic models ───────────────────────────────────────────────────────────

class PrebunkingAttemptRequest(BaseModel):
    session_token: str
    user_id:       Optional[int] = None
    technique_id:  str
    correct:       bool


class PrebunkingAttemptResponse(BaseModel):
    technique_id:       str
    correct:            bool
    inoculation_score:  Optional[float] = None
    techniques_done:    int
    techniques_total:   int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/prebunking/techniques")
async def list_techniques():
    """DB-driven technique list. Admins manage via /admin/prebunking-techniques."""
    _ensure_tables()
    return {"techniques": _get_active_techniques()}


@router.get("/prebunking/modules")
async def get_prebunking_modules(
    session_token: str,
    user_id:       Optional[int] = None,
):
    """Every active technique with the user's completion state."""
    _ensure_tables()
    techs         = _get_active_techniques()
    completions   = _get_completions(session_token, user_id)
    completed_map = {c["technique_id"]: c for c in completions}

    modules = []
    for t in techs:
        comp = completed_map.get(t["technique_id"])
        modules.append({
            "technique_id": t["technique_id"],
            "name":         t["name"],
            "description":  t.get("description"),
            "module":       t.get("module"),
            "phase":        "done" if comp else "vaccine",
            "correct":      comp["correct"]      if comp else None,
            "attempted_at": comp["attempted_at"] if comp else None,
        })

    return {
        "modules":           modules,
        "completions":       completions,
        "inoculation_score": _compute_score(completions),
        "techniques_done":   len(completed_map),
        "techniques_total":  len(techs),
    }


@router.post("/prebunking/attempt", response_model=PrebunkingAttemptResponse)
async def record_prebunking_attempt(body: PrebunkingAttemptRequest):
    """Record a technique attempt; validates technique_id against live DB list."""
    _ensure_tables()

    valid_ids = _get_active_technique_ids()
    if valid_ids and body.technique_id not in valid_ids:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown technique_id '{body.technique_id}'. Valid: {sorted(valid_ids)}"
        )

    try:
        with engine.begin() as conn:
            conn.execute(sa.text("""
                INSERT INTO prebunking_attempts
                    (session_token, user_id, technique_id, correct, attempted_at)
                VALUES (:tok, :uid, :tid, :correct, :now)
                ON DUPLICATE KEY UPDATE
                    correct      = VALUES(correct),
                    attempted_at = VALUES(attempted_at),
                    user_id      = COALESCE(VALUES(user_id), user_id)
            """), {
                "tok":     body.session_token,
                "uid":     body.user_id,
                "tid":     body.technique_id,
                "correct": int(body.correct),
                "now":     datetime.now(timezone.utc),
            })
    except Exception as e:
        logger.error(f"[Prebunking] Failed to record attempt: {e}")
        raise HTTPException(status_code=500, detail="Could not record attempt.")

    completions = _get_completions(body.session_token, body.user_id)
    score       = _compute_score(completions)
    done        = len({c["technique_id"] for c in completions})
    total       = len(valid_ids) if valid_ids else done

    logger.info(
        f"[Prebunking] technique={body.technique_id} correct={body.correct} "
        f"session={body.session_token[:8]}… score={score}"
    )

    return PrebunkingAttemptResponse(
        technique_id      = body.technique_id,
        correct           = body.correct,
        inoculation_score = score,
        techniques_done   = done,
        techniques_total  = total,
    )


@router.get("/prebunking/stats")
async def get_prebunking_stats(
    session_token: str,
    user_id:       Optional[int] = None,
):
    """Aggregated prebunking performance for dashboard widget."""
    _ensure_tables()
    completions = _get_completions(session_token, user_id)
    correct     = [c for c in completions if c["correct"]]
    wrong       = [c for c in completions if not c["correct"]]
    total       = len(_get_active_technique_ids()) or len(completions)

    return {
        "inoculation_score": _compute_score(completions),
        "techniques_done":   len(completions),
        "techniques_total":  total,
        "correct":           len(correct),
        "incorrect":         len(wrong),
        "completed_ids":     [c["technique_id"] for c in completions],
        "weakest_technique": wrong[-1]["technique_id"] if wrong else None,
    }


@router.get("/prebunking/questions")
async def list_prebunking_questions(
    technique_id: Optional[str] = None,
    limit:        int           = 10,
):
    """Randomised questions; includes image_url, video_url, media_type."""
    try:
        with engine.connect() as conn:
            if technique_id:
                rows = conn.execute(sa.text("""
                    SELECT id, technique_id, question_text,
                           option_a, option_b, option_c, option_d,
                           correct_answer, explanation, image_url,
                           video_url, media_type
                    FROM prebunking_questions
                    WHERE technique_id = :tid
                    ORDER BY RAND() LIMIT :lim
                """), {"tid": technique_id, "lim": limit}).fetchall()
            else:
                rows = conn.execute(sa.text("""
                    SELECT id, technique_id, question_text,
                           option_a, option_b, option_c, option_d,
                           correct_answer, explanation, image_url,
                           video_url, media_type
                    FROM prebunking_questions
                    ORDER BY RAND() LIMIT :lim
                """), {"lim": limit}).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception as e:
        logger.debug(f"[Prebunking] list questions error: {e}")
        return []


@router.get("/prebunking/questions/random")
async def random_prebunking_question(technique_id: Optional[str] = None):
    """Single random question, optionally filtered by technique_id."""
    try:
        with engine.connect() as conn:
            if technique_id:
                row = conn.execute(sa.text("""
                    SELECT id, technique_id, question_text,
                           option_a, option_b, option_c, option_d,
                           correct_answer, explanation, image_url,
                           video_url, media_type
                    FROM prebunking_questions
                    WHERE technique_id = :tid
                    ORDER BY RAND() LIMIT 1
                """), {"tid": technique_id}).fetchone()
            else:
                row = conn.execute(sa.text("""
                    SELECT id, technique_id, question_text,
                           option_a, option_b, option_c, option_d,
                           correct_answer, explanation, image_url,
                           video_url, media_type
                    FROM prebunking_questions
                    ORDER BY RAND() LIMIT 1
                """)).fetchone()
        return dict(row._mapping) if row else None
    except Exception as e:
        logger.debug(f"[Prebunking] random question error: {e}")
        return None


@router.get("/prebunking/questions/count")
async def count_prebunking_questions():
    """Count of questions per technique and total."""
    try:
        with engine.connect() as conn:
            rows = conn.execute(sa.text("""
                SELECT technique_id, COUNT(*) AS count
                FROM prebunking_questions
                GROUP BY technique_id
            """)).fetchall()
            total = conn.execute(sa.text(
                "SELECT COUNT(*) FROM prebunking_questions"
            )).scalar()
        return {"total": total or 0, "by_technique": {r[0]: r[1] for r in rows}}
    except Exception as e:
        logger.debug(f"[Prebunking] count error: {e}")
        return {"total": 0, "by_technique": {}}
