"""
SocialProof — Router: Admin Dashboard  v4.0

Endpoints:
  Platform health
    GET  /admin/stats                     — user counts, eval totals, DAU/WAU

  Quiz management (new)
    GET  /admin/quiz/questions            — list all questions (filterable)
    POST /admin/quiz/questions            — create a question
    PUT  /admin/quiz/questions/{id}       — edit a question
    DELETE /admin/quiz/questions/{id}     — delete a question
    GET  /admin/quiz/questions/{id}/stats — per-question accuracy stats

  Lesson management
    GET  /admin/lessons                   — list lessons with trigger stats
    POST /admin/lessons                   — create a lesson
    PUT  /admin/lessons/{id}              — edit a lesson
    DELETE /admin/lessons/{id}            — delete a lesson
    GET  /admin/lessons/impact            — trigger counts + read rate per lesson

  User management
    GET  /admin/users                     — list all users
    PUT  /admin/users/{id}/role           — promote / demote role
    DELETE /admin/users/{id}              — deactivate / delete account

  Research & analytics
    GET  /admin/analytics/skills          — aggregate MIL skill level distribution
    GET  /admin/analytics/lessons-heatmap — lesson trigger heatmap across all users
    GET  /admin/analytics/pretest         — pre-test vs post-test improvement
    GET  /admin/analytics/quiz            — quiz accuracy by topic & difficulty

  Corpus management
    POST /admin/corpus/ingest             — save curated sentences to corpus.db
    GET  /admin/corpus/stats              — sentence count, sources, pipelines

  API & data health
    GET  /admin/api-usage                 — factcheck cache, MBFC coverage, system accuracy
    POST /admin/mbfc/sync                 — trigger MBFC sync (runs sync_mbfc.py)

Removed vs v3:
  - GET /admin/submissions     (submission browsing)
  - GET /admin/research-metrics (re-evaluation / correction-rate metrics removed)
  - system_score, system_label, user_label, confidence fields never returned
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import uuid
import bcrypt
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Header, Request, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config import logger
from database.models import engine
from routers.auth import _verify

_CORPUS_DB = Path(__file__).resolve().parent / "data" / "corpus.db"

router = APIRouter(prefix="/admin")


# ── Auth helper ───────────────────────────────────────────────────────────────

def _require_admin(authorization: Optional[str], request: Request = None):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
    elif request is not None:
        token = request.cookies.get("sp_jwt")
    if not token:
        raise HTTPException(status_code=401, detail="Authorization required.")
    payload = _verify(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return payload


# ── File Upload ───────────────────────────────────────────────────────────────

_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "assets" / "uploads"
_ALLOWED_EXTENSIONS = {
    # images
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
    # video
    ".mp4", ".webm", ".mov", ".avi",
    # documents / files
    ".pdf", ".doc", ".docx", ".txt", ".csv",
}
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


@router.post("/upload")
async def upload_media(
    file:          UploadFile      = File(...),
    request:       Request         = None,
    authorization: str             = Header(None),
):
    """
    Upload an image, video, or file for use in quiz / prebunking questions.
    Returns { url, filename, media_type, size }.
    Files are stored under assets/uploads/ and served at /assets/uploads/<filename>.
    """
    _require_admin(authorization, request)

    suffix = Path(file.filename or "upload").suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"File type '{suffix}' not allowed. Allowed: {sorted(_ALLOWED_EXTENSIONS)}"
        )

    # Detect media_type from extension
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}:
        detected_type = "image"
    elif suffix in {".mp4", ".webm", ".mov", ".avi"}:
        detected_type = "video"
    else:
        detected_type = "file"

    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    unique_name = f"{uuid.uuid4().hex}{suffix}"
    dest = _UPLOAD_DIR / unique_name

    size = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(64 * 1024):
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File exceeds 50 MB limit.")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    url = f"/assets/uploads/{unique_name}"
    logger.info(f"[Upload] Saved {unique_name} ({size} bytes, {detected_type})")
    return {"url": url, "filename": unique_name, "media_type": detected_type, "size": size}


# ── Pydantic models ───────────────────────────────────────────────────────────

class QuizQuestionCreate(BaseModel):
    lesson_id:     Optional[int]  = None
    question_text: str            = Field(..., min_length=10)
    options:       List[str]      = Field(..., min_items=2, max_items=6)
    correct_index: int            = Field(..., ge=0)
    explanation:   Optional[str]  = None
    topic:         str            = Field(..., description="claim_detection|source_verification|bias_detection|evidence_evaluation|general")
    difficulty:    str            = Field("beginner", description="beginner|intermediate|advanced")
    image_url:     Optional[str]  = Field(None, max_length=512, description="Optional URL to a scenario image")
    video_url:     Optional[str]  = Field(None, max_length=1024, description="Optional URL to a video (YouTube embed, mp4, etc.)")
    media_type:    str            = Field("text", description="text|image|video|file")


class QuizQuestionUpdate(BaseModel):
    lesson_id:     Optional[int]  = None
    question_text: Optional[str]  = None
    options:       Optional[List[str]] = None
    correct_index: Optional[int]  = None
    explanation:   Optional[str]  = None
    topic:         Optional[str]  = None
    difficulty:    Optional[str]  = None
    image_url:     Optional[str]  = Field(None, max_length=512)
    video_url:     Optional[str]  = Field(None, max_length=1024)
    media_type:    Optional[str]  = None


class LessonCreate(BaseModel):
    lesson_key:             str           = Field(..., min_length=3, max_length=100)
    title:                  str           = Field(..., min_length=3, max_length=255)
    content:                str           = Field(..., min_length=10)
    topic:                  str
    difficulty:             str           = "beginner"
    mil_skill:              Optional[str] = None
    sort_order:             Optional[int] = None
    prerequisite_lesson_id: Optional[int] = None
    image_url:              Optional[str] = Field(None, max_length=512)


class LessonUpdate(BaseModel):
    title:                  Optional[str] = None
    content:                Optional[str] = None
    topic:                  Optional[str] = None
    difficulty:             Optional[str] = None
    mil_skill:              Optional[str] = None
    sort_order:             Optional[int] = None
    prerequisite_lesson_id: Optional[int] = None
    image_url:              Optional[str] = Field(None, max_length=512)


class RoleUpdate(BaseModel):
    role: str = Field(..., description="user | admin")


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email:    str = Field(..., min_length=5, max_length=150)
    password: str = Field(..., min_length=6)
    role:     str = Field("user", description="user | admin")


class UserUpdate(BaseModel):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email:    Optional[str] = Field(None, min_length=5, max_length=150)
    password: Optional[str] = Field(None, min_length=6)
    role:     Optional[str] = None


class PrebunkingTechniqueCreate(BaseModel):
    technique_id: str            = Field(..., min_length=2, max_length=64,
                                         description="Snake_case identifier, e.g. 'appeal_to_nature'")
    name:         str            = Field(..., min_length=2, max_length=255)
    description:  Optional[str] = None
    module:       Optional[int] = None
    sort_order:   int            = Field(0, ge=0)
    is_active:    bool           = True


class PrebunkingTechniqueUpdate(BaseModel):
    name:        Optional[str]  = None
    description: Optional[str] = None
    module:      Optional[int] = None
    sort_order:  Optional[int] = None
    is_active:   Optional[bool] = None


class PrebunkingQuestionCreate(BaseModel):
    technique_id:  str            = Field(..., description="Must match a technique_id in prebunking_techniques")
    question_text: str            = Field(..., min_length=10)
    option_a:      str            = Field(..., min_length=1)
    option_b:      str            = Field(..., min_length=1)
    option_c:      str            = Field(..., min_length=1)
    option_d:      str            = Field(..., min_length=1)
    correct_answer: str           = Field(..., description="A, B, C, or D")
    explanation:   Optional[str]  = None
    image_url:     Optional[str]  = Field(None, max_length=512, description="Optional URL to a scenario image")
    video_url:     Optional[str]  = Field(None, max_length=1024, description="Optional URL to a video")
    media_type:    str            = Field("text", description="text|image|video|file")


class PrebunkingQuestionUpdate(BaseModel):
    technique_id:  Optional[str] = None
    question_text: Optional[str] = None
    option_a:      Optional[str] = None
    option_b:      Optional[str] = None
    option_c:      Optional[str] = None
    option_d:      Optional[str] = None
    correct_answer: Optional[str] = None
    explanation:   Optional[str] = None
    image_url:     Optional[str] = Field(None, max_length=512)
    video_url:     Optional[str] = Field(None, max_length=1024)
    media_type:    Optional[str] = None


class CorpusIngestRequest(BaseModel):
    sentences:     List[str]
    source_domain: str
    source_name:   str
    url:           Optional[str] = ""
    pipeline:      str           = "stats"
    reputation:    float         = 0.95



    sentences:     List[str]
    source_domain: str
    source_name:   str
    url:           Optional[str] = ""
    pipeline:      str           = "stats"
    reputation:    float         = 0.95


# ══════════════════════════════════════════════════════════════════════════════
# PLATFORM HEALTH
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/stats")
async def get_admin_stats(request: Request, authorization: str = Header(None)):
    """Platform health overview — user counts, eval totals, DAU/WAU."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        overview = db.execute(sa.text("""
            SELECT
                (SELECT COUNT(*) FROM users WHERE role = 'user')          AS total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'admin')         AS total_admins,
                (SELECT COUNT(*) FROM submissions)                        AS total_submissions,
                (SELECT COUNT(*) FROM submissions WHERE user_id IS NULL)  AS anonymous_submissions,
                (SELECT COUNT(*) FROM lesson_completions)                 AS total_lesson_completions,
                (SELECT COUNT(*) FROM quiz_attempts)                      AS total_quiz_attempts,
                (SELECT COUNT(*) FROM lessons_triggered WHERE was_read=1) AS lessons_read,
                (SELECT COUNT(*) FROM lessons_triggered)                  AS lessons_triggered_total
        """)).fetchone()

        # DAU — distinct users with any activity in the last 7 days
        dau_rows = db.execute(sa.text("""
            SELECT DATE(created_at) AS day, COUNT(DISTINCT user_id) AS active_users
            FROM submissions
            WHERE user_id IS NOT NULL
              AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """)).fetchall()

        # New user registrations per day (last 14 days)
        reg_rows = db.execute(sa.text("""
            SELECT DATE(created_at) AS day, COUNT(*) AS new_users
            FROM users
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        """)).fetchall()

        lesson_read_rate = 0.0
        total_triggered = overview.lessons_triggered_total or 0
        if total_triggered > 0:
            lesson_read_rate = round((overview.lessons_read or 0) / total_triggered * 100, 1)

        return {
            "overview": {
                "total_users":               overview.total_users or 0,
                "total_admins":              overview.total_admins or 0,
                "total_submissions":         overview.total_submissions or 0,
                "anonymous_submissions":     overview.anonymous_submissions or 0,
                "total_lesson_completions":  overview.total_lesson_completions or 0,
                "total_quiz_attempts":       overview.total_quiz_attempts or 0,
                "lesson_read_rate_pct":      lesson_read_rate,
            },
            "dau_7d":           [{"day": str(r.day), "active_users": r.active_users} for r in dau_rows],
            "registrations_14d":[{"day": str(r.day), "new_users": r.new_users} for r in reg_rows],
        }
    finally:
        db.close()


@router.get("/topics")
async def list_topics(request: Request, authorization: str = Header(None)):
    """Return all distinct topics used in lessons and quiz_questions."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        lesson_topics = db.execute(sa.text("SELECT DISTINCT topic FROM lessons WHERE topic IS NOT NULL")).fetchall()
        quiz_topics   = db.execute(sa.text("SELECT DISTINCT topic FROM quiz_questions WHERE topic IS NOT NULL")).fetchall()
        topics = sorted(set(r[0] for r in lesson_topics) | set(r[0] for r in quiz_topics))
        return {"topics": topics}
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# QUIZ MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/quiz/questions")
async def list_quiz_questions(
    topic:      Optional[str] = None,
    difficulty: Optional[str] = None,
    lesson_id:  Optional[int] = None,
    request:    Request       = None,
    authorization: str        = Header(None),
):
    """List all quiz questions with optional filters."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        base = """
            SELECT q.*, l.title AS lesson_title,
                   COUNT(qa.id) AS attempt_count,
                   ROUND(AVG(qa.is_correct) * 100, 1) AS accuracy_pct
            FROM quiz_questions q
            LEFT JOIN lessons l ON l.id = q.lesson_id
            LEFT JOIN quiz_attempts qa ON qa.question_id = q.id
        """
        wheres, params = [], {}
        if topic:
            wheres.append("q.topic = :topic"); params["topic"] = topic
        if difficulty:
            wheres.append("q.difficulty = :difficulty"); params["difficulty"] = difficulty
        if lesson_id:
            wheres.append("q.lesson_id = :lesson_id"); params["lesson_id"] = lesson_id
        if wheres:
            base += " WHERE " + " AND ".join(wheres)
        base += " GROUP BY q.id ORDER BY q.topic, q.difficulty, q.id"
        rows = db.execute(sa.text(base), params).fetchall()
        result = []
        for r in rows:
            row = dict(r._mapping)
            if isinstance(row.get("options"), str):
                try:
                    row["options"] = json.loads(row["options"])
                except Exception:
                    pass
            result.append(row)
        return result
    finally:
        db.close()


@router.post("/quiz/questions", status_code=201)
async def create_quiz_question(
    body:          QuizQuestionCreate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Create a new quiz question."""
    _require_admin(authorization, request)
    valid_diffs  = {"beginner", "intermediate", "advanced"}
    if not body.topic or not body.topic.strip():
        raise HTTPException(status_code=422, detail="Topic is required.")
    if body.difficulty not in valid_diffs:
        raise HTTPException(status_code=422, detail=f"Invalid difficulty. Must be one of: {', '.join(valid_diffs)}")
    if body.correct_index >= len(body.options):
        raise HTTPException(status_code=422, detail="correct_index out of range for given options list.")
    if body.lesson_id:
        db = Session(engine)
        lesson = db.execute(sa.text("SELECT id FROM lessons WHERE id = :id"), {"id": body.lesson_id}).fetchone()
        db.close()
        if not lesson:
            raise HTTPException(status_code=404, detail="lesson_id not found.")
    db = Session(engine)
    try:
        result = db.execute(sa.text("""
            INSERT INTO quiz_questions (lesson_id, question_text, options, correct_index, explanation, topic, difficulty, image_url, video_url, media_type)
            VALUES (:lesson_id, :question_text, :options, :correct_index, :explanation, :topic, :difficulty, :image_url, :video_url, :media_type)
        """), {
            "lesson_id":     body.lesson_id,
            "question_text": body.question_text,
            "options":       json.dumps(body.options),
            "correct_index": body.correct_index,
            "explanation":   body.explanation,
            "topic":         body.topic,
            "difficulty":    body.difficulty,
            "image_url":     body.image_url,
            "video_url":     body.video_url,
            "media_type":    body.media_type or "text",
        })
        db.commit()
        new_id = result.lastrowid
        row = db.execute(sa.text("SELECT * FROM quiz_questions WHERE id = :id"), {"id": new_id}).fetchone()
        out = dict(row._mapping)
        if isinstance(out.get("options"), str):
            out["options"] = json.loads(out["options"])
        return out
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/quiz/questions/{question_id}")
async def update_quiz_question(
    question_id:   int,
    body:          QuizQuestionUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Edit an existing quiz question."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT * FROM quiz_questions WHERE id = :id"), {"id": question_id}
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Question not found.")

        fields, params = [], {"id": question_id}
        if body.question_text is not None:
            fields.append("question_text = :question_text"); params["question_text"] = body.question_text
        if body.options is not None:
            # Validate correct_index against new options if both provided
            ci = body.correct_index if body.correct_index is not None else existing.correct_index
            if ci >= len(body.options):
                raise HTTPException(status_code=422, detail="correct_index out of range for given options.")
            fields.append("options = :options"); params["options"] = json.dumps(body.options)
        if body.correct_index is not None:
            fields.append("correct_index = :correct_index"); params["correct_index"] = body.correct_index
        if body.explanation is not None:
            fields.append("explanation = :explanation"); params["explanation"] = body.explanation
        if body.topic is not None:
            fields.append("topic = :topic"); params["topic"] = body.topic
        if body.difficulty is not None:
            fields.append("difficulty = :difficulty"); params["difficulty"] = body.difficulty
        if body.lesson_id is not None:
            fields.append("lesson_id = :lesson_id"); params["lesson_id"] = body.lesson_id
        if body.image_url is not None:
            fields.append("image_url = :image_url"); params["image_url"] = body.image_url
        if body.video_url is not None:
            fields.append("video_url = :video_url"); params["video_url"] = body.video_url
        if body.media_type is not None:
            fields.append("media_type = :media_type"); params["media_type"] = body.media_type

        if not fields:
            return {"detail": "Nothing to update."}

        db.execute(sa.text(f"UPDATE quiz_questions SET {', '.join(fields)} WHERE id = :id"), params)
        db.commit()
        row = db.execute(sa.text("SELECT * FROM quiz_questions WHERE id = :id"), {"id": question_id}).fetchone()
        out = dict(row._mapping)
        if isinstance(out.get("options"), str):
            out["options"] = json.loads(out["options"])
        return out
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/quiz/questions/{question_id}", status_code=204)
async def delete_quiz_question(
    question_id:   int,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Delete a quiz question and all its attempt records."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id FROM quiz_questions WHERE id = :id"), {"id": question_id}
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Question not found.")
        db.execute(sa.text("DELETE FROM quiz_questions WHERE id = :id"), {"id": question_id})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.get("/quiz/questions/{question_id}/stats")
