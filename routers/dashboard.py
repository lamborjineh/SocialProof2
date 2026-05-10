"""
SocialProof — Router: User Dashboard  (v4.0)
GET /dashboard/{user_id}

Returns:
  stats            — total evaluations, lessons completed, quiz streak
  skill_progress   — per-topic MIL skill level + quiz accuracy
  behavior_cards   — derived insight cards from lesson trigger patterns
  lesson_triggers  — weakness bar chart data
  history          — last 20 submissions (content + date only — NO judgment fields)
  quiz_history     — last 20 quiz attempts (topic, correct/wrong — no verdicts)
  recommended      — lesson recommendations based on weak topics
  pretest          — pre-test vs post-test comparison if both phases exist
  mindmap_progress — topics unlocked on the mind map
  prebunking_done  — count of prebunking challenges completed

v4 Design Rules:
  - user_label, confidence_level, user_score REMOVED from history (judgment fields)
  - re_evaluations NEVER queried or returned
  - system_score, system_label NEVER returned
"""

from datetime import date, timedelta

import sqlalchemy as sa
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.orm import Session

from config import logger
from database.models import engine
from routers.auth import get_current_user

router = APIRouter()


# ── Constants ─────────────────────────────────────────────────────────────────

_TOPIC_DISPLAY = {
    "claim_detection":    "Claim Detection",
    "source_verification": "Source Verification",
    "bias_detection":     "Bias Detection",
    "evidence_evaluation": "Evidence Evaluation",
    "general":            "General MIL",
}

_LEVEL_ORDER = {"beginner": 0, "intermediate": 1, "advanced": 2}

