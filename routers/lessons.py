"""
SocialProof — Router: Lessons
Endpoints:
  GET  /lessons                            — list all lessons (filterable + FTS)
  GET  /lessons/triggered/{submission_id}  — lessons triggered for a submission
  POST /lessons/mark-read/{lesson_trigger_id} — mark a triggered lesson as read
  POST /lessons/{lesson_id}/read           — Fix #18: server-side read sync
  POST /lessons/complete                   — v3: write to lesson_completions table

v3.5 — Full-text search
  GET /lessons?q=<keyword>
  When a `q` parameter is provided the endpoint tries a MySQL FULLTEXT search
  (MATCH … AGAINST) on (title, content).  If the DB does not yet have the
  FULLTEXT index, or the query runs on SQLite (tests/dev), it falls back to a
  case-insensitive LIKE search across both columns.  Client-side filtering in
  lessons.html already works for the loaded dataset; the backend search is the
  server-authoritative path and is used when the client calls the API directly
  with ?q=.
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Query, Header, Request
from sqlalchemy.orm import Session

from config import logger
from database.models import engine
from schemas import LessonCompletionRequest, LessonCompletionResponse
from routers.auth import get_current_user

router = APIRouter()


def _fts_search(db: Session, q: str, extra_wheres: list, params: dict) -> list:
    """
    Attempt a MySQL FULLTEXT search on lessons(title, content).
    Falls back to LIKE on any error (missing index, SQLite, etc.).
    Returns a list of row dicts.
    """
    base_where = " AND ".join(extra_wheres) if extra_wheres else "1=1"

    fts_sql = f"""
        SELECT *, MATCH(title, content) AGAINST(:q IN BOOLEAN MODE) AS _score
        FROM lessons
        WHERE ({base_where})
          AND MATCH(title, content) AGAINST(:q IN BOOLEAN MODE)
        ORDER BY _score DESC, topic, difficulty
    """
    try:
        rows = db.execute(sa.text(fts_sql), {**params, "q": q}).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception:
        pass  # fall through to LIKE

    like_param = f"%{q}%"
    like_where = "(title LIKE :q_like OR content LIKE :q_like)"
    where_clause = f"({base_where}) AND {like_where}" if extra_wheres else like_where

    like_sql = f"""
        SELECT * FROM lessons
        WHERE {where_clause}
        ORDER BY topic, difficulty
    """
    try:
        rows = db.execute(sa.text(like_sql), {**params, "q_like": like_param}).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/lessons")
async def get_lessons(
    topic:      Optional[str] = Query(None, description="Filter by topic"),
    difficulty: Optional[str] = Query(None, description="beginner | intermediate | advanced"),
    q:          Optional[str] = Query(None, description="Full-text search across title and content"),
):
    """
    Return all lessons with optional filtering by topic, difficulty, and keyword search.
    Powers the Learn page (lessons.html).

    Parameters
    ----------
    topic       : exact match on the `topic` enum column
    difficulty  : exact match on the `difficulty` enum column
    q           : keyword search — tries MySQL FULLTEXT, falls back to LIKE
    """
    db = Session(engine)
    try:
        params: Dict[str, Any] = {}
        wheres: list = []

        if topic:
            wheres.append("topic = :topic")
            params["topic"] = topic
        if difficulty:
            wheres.append("difficulty = :difficulty")
            params["difficulty"] = difficulty

        if q and q.strip():
            q_clean = q.strip()
            logger.debug(f"[lessons] FTS query: {q_clean!r}")
            return _fts_search(db, q_clean, wheres, params)

        sql = "SELECT * FROM lessons"
        if wheres:
            sql += " WHERE " + " AND ".join(wheres)
        sql += " ORDER BY topic, difficulty"

        rows = db.execute(sa.text(sql), params).fetchall()
        return [dict(r._mapping) for r in rows]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.get("/lessons/triggered/{submission_id}")
async def get_triggered_lessons(submission_id: int, req: Request, authorization: str = Header(None)):
    """Return all lessons triggered for a specific submission.
    H-2 FIX: Requires authentication; verifies caller owns the submission.
    """
    payload = get_current_user(req, authorization)
    caller_id = payload["sub"]
    caller_role = payload.get("role", "")

    db = Session(engine)
    try:
        # Verify ownership: check that the submission belongs to the caller
        if caller_role != "admin":
            ownership = db.execute(
                sa.text("SELECT user_id FROM submissions WHERE id = :sid"),
                {"sid": submission_id},
            ).fetchone()
            if not ownership:
                raise HTTPException(status_code=404, detail="Submission not found.")
            if ownership.user_id != caller_id:
                raise HTTPException(status_code=403, detail="Forbidden.")

        rows = db.execute(
            sa.text("""
                SELECT l.*, lt.id AS trigger_id, lt.trigger_reason, lt.was_read
                FROM lessons_triggered lt
                JOIN lessons l ON l.id = lt.lesson_id
                WHERE lt.submission_id = :uid
            """),
            {"uid": submission_id},
        ).fetchall()
        return [dict(r._mapping) for r in rows]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/lessons/mark-read/{lesson_trigger_id}")
async def mark_lesson_read(lesson_trigger_id: int, req: Request, authorization: str = Header(None)):
    """Mark a triggered lesson as read (for completion tracking).
    H-3 FIX: Requires authentication; verifies the trigger belongs to the caller.
    """
    payload = get_current_user(req, authorization)
    caller_id = payload["sub"]
    caller_role = payload.get("role", "")

    db = Session(engine)
    try:
        if caller_role != "admin":
            # Verify the trigger row belongs to the caller via its submission
            ownership = db.execute(
                sa.text("""
                    SELECT s.user_id FROM lessons_triggered lt
                    JOIN submissions s ON s.id = lt.submission_id
                    WHERE lt.id = :tid
                """),
                {"tid": lesson_trigger_id},
            ).fetchone()
            if not ownership:
                raise HTTPException(status_code=404, detail="Lesson trigger not found.")
            if ownership.user_id != caller_id:
                raise HTTPException(status_code=403, detail="Forbidden.")

        db.execute(
            sa.text("UPDATE lessons_triggered SET was_read = 1 WHERE id = :id"),
            {"id": lesson_trigger_id},
        )
        db.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/lessons/{lesson_id}/read")
async def mark_lesson_read_by_id(lesson_id: int, authorization: str = Header(None)):
    """Fix #18 — server-side read sync by lesson_id."""
    if not authorization or not authorization.startswith("Bearer "):
        return {"status": "skipped", "reason": "unauthenticated"}
    db = Session(engine)
    try:
        db.execute(
            sa.text("UPDATE lessons_triggered SET was_read = 1 WHERE lesson_id = :lid"),
            {"lid": lesson_id},
        )
        db.commit()
        return {"status": "ok", "lesson_id": lesson_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/lessons/complete", response_model=LessonCompletionResponse)
async def complete_lesson(request: LessonCompletionRequest):
    """
    v3 — Record that a user has completed a lesson.
    Writes to lesson_completions (the permanent per-user record) and also
    marks the most recent lessons_triggered row for this lesson as read.

    Both user_id (authenticated) and session_token (anonymous) are accepted.
    At least one must be provided.
    """
    if not request.user_id and not request.session_token:
        raise HTTPException(
            status_code=422,
            detail="Either user_id or session_token is required."
        )

    db = Session(engine)
    try:
        lesson = db.execute(
            sa.text("SELECT id FROM lessons WHERE id = :lid"),
            {"lid": request.lesson_id},
        ).fetchone()
        if not lesson:
            raise HTTPException(status_code=404, detail="Lesson not found.")

        now = datetime.now(timezone.utc)

        db.execute(
            sa.text("""
                INSERT INTO lesson_completions (user_id, session_token, lesson_id, completed_at)
                VALUES (:uid, :tok, :lid, :now)
            """),
            {
                "uid": request.user_id,
                "tok": request.session_token,
                "lid": request.lesson_id,
                "now": now,
            },
        )

        if request.user_id:
            db.execute(
                sa.text("""
                    UPDATE lessons_triggered lt
                    JOIN submissions s ON s.id = lt.submission_id
                    SET lt.was_read = 1
                    WHERE lt.lesson_id = :lid AND s.user_id = :uid AND lt.was_read = 0
                """),
                {"lid": request.lesson_id, "uid": request.user_id},
            )
        else:
            db.execute(
                sa.text("""
                    UPDATE lessons_triggered lt
                    JOIN submissions s ON s.id = lt.submission_id
                    SET lt.was_read = 1
                    WHERE lt.lesson_id = :lid AND s.session_token = :tok AND lt.was_read = 0
                """),
                {"lid": request.lesson_id, "tok": request.session_token},
            )

        db.commit()

        return LessonCompletionResponse(
            lesson_id    = request.lesson_id,
            completed_at = now.isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