async def get_question_stats(
    question_id:   int,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Per-question accuracy breakdown — how many users got it right, wrong, and per option."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        q = db.execute(
            sa.text("SELECT * FROM quiz_questions WHERE id = :id"), {"id": question_id}
        ).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="Question not found.")

        attempts_row = db.execute(sa.text("""
            SELECT
                COUNT(*)                                        AS total_attempts,
                SUM(is_correct)                                 AS correct_count,
                ROUND(AVG(is_correct) * 100, 1)                AS accuracy_pct,
                COUNT(DISTINCT user_id)                         AS unique_users
            FROM quiz_attempts
            WHERE question_id = :qid
        """), {"qid": question_id}).fetchone()

        option_rows = db.execute(sa.text("""
            SELECT selected_index, COUNT(*) AS count
            FROM quiz_attempts
            WHERE question_id = :qid
            GROUP BY selected_index
            ORDER BY selected_index
        """), {"qid": question_id}).fetchall()

        options = json.loads(q.options) if isinstance(q.options, str) else (q.options or [])
        option_breakdown = []
        option_counts = {r.selected_index: r.count for r in option_rows}
        total = attempts_row.total_attempts or 0
        for i, opt_text in enumerate(options):
            cnt = option_counts.get(i, 0)
            option_breakdown.append({
                "index":      i,
                "text":       opt_text,
                "is_correct": i == q.correct_index,
                "count":      cnt,
                "pct":        round(cnt / total * 100, 1) if total > 0 else 0,
            })

        return {
            "question_id":    question_id,
            "question_text":  q.question_text,
            "topic":          q.topic,
            "difficulty":     q.difficulty,
            "total_attempts": total,
            "correct_count":  attempts_row.correct_count or 0,
            "accuracy_pct":   attempts_row.accuracy_pct or 0,
            "unique_users":   attempts_row.unique_users or 0,
            "option_breakdown": option_breakdown,
        }
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# LESSON MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/lessons")
async def admin_list_lessons(request: Request, authorization: str = Header(None)):
    """List all lessons with trigger counts and read rates."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        rows = db.execute(sa.text("""
            SELECT
                l.*,
                COUNT(DISTINCT lt.id)               AS trigger_count,
                SUM(lt.was_read)                    AS read_count,
                ROUND(AVG(lt.was_read) * 100, 1)    AS read_rate_pct,
                COUNT(DISTINCT lc.id)               AS completion_count,
                COUNT(DISTINCT qq.id)               AS question_count
            FROM lessons l
            LEFT JOIN lessons_triggered lt ON lt.lesson_id = l.id
            LEFT JOIN lesson_completions lc ON lc.lesson_id = l.id
            LEFT JOIN quiz_questions qq ON qq.lesson_id = l.id
            GROUP BY l.id
            ORDER BY COALESCE(l.sort_order, 9999), l.topic, l.id
        """)).fetchall()
        return [dict(r._mapping) for r in rows]
    finally:
        db.close()


@router.post("/lessons", status_code=201)
async def create_lesson(
    body:          LessonCreate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Create a new lesson."""
    _require_admin(authorization, request)
    valid_diffs  = {"beginner", "intermediate", "advanced"}
    if not body.topic or not body.topic.strip():
        raise HTTPException(status_code=422, detail="Topic is required.")
    if body.difficulty not in valid_diffs:
        raise HTTPException(status_code=422, detail=f"Invalid difficulty.")
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id FROM lessons WHERE lesson_key = :k"), {"k": body.lesson_key}
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="lesson_key already exists.")
        result = db.execute(sa.text("""
            INSERT INTO lessons (lesson_key, title, content, topic, difficulty, mil_skill, sort_order, prerequisite_lesson_id, image_url, created_at)
            VALUES (:lesson_key, :title, :content, :topic, :difficulty, :mil_skill, :sort_order, :prereq, :image_url, :now)
        """), {
            "lesson_key": body.lesson_key, "title": body.title, "content": body.content,
            "topic": body.topic, "difficulty": body.difficulty, "mil_skill": body.mil_skill,
            "sort_order": body.sort_order, "prereq": body.prerequisite_lesson_id,
            "image_url": body.image_url, "now": datetime.now(timezone.utc),
        })
        db.commit()
        row = db.execute(sa.text("SELECT * FROM lessons WHERE id = :id"), {"id": result.lastrowid}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/lessons/{lesson_id}")
async def update_lesson(
    lesson_id:     int,
    body:          LessonUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Edit an existing lesson."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(sa.text("SELECT id FROM lessons WHERE id = :id"), {"id": lesson_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Lesson not found.")
        fields, params = [], {"id": lesson_id}
        _LESSON_UPDATE_ALLOWED_COLS = {"title", "content", "topic", "difficulty", "mil_skill", "sort_order"}
        for col in ["title", "content", "topic", "difficulty", "mil_skill", "sort_order"]:
            assert col in _LESSON_UPDATE_ALLOWED_COLS, f"Unexpected column: {col}"
            val = getattr(body, col)
            if val is not None:
                fields.append(f"{col} = :{col}"); params[col] = val
        if body.prerequisite_lesson_id is not None:
            fields.append("prerequisite_lesson_id = :prereq"); params["prereq"] = body.prerequisite_lesson_id
        if body.image_url is not None:
            fields.append("image_url = :image_url"); params["image_url"] = body.image_url
        if not fields:
            return {"detail": "Nothing to update."}
        db.execute(sa.text(f"UPDATE lessons SET {', '.join(fields)} WHERE id = :id"), params)
        db.commit()
        row = db.execute(sa.text("SELECT * FROM lessons WHERE id = :id"), {"id": lesson_id}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/lessons/{lesson_id}", status_code=204)
async def delete_lesson(
    lesson_id:     int,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Delete a lesson. Will fail if quiz questions are still linked to it."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(sa.text("SELECT id FROM lessons WHERE id = :id"), {"id": lesson_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Lesson not found.")
        linked = db.execute(
            sa.text("SELECT COUNT(*) FROM quiz_questions WHERE lesson_id = :id"), {"id": lesson_id}
        ).scalar()
        if linked:
            raise HTTPException(status_code=409, detail=f"Cannot delete: {linked} quiz question(s) are linked to this lesson. Remove them first.")
        db.execute(sa.text("DELETE FROM lessons WHERE id = :id"), {"id": lesson_id})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.get("/lessons/impact")
async def get_lesson_impact(request: Request, authorization: str = Header(None)):
    """Lesson impact: trigger count, read rate, completion count."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        rows = db.execute(sa.text("""
            SELECT
                l.id, l.lesson_key, l.title, l.topic, l.difficulty,
                COUNT(DISTINCT lt.id)               AS trigger_count,
                SUM(COALESCE(lt.was_read, 0))       AS read_count,
                ROUND(AVG(COALESCE(lt.was_read,0)) * 100, 1) AS read_rate_pct,
                COUNT(DISTINCT lc.id)               AS completion_count
            FROM lessons l
            LEFT JOIN lessons_triggered lt ON lt.lesson_id = l.id
            LEFT JOIN lesson_completions lc ON lc.lesson_id = l.id
            GROUP BY l.id, l.lesson_key, l.title, l.topic, l.difficulty
            ORDER BY trigger_count DESC
        """)).fetchall()
        return [dict(r._mapping) for r in rows]
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# USER MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/users")
async def list_users(request: Request, authorization: str = Header(None)):
    """List all users with activity stats."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        rows = db.execute(sa.text("""
            SELECT
                u.id, u.username, u.email, u.role, u.created_at,
                COUNT(DISTINCT s.id)  AS submission_count,
                COUNT(DISTINCT lc.id) AS lessons_completed,
                COUNT(DISTINCT qa.id) AS quiz_attempts,
                MAX(s.created_at)     AS last_active_at
            FROM users u
            LEFT JOIN submissions        s  ON s.user_id  = u.id
            LEFT JOIN lesson_completions lc ON lc.user_id = u.id
            LEFT JOIN quiz_attempts      qa ON qa.user_id  = u.id
            GROUP BY u.id, u.username, u.email, u.role, u.created_at
            ORDER BY u.created_at DESC
        """)).fetchall()
        result = []
        for r in rows:
            row = dict(r._mapping)
            row["created_at"]     = str(row["created_at"])    if row.get("created_at")     else None
            row["last_active_at"] = str(row["last_active_at"]) if row.get("last_active_at") else None
            result.append(row)
        return result
    finally:
        db.close()


@router.post("/users", status_code=201)
async def create_user(
    body:          UserCreate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Create a new user account (admin-side)."""
    _require_admin(authorization, request)
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=422, detail="Role must be 'user' or 'admin'.")
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    db = Session(engine)
    try:
        exists = db.execute(
            sa.text("SELECT id FROM users WHERE email=:e OR username=:u"),
            {"e": body.email, "u": body.username},
        ).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="Email or username already taken.")
        result = db.execute(sa.text("""
            INSERT INTO users (username, email, password_hash, role, created_at, updated_at)
            VALUES (:username, :email, :pw, :role, :now, :now)
        """), {"username": body.username, "email": body.email, "pw": pw_hash,
               "role": body.role, "now": datetime.now(timezone.utc)})
        db.commit()
        row = db.execute(sa.text(
            "SELECT id, username, email, role, created_at FROM users WHERE id = :id"
        ), {"id": result.lastrowid}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/users/{user_id}")
async def update_user(
    user_id:       int,
    body:          UserUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Edit a user's username, email, password, or role."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id, role FROM users WHERE id = :id"), {"id": user_id}
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found.")
        if body.role and body.role not in ("user", "admin"):
            raise HTTPException(status_code=422, detail="Role must be 'user' or 'admin'.")
        # Prevent demoting the last admin
        if body.role == "user" and existing.role == "admin":
            admin_count = db.execute(sa.text("SELECT COUNT(*) FROM users WHERE role='admin'")).scalar()
            if admin_count <= 1:
                raise HTTPException(status_code=409, detail="Cannot demote the last admin account.")
        fields, params = [], {"id": user_id}
        if body.username is not None:
            # Check uniqueness
            clash = db.execute(sa.text(
                "SELECT id FROM users WHERE username=:u AND id != :id"
            ), {"u": body.username, "id": user_id}).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="Username already taken.")
            fields.append("username = :username"); params["username"] = body.username
        if body.email is not None:
            clash = db.execute(sa.text(
                "SELECT id FROM users WHERE email=:e AND id != :id"
            ), {"e": body.email, "id": user_id}).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="Email already taken.")
            fields.append("email = :email"); params["email"] = body.email
        if body.password is not None:
            pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
            fields.append("password_hash = :pw"); params["pw"] = pw_hash
        if body.role is not None:
            fields.append("role = :role"); params["role"] = body.role
        fields.append("updated_at = :now"); params["now"] = datetime.now(timezone.utc)
        if len(fields) == 1:  # only updated_at
            return {"detail": "Nothing to update."}
        db.execute(sa.text(f"UPDATE users SET {', '.join(fields)} WHERE id = :id"), params)
        db.commit()
        row = db.execute(sa.text(
            "SELECT id, username, email, role, created_at FROM users WHERE id = :id"
        ), {"id": user_id}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id:       int,
    body:          RoleUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Promote or demote a user's role."""
    _require_admin(authorization, request)
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=422, detail="Role must be 'user' or 'admin'.")
    db = Session(engine)
    try:
        existing = db.execute(sa.text("SELECT id FROM users WHERE id = :id"), {"id": user_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found.")
        db.execute(sa.text("UPDATE users SET role = :role WHERE id = :id"), {"role": body.role, "id": user_id})
        db.commit()
        return {"user_id": user_id, "role": body.role}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id:       int,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Delete a user account and all associated data."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(sa.text("SELECT id, role FROM users WHERE id = :id"), {"id": user_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found.")
        if existing.role == "admin":
            # Prevent deleting the last admin
            admin_count = db.execute(sa.text("SELECT COUNT(*) FROM users WHERE role = 'admin'")).scalar()
            if admin_count <= 1:
                raise HTTPException(status_code=409, detail="Cannot delete the last admin account.")
        db.execute(sa.text("DELETE FROM users WHERE id = :id"), {"id": user_id})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# RESEARCH & ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/analytics/skills")
async def get_skill_distribution(request: Request, authorization: str = Header(None)):
    """Aggregate MIL skill level distribution across all users."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        rows = db.execute(sa.text("""
            SELECT
                topic,
                current_level,
                COUNT(*) AS user_count,
                ROUND(AVG(COALESCE(quiz_accuracy_pct, 0)), 1) AS avg_quiz_accuracy,
                SUM(lessons_completed) AS total_lessons_completed
            FROM user_skill_progress
            GROUP BY topic, current_level
            ORDER BY topic, FIELD(current_level, 'beginner', 'intermediate', 'advanced')
        """)).fetchall()

        # Also get top weak topics from lesson triggers
        weak_topics = db.execute(sa.text("""
            SELECT l.topic, COUNT(*) AS trigger_count
            FROM lessons_triggered lt
            JOIN lessons l ON l.id = lt.lesson_id
            GROUP BY l.topic
            ORDER BY trigger_count DESC
        """)).fetchall()

        return {
            "skill_distribution": [dict(r._mapping) for r in rows],
            "weak_topics":        [dict(r._mapping) for r in weak_topics],
        }
    finally:
        db.close()


@router.get("/analytics/lessons-heatmap")
async def get_lessons_heatmap(request: Request, authorization: str = Header(None)):
    """Lesson trigger heatmap — which topics are triggered most, and when."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        by_topic = db.execute(sa.text("""
            SELECT l.topic, l.title, l.lesson_key,
                   COUNT(lt.id) AS trigger_count,
                   SUM(lt.was_read) AS read_count,
                   ROUND(AVG(lt.was_read) * 100, 1) AS read_rate_pct
            FROM lessons l
            LEFT JOIN lessons_triggered lt ON lt.lesson_id = l.id
            GROUP BY l.id, l.topic, l.title, l.lesson_key
            ORDER BY trigger_count DESC
        """)).fetchall()

        by_day = db.execute(sa.text("""
            SELECT DATE(lt.triggered_at) AS day, COUNT(*) AS trigger_count
            FROM lessons_triggered lt
            WHERE lt.triggered_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(lt.triggered_at)
            ORDER BY day ASC
        """)).fetchall()

        return {
            "by_lesson": [dict(r._mapping) for r in by_topic],
            "by_day_30d": [{"day": str(r.day), "trigger_count": r.trigger_count} for r in by_day],
        }
    finally:
        db.close()


@router.get("/analytics/pretest")
async def get_pretest_analytics(request: Request, authorization: str = Header(None)):
    """Pre-test vs post-test improvement stats."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        rows = db.execute(sa.text("""
            SELECT
                phase,
                COUNT(*) AS total_submissions,
                ROUND(AVG(score_pct), 1) AS avg_score_pct,
                ROUND(MIN(score_pct), 1) AS min_score_pct,
                ROUND(MAX(score_pct), 1) AS max_score_pct
            FROM pretest_results
            GROUP BY phase
        """)).fetchall()

        # Users who completed both
        paired = db.execute(sa.text("""
            SELECT
                COUNT(*) AS paired_users,
                ROUND(AVG(post.score_pct - pre.score_pct), 1) AS avg_improvement_pct
            FROM pretest_results pre
            JOIN pretest_results post
              ON post.user_id = pre.user_id
             AND post.phase = 'posttest'
            WHERE pre.phase = 'pretest'
        """)).fetchone()

        return {
            "by_phase":      [dict(r._mapping) for r in rows],
            "paired_users":  paired.paired_users or 0,
            "avg_improvement_pct": paired.avg_improvement_pct,
        }
    finally:
        db.close()


@router.get("/analytics/quiz")
async def get_quiz_analytics(request: Request, authorization: str = Header(None)):
    """Quiz accuracy breakdown by topic and difficulty."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        by_topic = db.execute(sa.text("""
            SELECT
                q.topic,
                COUNT(DISTINCT qa.id)                   AS total_attempts,
                COUNT(DISTINCT qa.user_id)              AS unique_users,
                ROUND(AVG(qa.is_correct) * 100, 1)     AS accuracy_pct
            FROM quiz_attempts qa
            JOIN quiz_questions q ON q.id = qa.question_id
            GROUP BY q.topic
            ORDER BY accuracy_pct ASC
        """)).fetchall()

        by_difficulty = db.execute(sa.text("""
            SELECT
                q.difficulty,
                COUNT(DISTINCT qa.id)                   AS total_attempts,
                ROUND(AVG(qa.is_correct) * 100, 1)     AS accuracy_pct
            FROM quiz_attempts qa
            JOIN quiz_questions q ON q.id = qa.question_id
            GROUP BY q.difficulty
            ORDER BY FIELD(q.difficulty, 'beginner', 'intermediate', 'advanced')
        """)).fetchall()

        # Hardest questions (lowest accuracy, min 5 attempts)
        hardest = db.execute(sa.text("""
            SELECT
                q.id, q.question_text, q.topic, q.difficulty,
                COUNT(qa.id) AS attempts,
                ROUND(AVG(qa.is_correct) * 100, 1) AS accuracy_pct
            FROM quiz_questions q
            JOIN quiz_attempts qa ON qa.question_id = q.id
            GROUP BY q.id, q.question_text, q.topic, q.difficulty
            HAVING attempts >= 5
            ORDER BY accuracy_pct ASC
            LIMIT 10
        """)).fetchall()

        return {
            "by_topic":      [dict(r._mapping) for r in by_topic],
            "by_difficulty": [dict(r._mapping) for r in by_difficulty],
            "hardest_questions": [dict(r._mapping) for r in hardest],
        }
    finally:
        db.close()



# ══════════════════════════════════════════════════════════════════════════════
# PREBUNKING TECHNIQUE MANAGEMENT  (admin-driven, no more hardcoded list)
# ══════════════════════════════════════════════════════════════════════════════

_VALID_ANSWERS = {"A", "B", "C", "D"}


def _ensure_prebunking_tables(conn):
    """Create prebunking_techniques and prebunking_questions tables if missing."""
    conn.execute(sa.text("""
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
    """))
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS prebunking_questions (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            technique_id   VARCHAR(64)  NOT NULL,
            question_text  TEXT         NOT NULL,
            option_a       VARCHAR(500) NOT NULL,
            option_b       VARCHAR(500) NOT NULL,
            option_c       VARCHAR(500) NOT NULL,
            option_d       VARCHAR(500) NOT NULL,
            correct_answer VARCHAR(1)   NOT NULL,
            explanation    TEXT         NULL,
            image_url      VARCHAR(512) NULL,
            created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                               ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_pbq_technique (technique_id)
        )
    """))
    conn.commit()