_BEHAVIOR_INSIGHTS = {
    "source_verification": {
        "flag":        "trusts_sources_unchecked",
        "title":       "Source checking gap",
        "body":        "You've been prompted to re-examine sources several times. Practise running a quick domain check before trusting a claim.",
        "mil_skill":   "Evaluate & Assess",
        "action":      "lessons.html#evaluating-sources",
        "action_label":"Review: Evaluating Sources →",
    },
    "bias_detection": {
        "flag":        "trusts_emotional",
        "title":       "Emotional language slips through",
        "body":        "Emotionally charged framing is appearing in content you've marked as credible. Recognising loaded language is one of the highest-leverage MIL skills.",
        "mil_skill":   "Evaluate & Assess",
        "action":      "lessons.html#bias-emotional-language",
        "action_label":"Review: Bias & Emotional Language →",
    },
    "claim_detection": {
        "flag":        "skips_claims",
        "title":       "Claim identification step skipped",
        "body":        "Isolating exactly what is being claimed is the first step in any fact-check. Skipping it means reasoning on the wrong thing.",
        "mil_skill":   "Understand",
        "action":      "lessons.html#what-is-a-claim",
        "action_label":"Review: What Is a Claim? →",
    },
    "evidence_evaluation": {
        "flag":        "skips_evidence",
        "title":       "Evidence step skipped",
        "body":        "You've bypassed the evidence step in several sessions. Evidence quality — not just presence — determines how much weight a claim deserves.",
        "mil_skill":   "Evaluate & Assess",
        "action":      "lessons.html#reading-evidence",
        "action_label":"Review: Reading Evidence →",
    },
    "general": {
        "flag":        "overconfident",
        "title":       "High confidence, varied outcomes",
        "body":        "Keep building your calibration. The goal isn't certainty — it's scepticism proportional to the evidence.",
        "mil_skill":   "Reflect",
        "action":      "lessons.html#putting-it-together",
        "action_label":"Review: Putting It Together →",
    },
}


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/dashboard/{user_id}")
async def get_dashboard(user_id: int, request: Request):
    try:
        payload = get_current_user(request, request.headers.get("authorization"))
        if payload["sub"] != user_id and payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Forbidden.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    db = Session(engine)
    try:

        # ── 1. Core stats ─────────────────────────────────────────────────────
        total_evals = db.execute(sa.text(
            "SELECT COUNT(*) FROM submissions WHERE user_id = :uid"
        ), {"uid": user_id}).scalar() or 0

        lessons_done = db.execute(sa.text(
            "SELECT COUNT(*) FROM lesson_completions WHERE user_id = :uid"
        ), {"uid": user_id}).scalar() or 0

        # Activity streak: consecutive days with any quiz attempt
        streak = 0
        try:
            streak_rows = db.execute(sa.text("""
                SELECT DATE(attempted_at) AS d
                FROM quiz_attempts
                WHERE user_id = :uid
                GROUP BY DATE(attempted_at)
                ORDER BY d DESC
                LIMIT 30
            """), {"uid": user_id}).fetchall()
            if streak_rows:
                today = date.today()
                for i, row in enumerate(streak_rows):
                    expected = today - timedelta(days=i)
                    if row.d == expected:
                        streak += 1
                    else:
                        break
        except Exception:
            streak = 0

        total_quiz_attempts = db.execute(sa.text(
            "SELECT COUNT(*) FROM quiz_attempts WHERE user_id = :uid"
        ), {"uid": user_id}).scalar() or 0

        stats = {
            "total_submissions":  total_evals,
            "lessons_completed":  lessons_done,
            "quiz_streak":        streak,
            "total_quiz_attempts": total_quiz_attempts,
        }

        # ── 2. Skill progress ─────────────────────────────────────────────────
        skill_rows = db.execute(sa.text("""
            SELECT topic, current_level, quiz_accuracy_pct, lessons_completed
            FROM user_skill_progress
            WHERE user_id = :uid
        """), {"uid": user_id}).fetchall()

        skill_map = {r.topic: r for r in skill_rows}
        skill_progress = []
        for topic in ["claim_detection", "source_verification", "bias_detection",
                      "evidence_evaluation", "general"]:
            row = skill_map.get(topic)
            skill_progress.append({
                "topic":             topic,
                "display_name":      _TOPIC_DISPLAY.get(topic, topic),
                "current_level":     row.current_level if row else "beginner",
                "level_index":       _LEVEL_ORDER.get(row.current_level if row else "beginner", 0),
                "quiz_accuracy_pct": round(row.quiz_accuracy_pct) if (row and row.quiz_accuracy_pct) else None,
                "lessons_completed": row.lessons_completed if row else 0,
            })

        # ── 3. Lesson triggers (weakness bars) ────────────────────────────────
        trigger_rows = db.execute(sa.text("""
            SELECT l.topic, COUNT(*) AS trigger_count
            FROM lessons_triggered lt
            JOIN submissions s ON s.id = lt.submission_id
            JOIN lessons l ON l.id = lt.lesson_id
            WHERE s.user_id = :uid
            GROUP BY l.topic
            ORDER BY trigger_count DESC
            LIMIT 5
        """), {"uid": user_id}).fetchall()

        lesson_triggers = [
            {"topic": r.topic, "trigger_count": r.trigger_count,
             "display_name": _TOPIC_DISPLAY.get(r.topic, r.topic)}
            for r in trigger_rows
        ]

        # ── 4. Behavior insight cards ─────────────────────────────────────────
        behavior_cards = []
        for tr in trigger_rows:
            if tr.trigger_count >= 2 and tr.topic in _BEHAVIOR_INSIGHTS:
                tmpl = _BEHAVIOR_INSIGHTS[tr.topic]
                behavior_cards.append({
                    "flag":          tmpl["flag"],
                    "title":         tmpl["title"],
                    "body":          tmpl["body"],
                    "mil_skill":     tmpl["mil_skill"],
                    "action":        tmpl["action"],
                    "action_label":  tmpl["action_label"],
                    "trigger_count": tr.trigger_count,
                })
            if len(behavior_cards) >= 3:
                break

        # ── 5. Evaluation history — activity only, NO judgment fields ─────────
        #    user_label, confidence_level, user_score intentionally excluded.
        history_rows = db.execute(sa.text("""
            SELECT s.id          AS eval_id,
                   s.raw_content AS content_preview,
                   s.created_at,
                   s.input_type
            FROM submissions s
            WHERE s.user_id = :uid
            ORDER BY s.created_at DESC
            LIMIT 20
        """), {"uid": user_id}).fetchall()

        history = []
        for r in history_rows:
            raw = r.content_preview or ""
            preview = raw[:80] + ("…" if len(raw) > 80 else "")
            history.append({
                "eval_id":         r.eval_id,
                "content_preview": preview,
                "input_type":      r.input_type or "text",
                "created_at":      r.created_at.isoformat() if r.created_at else None,
            })

        # ── 6. Quiz history ───────────────────────────────────────────────────
        quiz_rows = db.execute(sa.text("""
            SELECT qa.id, qa.question_id, qa.is_correct, qa.attempted_at,
                   qq.topic, qq.difficulty, qq.question_text
            FROM quiz_attempts qa
            JOIN quiz_questions qq ON qq.id = qa.question_id
            WHERE qa.user_id = :uid
            ORDER BY qa.attempted_at DESC
            LIMIT 20
        """), {"uid": user_id}).fetchall()

        quiz_history = []
        for r in quiz_rows:
            quiz_history.append({
                "attempt_id":    r.id,
                "question_id":   r.question_id,
                "question_text": (r.question_text or "")[:80],
                "topic":         r.topic,
                "display_name":  _TOPIC_DISPLAY.get(r.topic, r.topic),
                "difficulty":    r.difficulty,
                "is_correct":    bool(r.is_correct),
                "attempted_at":  r.attempted_at.isoformat() if r.attempted_at else None,
            })

        # ── 7. Lesson recommendations (triggered but not yet completed) ────────
        recommended_rows = db.execute(sa.text("""
            SELECT DISTINCT l.id, l.lesson_key, l.title, l.topic, l.difficulty, l.mil_skill
            FROM lessons_triggered lt
            JOIN submissions s ON s.id = lt.submission_id
            JOIN lessons l ON l.id = lt.lesson_id
            WHERE s.user_id = :uid
              AND lt.was_read = 0
              AND l.id NOT IN (
                SELECT lesson_id FROM lesson_completions WHERE user_id = :uid
              )
            ORDER BY lt.id DESC
            LIMIT 5
        """), {"uid": user_id}).fetchall()

        recommended = [
            {
                "lesson_id":  r.id,
                "lesson_key": r.lesson_key,
                "title":      r.title,
                "topic":      r.topic,
                "display_name": _TOPIC_DISPLAY.get(r.topic, r.topic),
                "difficulty": r.difficulty,
                "mil_skill":  r.mil_skill,
            }
            for r in recommended_rows
        ]

        # ── 8. Pre-test vs post-test comparison ───────────────────────────────
        pretest = None
        try:
            pt_rows = db.execute(sa.text("""
                SELECT phase, score_pct, correct, total, completed_at
                FROM pretest_results
                WHERE user_id = :uid
                ORDER BY completed_at ASC
            """), {"uid": user_id}).fetchall()

            pt_map = {r.phase: r for r in pt_rows}
            if pt_map:
                pre  = pt_map.get("pretest")
                post = pt_map.get("posttest")
                # Show panel as soon as pretest is taken; posttest fields are
                # null until the user completes the post-test phase.
                pretest = {
                    "pretest":  {"score_pct": pre.score_pct,  "correct": pre.correct,  "total": pre.total}  if pre  else None,
                    "posttest": {"score_pct": post.score_pct, "correct": post.correct, "total": post.total} if post else None,
                    "delta":    round(post.score_pct - pre.score_pct, 1) if (pre and post) else None,
                    "pretest_only": bool(pre and not post),
                }
        except Exception:
            pretest = None

        # ── 9. Mindmap progress ───────────────────────────────────────────────
        # topics_total = 9 — one per satellite lens node (source, bias, evidence,
        # stats, media, context, verify, misinfo, share). Was incorrectly 5.
        mindmap_progress = {"topics_unlocked": 0, "topics_total": 9, "unlocked_list": []}
        try:
            # A topic is "unlocked" once the user has completed at least one
            # lesson in that topic.
            unlocked_rows = db.execute(sa.text("""
                SELECT DISTINCT l.topic
                FROM lesson_completions lc
                JOIN lessons l ON l.id = lc.lesson_id
                WHERE lc.user_id = :uid
            """), {"uid": user_id}).fetchall()
            unlocked = [r.topic for r in unlocked_rows]
            mindmap_progress = {
                "topics_unlocked": len(unlocked),
                "topics_total":    5,
                "unlocked_list":   unlocked,
            }
        except Exception:
            pass

        # ── 10. Prebunking challenges ─────────────────────────────────────────
        prebunking_done = 0
        try:
            prebunking_done = db.execute(sa.text("""
                SELECT COUNT(*) FROM prebunking_attempts
                WHERE user_id = :uid AND completed = 1
            """), {"uid": user_id}).scalar() or 0
        except Exception:
            prebunking_done = 0

        # ── 11. Activity heatmap (16-week daily quiz counts) ──────────────────
        activity_by_day = []
        try:
            act_rows = db.execute(sa.text("""
                SELECT DATE(attempted_at) AS date, COUNT(*) AS count
                FROM quiz_attempts
                WHERE user_id = :uid
                  AND attempted_at >= DATE('now', '-112 days')
                GROUP BY DATE(attempted_at)
                ORDER BY date ASC
            """), {"uid": user_id}).fetchall()
            activity_by_day = [
                {"date": str(r.date), "count": r.count}
                for r in act_rows
            ]
        except Exception:
            activity_by_day = []

        return {
            "stats":             stats,
            "skill_progress":    skill_progress,
            "behavior_cards":    behavior_cards,
            "lesson_triggers":   lesson_triggers,
            "history":           history,
            "quiz_history":      quiz_history,
            "recommended":       recommended,
            "pretest":           pretest,
            "mindmap_progress":  mindmap_progress,
            "prebunking_done":   prebunking_done,
            "activity_by_day":   activity_by_day,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[Dashboard] Error for user {user_id}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Dashboard query failed.")
    finally:
        db.close()