def _get_valid_technique_ids(db) -> set:
    """Return set of active technique_ids from DB (empty = no validation)."""
    try:
        rows = db.execute(sa.text(
            "SELECT technique_id FROM prebunking_techniques WHERE is_active = 1"
        )).fetchall()
        return {r[0] for r in rows}
    except Exception:
        return set()


# ── Prebunking Technique CRUD ─────────────────────────────────────────────────

@router.get("/prebunking-techniques")
async def list_prebunking_techniques(
    request:       Request = None,
    authorization: str     = Header(None),
):
    """List all prebunking techniques (active and inactive)."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        with engine.begin() as conn:
            _ensure_prebunking_tables(conn)
        rows = db.execute(sa.text(
            "SELECT * FROM prebunking_techniques ORDER BY sort_order, id"
        )).fetchall()
        return [dict(r._mapping) for r in rows]
    finally:
        db.close()


@router.post("/prebunking-techniques", status_code=201)
async def create_prebunking_technique(
    body:          PrebunkingTechniqueCreate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Create a new prebunking technique. technique_id must be unique."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        with engine.begin() as conn:
            _ensure_prebunking_tables(conn)
        result = db.execute(sa.text("""
            INSERT INTO prebunking_techniques
                (technique_id, name, description, module, sort_order, is_active)
            VALUES (:tid, :name, :desc, :mod, :sort, :active)
        """), {
            "tid":    body.technique_id,
            "name":   body.name,
            "desc":   body.description,
            "mod":    body.module,
            "sort":   body.sort_order,
            "active": int(body.is_active),
        })
        db.commit()
        row = db.execute(sa.text(
            "SELECT * FROM prebunking_techniques WHERE id = :id"
        ), {"id": result.lastrowid}).fetchone()
        return dict(row._mapping)
    except Exception as exc:
        db.rollback()
        if "Duplicate entry" in str(exc):
            raise HTTPException(status_code=409, detail=f"technique_id '{body.technique_id}' already exists.")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/prebunking-techniques/{technique_id}")
async def update_prebunking_technique(
    technique_id:  str,
    body:          PrebunkingTechniqueUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Edit a technique (name, description, module, sort_order, is_active)."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(sa.text(
            "SELECT id FROM prebunking_techniques WHERE technique_id = :tid"
        ), {"tid": technique_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Technique not found.")

        fields, params = [], {"tid": technique_id}
        for col, val in [
            ("name",        body.name),
            ("description", body.description),
            ("module",      body.module),
            ("sort_order",  body.sort_order),
        ]:
            if val is not None:
                fields.append(f"{col} = :{col}"); params[col] = val
        if body.is_active is not None:
            fields.append("is_active = :is_active"); params["is_active"] = int(body.is_active)

        if not fields:
            return {"detail": "Nothing to update."}

        db.execute(sa.text(
            f"UPDATE prebunking_techniques SET {', '.join(fields)} WHERE technique_id = :tid"
        ), params)
        db.commit()
        row = db.execute(sa.text(
            "SELECT * FROM prebunking_techniques WHERE technique_id = :tid"
        ), {"tid": technique_id}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/prebunking-techniques/{technique_id}", status_code=204)
async def delete_prebunking_technique(
    technique_id:  str,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """
    Hard-delete a technique. Prefer PUT is_active=false to preserve question history.
    Associated questions are NOT auto-deleted.
    """
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(sa.text(
            "SELECT id FROM prebunking_techniques WHERE technique_id = :tid"
        ), {"tid": technique_id}).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Technique not found.")
        db.execute(sa.text(
            "DELETE FROM prebunking_techniques WHERE technique_id = :tid"
        ), {"tid": technique_id})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


# ── Prebunking Question CRUD ──────────────────────────────────────────────────

@router.get("/prebunking-questions")
async def list_prebunking_questions(
    technique_id:  Optional[str] = None,
    request:       Request       = None,
    authorization: str           = Header(None),
):
    """List all prebunking questions with optional technique filter."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        with engine.begin() as conn:
            _ensure_prebunking_tables(conn)
        base   = "SELECT * FROM prebunking_questions"
        params = {}
        if technique_id:
            base += " WHERE technique_id = :tid"; params["tid"] = technique_id
        base += " ORDER BY technique_id, id"
        rows = db.execute(sa.text(base), params).fetchall()
        return [dict(r._mapping) for r in rows]
    finally:
        db.close()


@router.post("/prebunking-questions", status_code=201)
async def create_prebunking_question(
    body:          PrebunkingQuestionCreate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Create a new prebunking question. technique_id validated against DB."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        with engine.begin() as conn:
            _ensure_prebunking_tables(conn)
        valid = _get_valid_technique_ids(db)
        if valid and body.technique_id not in valid:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid technique_id '{body.technique_id}'. Valid: {sorted(valid)}"
            )
        if body.correct_answer.upper() not in _VALID_ANSWERS:
            raise HTTPException(status_code=422, detail="correct_answer must be A, B, C, or D.")
        result = db.execute(sa.text("""
            INSERT INTO prebunking_questions
                (technique_id, question_text, option_a, option_b, option_c, option_d,
                 correct_answer, explanation, image_url, video_url, media_type, created_at, updated_at)
            VALUES (:tid, :qtxt, :a, :b, :c, :d, :ans, :expl, :img, :vid, :mtype, :now, :now)
        """), {
            "tid":   body.technique_id, "qtxt": body.question_text,
            "a":     body.option_a,     "b":    body.option_b,
            "c":     body.option_c,     "d":    body.option_d,
            "ans":   body.correct_answer.upper(),
            "expl":  body.explanation,  "img":  body.image_url,
            "vid":   body.video_url,    "mtype": body.media_type or "text",
            "now":   datetime.now(timezone.utc),
        })
        db.commit()
        row = db.execute(sa.text(
            "SELECT * FROM prebunking_questions WHERE id = :id"
        ), {"id": result.lastrowid}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.put("/prebunking-questions/{question_id}")
async def update_prebunking_question(
    question_id:   int,
    body:          PrebunkingQuestionUpdate,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Edit an existing prebunking question, including image_url."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id FROM prebunking_questions WHERE id = :id"), {"id": question_id}
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Prebunking question not found.")
        valid = _get_valid_technique_ids(db)
        if body.technique_id and valid and body.technique_id not in valid:
            raise HTTPException(status_code=422, detail="Invalid technique_id.")
        if body.correct_answer and body.correct_answer.upper() not in _VALID_ANSWERS:
            raise HTTPException(status_code=422, detail="correct_answer must be A, B, C, or D.")

        fields, params = [], {"id": question_id, "now": datetime.now(timezone.utc)}
        for col, val in [
            ("technique_id",  body.technique_id),
            ("question_text", body.question_text),
            ("option_a",      body.option_a),
            ("option_b",      body.option_b),
            ("option_c",      body.option_c),
            ("option_d",      body.option_d),
            ("explanation",   body.explanation),
            ("image_url",     body.image_url),
            ("video_url",     body.video_url),
            ("media_type",    body.media_type),
        ]:
            if val is not None:
                fields.append(f"{col} = :{col}"); params[col] = val
        if body.correct_answer is not None:
            fields.append("correct_answer = :correct_answer")
            params["correct_answer"] = body.correct_answer.upper()
        fields.append("updated_at = :now")

        if len(fields) == 1:
            return {"detail": "Nothing to update."}

        db.execute(sa.text(
            f"UPDATE prebunking_questions SET {', '.join(fields)} WHERE id = :id"
        ), params)
        db.commit()
        row = db.execute(sa.text(
            "SELECT * FROM prebunking_questions WHERE id = :id"
        ), {"id": question_id}).fetchone()
        return dict(row._mapping)
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()


@router.delete("/prebunking-questions/{question_id}", status_code=204)
async def delete_prebunking_question(
    question_id:   int,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Delete a prebunking question."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        existing = db.execute(
            sa.text("SELECT id FROM prebunking_questions WHERE id = :id"), {"id": question_id}
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Prebunking question not found.")
        db.execute(sa.text("DELETE FROM prebunking_questions WHERE id = :id"), {"id": question_id})
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        db.close()



@router.post("/corpus/ingest")
async def corpus_ingest(
    req:           CorpusIngestRequest,
    request:       Request = None,
    authorization: str     = Header(None),
):
    """Save manually curated sentences to corpus.db."""
    _require_admin(authorization, request)
    if not req.sentences:
        raise HTTPException(status_code=422, detail="No sentences provided.")
    rep = max(0.0, min(1.0, req.reputation))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if not _CORPUS_DB.exists():
        _CORPUS_DB.parent.mkdir(parents=True, exist_ok=True)
    try:
        con = sqlite3.connect(str(_CORPUS_DB))
        cur = con.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sentences (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                text          TEXT    NOT NULL,
                source_domain TEXT,
                source_name   TEXT,
                url           TEXT,
                pipeline      TEXT,
                reputation    REAL,
                date_added    TEXT
            )
        """)
        inserted = skipped = 0
        for text in req.sentences:
            text = text.strip()
            if not text:
                continue
            if cur.execute("SELECT 1 FROM sentences WHERE text = ? LIMIT 1", (text,)).fetchone():
                skipped += 1
                continue
            cur.execute(
                "INSERT INTO sentences (text, source_domain, source_name, url, pipeline, reputation, date_added) VALUES (?,?,?,?,?,?,?)",
                (text, req.source_domain, req.source_name, req.url or "", req.pipeline, rep, now),
            )
            inserted += 1
        con.commit()
        con.close()
        return {"inserted": inserted, "skipped": skipped, "source_domain": req.source_domain}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"corpus.db write failed: {exc}")


@router.get("/corpus/stats")
async def corpus_stats(request: Request, authorization: str = Header(None)):
    """Return summary of corpus.db contents."""
    _require_admin(authorization, request)
    if not _CORPUS_DB.exists():
        return {"total_sentences": 0, "sources": 0, "pipelines": ""}
    try:
        con = sqlite3.connect(str(_CORPUS_DB))
        cur = con.cursor()
        total   = cur.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
        sources = cur.execute("SELECT COUNT(DISTINCT source_domain) FROM sentences").fetchone()[0]
        pip_rows = cur.execute("SELECT pipeline, COUNT(*) AS n FROM sentences GROUP BY pipeline ORDER BY n DESC").fetchall()
        con.close()
        return {
            "total_sentences": total,
            "sources":         sources,
            "pipelines":       " · ".join(f"{p}:{n}" for p, n in pip_rows) if pip_rows else "",
        }
    except Exception as exc:
        return {"total_sentences": 0, "sources": 0, "pipelines": "", "error": str(exc)}


# ══════════════════════════════════════════════════════════════════════════════
# API & DATA HEALTH
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api-usage")
async def get_api_usage(request: Request, authorization: str = Header(None)):
    """Factcheck cache stats, MBFC coverage, system accuracy vs ground truth."""
    _require_admin(authorization, request)
    db = Session(engine)
    try:
        factcheck_stats = {"total_cached": 0, "expired": 0, "active": 0}
        try:
            fc = db.execute(sa.text("""
                SELECT
                    COUNT(*)                                              AS total_cached,
                    SUM(CASE WHEN expires_at < NOW() THEN 1 ELSE 0 END)  AS expired,
                    SUM(CASE WHEN expires_at >= NOW() THEN 1 ELSE 0 END) AS active
                FROM factcheck_cache
            """)).fetchone()
            if fc:
                factcheck_stats = {
                    "total_cached": fc.total_cached or 0,
                    "expired":      fc.expired or 0,
                    "active":       fc.active or 0,
                }
        except Exception as e:
            factcheck_stats["error"] = str(e)

        mbfc_stats = {"total_domains": 0, "last_synced": None}
        try:
            mbfc = db.execute(sa.text("""
                SELECT COUNT(*) AS total, MAX(last_synced) AS last_synced FROM mbfc_domains
            """)).fetchone()
            mbfc_stats = {
                "total_domains": mbfc.total or 0,
                "last_synced":   str(mbfc.last_synced) if mbfc and mbfc.last_synced else None,
                "note":          "Run sync from dashboard or: python scripts/sync_mbfc.py",
            }
        except Exception as e:
            mbfc_stats["error"] = str(e)

        system_accuracy = _compute_system_accuracy()

        return {
            "google_factcheck_api": factcheck_stats,
            "mbfc_coverage":        mbfc_stats,
            "system_accuracy":      system_accuracy,
        }
    finally:
        db.close()


@router.post("/mbfc/sync")
async def trigger_mbfc_sync(request: Request, authorization: str = Header(None)):
    """Trigger MBFC domain sync by running scripts/sync_mbfc.py."""
    _require_admin(authorization, request)
    sync_script = Path(__file__).resolve().parent / "scripts" / "sync_mbfc.py"
    if not sync_script.exists():
        raise HTTPException(status_code=404, detail="sync_mbfc.py not found.")
    try:
        result = subprocess.run(
            [sys.executable, str(sync_script)],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Sync failed: {result.stderr[:500]}")
        return {"status": "ok", "output": result.stdout[:1000]}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Sync timed out after 120s.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


def _compute_system_accuracy() -> dict:
    """System accuracy against LIAR/FEVER ground truth from corpus.db."""
    try:
        db_path = Path(__file__).parent / "data" / "corpus.db"
        if not db_path.exists():
            return {"error": "corpus.db not found", "total": 0}
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='system_predictions'")
        if not c.fetchone():
            conn.close()
            return {"error": "Run: python corpus/evaluate_system.py", "total": 0}
        c.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN predicted_label = ground_truth_label THEN 1 END) AS correct,
                   dataset
            FROM system_predictions GROUP BY dataset
        """)
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        overall_total   = sum(r["total"] for r in rows)
        overall_correct = sum(r["correct"] or 0 for r in rows)
        return {
            "overall_accuracy_pct": round(overall_correct / overall_total * 100, 1) if overall_total > 0 else None,
            "total":      overall_total,
            "correct":    overall_correct,
            "by_dataset": rows,
        }
    except Exception as e:
        return {"error": str(e), "total": 0}
