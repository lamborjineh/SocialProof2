"""
SocialProof — SQLAlchemy ORM Models v4.0
Mirrors the live socialproof_db schema exactly.

v4.0 Changes vs v3.2:
  - `evaluations` table renamed to `submissions`.
      EvaluationORM → SubmissionORM
      All FK columns named evaluation_id → submission_id throughout.
  - `system_score` and `analysis_json` columns removed from SubmissionORM
      (were on the old evaluations table — pipeline results are no longer
      persisted as a raw JSON blob or a single integer score).
  - `evidence` table: `similarity_score` column removed.
  - `user_evaluations` table: REMOVED entirely.
  - `re_evaluations` table: REMOVED entirely.
  - `reviews` table: REMOVED entirely.
  - `review_votes` table: REMOVED entirely.
  - `lessons` table:
      + `updated_at` column added (tracks last admin edit).
      + `is_published` column added (tinyint flag; admin can draft/publish).
      No seed data — lessons are managed entirely via the admin dashboard
      (POST /admin/lessons, PUT /admin/lessons/{id}, DELETE /admin/lessons/{id}).
  - `lessons_triggered` table:
      `user_evaluation_id` FK renamed to `submission_id` → references submissions.
  - `url_tracking` table:
      `evaluation_id` column renamed to `submission_id`.
  - `user_behavior_profile` table:
      `total_evaluations` column renamed to `total_submissions`.
  - init_mysql_schema() updated: only safe, idempotent migrations retained;
      all references to dropped tables and columns removed.

Active tables (11):
  claims, submissions, evidence, factcheck_cache, lesson_completions,
  lessons, lessons_triggered, mbfc_domains, pretest_results, quiz_attempts,
  quiz_questions, url_tracking, user_behavior_profile, user_skill_progress, users
"""

from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy import (
    Column, Integer, String, Text, Float,
    DateTime, SmallInteger,
    Enum as SAEnum,
    create_engine,
)
from sqlalchemy.orm import declarative_base

from config import DATABASE_URL, logger

Base   = declarative_base()
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)


# ── Core tables ───────────────────────────────────────────────────────────────

class UserORM(Base):
    __tablename__ = "users"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    username      = Column(String(50),  nullable=False, unique=True)
    email         = Column(String(150), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    role          = Column(SAEnum("user", "admin"), nullable=False, default="user")
    is_verified   = Column(SmallInteger, nullable=False, default=0)
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PasswordResetTokenORM(Base):
    __tablename__ = "password_reset_tokens"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)  # SHA-256 of the raw token
    expires_at = Column(DateTime, nullable=False)
    used       = Column(SmallInteger, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class EmailVerificationTokenORM(Base):
    __tablename__ = "email_verification_tokens"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    expires_at = Column(DateTime, nullable=False)
    used       = Column(SmallInteger, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class MindmapLensProgressORM(Base):
    __tablename__ = "mindmap_lens_progress"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(Integer, nullable=False)
    lens_id     = Column(String(100), nullable=False)   # e.g. "claim_detection_beginner"
    explored_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SubmissionORM(Base):
    """
    Renamed from EvaluationORM / evaluations table.
    system_score and analysis_json removed — pipeline results are returned
    directly in the API response and are not persisted as a blob.
    """
    __tablename__ = "submissions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, nullable=True)
    session_token = Column(String(64), nullable=False)
    input_type    = Column(SAEnum("text", "url", "image", "pdf", "file"), default="text")
    raw_content   = Column(Text, nullable=False)
    parsed_text   = Column(Text, nullable=True)
    status        = Column(SAEnum("pending", "analyzed", "complete"), default="pending")
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ClaimORM(Base):
    __tablename__  = "claims"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    submission_id  = Column(Integer, nullable=False)   # FK → submissions.id
    claim_text     = Column(Text, nullable=False)
    sentence_index = Column(Integer, nullable=True)
    label          = Column(String(20), default="unverified")
    confidence     = Column(Float, nullable=True)


class EvidenceORM(Base):
    """
    similarity_score removed — retrieval ranking is handled internally
    by the pipeline and is not persisted to the DB.
    """
    __tablename__  = "evidence"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    claim_id       = Column(Integer, nullable=False)
    evidence_text  = Column(Text, nullable=False)
    type           = Column(String(12), nullable=False)
    source_url     = Column(String(2083), nullable=True)
    source_label   = Column(String(255), nullable=True)
    retrieved_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── Lesson / quiz tables ──────────────────────────────────────────────────────

class LessonORM(Base):
    """
    Lessons are managed entirely via the admin dashboard.
    No seed data is inserted at deploy time.
    Admins create, edit, reorder, publish/unpublish, and delete lessons
    through the /admin/lessons API endpoints.

    New columns vs v3.x:
      updated_at   — set automatically on every UPDATE; lets the dashboard
                     display "last edited" timestamps.
      is_published — 1 = visible to learners, 0 = draft (admin-only).
    """
    __tablename__          = "lessons"
    id                     = Column(Integer, primary_key=True, autoincrement=True)
    lesson_key             = Column(String(100), nullable=False, unique=True)
    title                  = Column(String(255), nullable=False)
    content                = Column(Text, nullable=False)
    topic                  = Column(
        SAEnum("claim_detection", "source_verification", "bias_detection",
               "evidence_evaluation", "general"),
        nullable=False,
    )
    difficulty             = Column(
        SAEnum("beginner", "intermediate", "advanced"),
        nullable=False, default="beginner",
    )
    mil_skill              = Column(String(50),  nullable=True)
    sort_order             = Column(Integer,      nullable=True)
    prerequisite_lesson_id = Column(Integer,      nullable=True)
    is_published           = Column(SmallInteger, nullable=False, default=1)
    created_at             = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at             = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class LessonsTriggeredORM(Base):
    """
    submission_id replaces user_evaluation_id — references submissions
    directly now that user_evaluations has been removed.
    """
    __tablename__  = "lessons_triggered"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    submission_id  = Column(Integer, nullable=False)   # FK → submissions.id
    lesson_id      = Column(Integer, nullable=False)
    trigger_reason = Column(String(255), nullable=True)
    was_read       = Column(SmallInteger, nullable=False, default=0)
    triggered_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class QuizQuestionORM(Base):
    __tablename__ = "quiz_questions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id     = Column(Integer, nullable=True)
    question_text = Column(Text, nullable=False)
    options       = Column(sa.JSON, nullable=False)
    correct_index = Column(Integer, nullable=False)
    explanation   = Column(Text, nullable=True)
    topic         = Column(String(40), nullable=False)
    difficulty    = Column(
        SAEnum("beginner", "intermediate", "advanced"),
        nullable=True, default="beginner",
    )
    image_url     = Column(String(512), nullable=True)


class QuizAttemptORM(Base):
    __tablename__  = "quiz_attempts"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    user_id        = Column(Integer, nullable=True)
    question_id    = Column(Integer, nullable=False)
    selected_index = Column(Integer, nullable=False)
    is_correct     = Column(SmallInteger, nullable=False)
    attempted_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserSkillProgressORM(Base):
    """Per-user MIL skill level per topic. Updated after quiz attempts and lesson reads."""
    __tablename__     = "user_skill_progress"
    id                = Column(Integer, primary_key=True, autoincrement=True)
    user_id           = Column(Integer, nullable=True)
    session_token     = Column(String(64), nullable=True)
    topic             = Column(
        SAEnum("claim_detection", "source_verification", "bias_detection",
               "evidence_evaluation", "general"),
        nullable=False,
    )
    current_level     = Column(
        SAEnum("beginner", "intermediate", "advanced"),
        nullable=False, default="beginner",
    )
    quiz_accuracy_pct = Column(Float, nullable=True)
    lessons_completed = Column(Integer, nullable=False, default=0)
    last_updated      = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PretestResultORM(Base):
    """Pre/post test results."""
    __tablename__ = "pretest_results"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, nullable=True)
    session_token = Column(String(64), nullable=True)
    phase         = Column(SAEnum("pretest", "posttest"), nullable=False)
    score_pct     = Column(Integer, nullable=False)
    correct       = Column(Integer, nullable=False)
    total         = Column(Integer, nullable=False)
    submitted_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class LessonCompletionORM(Base):
    """Per-user lesson completion tracking."""
    __tablename__  = "lesson_completions"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    user_id        = Column(Integer, nullable=True)
    session_token  = Column(String(64), nullable=True)
    lesson_id      = Column(Integer, nullable=False)
    completed_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── v3 tables (unchanged) ─────────────────────────────────────────────────────

class FactcheckCacheORM(Base):
    """
    Caches Google Fact Check Tools API results to stay within the 100/day free quota.
    """
    __tablename__ = "factcheck_cache"
    id           = Column(Integer, primary_key=True, autoincrement=True)
    claim_hash   = Column(String(64),  nullable=False, unique=True)
    claim_text   = Column(Text,        nullable=False)
    results_json = Column(Text,        nullable=True)
    queried_at   = Column(DateTime,    default=lambda: datetime.now(timezone.utc))
    expires_at   = Column(DateTime,    nullable=True)


class MBFCDomainORM(Base):
    """
    MBFC / iffy.news domain credibility cache. Populated by scripts/sync_mbfc.py (monthly).
    """
    __tablename__      = "mbfc_domains"
    id                 = Column(Integer, primary_key=True, autoincrement=True)
    domain             = Column(String(255), nullable=False, unique=True)
    factual_reporting  = Column(String(50), nullable=True)
    bias_rating        = Column(String(50), nullable=True)
    credibility_rating = Column(String(50), nullable=True)
    country            = Column(String(10), nullable=True)
    notes_url          = Column(String(500), nullable=True)
    last_synced        = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class URLTrackingORM(Base):
    """
    submission_id replaces evaluation_id.
    """
    __tablename__  = "url_tracking"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    url            = Column(String(2083), nullable=False)
    url_hash       = Column(String(64),   nullable=False)
    domain         = Column(String(255),  nullable=True)
    submitted_by   = Column(Integer,      nullable=True)
    session_token  = Column(String(64),   nullable=True)
    submission_id  = Column(Integer,      nullable=True)   # soft ref → submissions.id
    submitted_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserBehaviorProfileORM(Base):
    """
    total_evaluations renamed to total_submissions.
    """
    __tablename__            = "user_behavior_profile"
    id                       = Column(Integer, primary_key=True, autoincrement=True)
    user_id                  = Column(Integer, nullable=True)
    session_token            = Column(String(64), nullable=True)
    claim_detection_score    = Column(Float, default=50)
    source_eval_score        = Column(Float, default=50)
    bias_detection_score     = Column(Float, default=50)
    evidence_eval_score      = Column(Float, default=50)
    avg_time_per_step_seconds = Column(Float, nullable=True)
    steps_skipped_rate       = Column(Float, default=0)
    lesson_read_rate         = Column(Float, default=0)
    total_submissions        = Column(Integer, nullable=False, default=0)
    total_lessons_read       = Column(Integer, nullable=False, default=0)
    last_activity_at         = Column(DateTime, nullable=True)
    updated_at               = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class PrebunkingTechniqueORM(Base):
    """
    Admin-managed technique registry for the Prebunking Lab.
    Replaces the hardcoded TECHNIQUE_IDS list — add/remove techniques
    via the admin dashboard without touching code.
    """
    __tablename__  = "prebunking_techniques"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    technique_id   = Column(String(64),  nullable=False, unique=True)
    name           = Column(String(255), nullable=False)
    description    = Column(Text,        nullable=True)
    module         = Column(Integer,     nullable=True)
    sort_order     = Column(Integer,     nullable=False, default=0)
    is_active      = Column(SmallInteger, nullable=False, default=1)
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class PrebunkingQuestionORM(Base):
    """
    Admin-managed questions for the Prebunking Lab exercises.
    Each row is a multiple-choice scenario tied to one technique.
    image_url optionally points to a scenario screenshot shown above the question.
    """
    __tablename__   = "prebunking_questions"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    technique_id    = Column(String(64),  nullable=False)   # references prebunking_techniques.technique_id
    question_text   = Column(Text,        nullable=False)
    option_a        = Column(String(500), nullable=False)
    option_b        = Column(String(500), nullable=False)
    option_c        = Column(String(500), nullable=False)
    option_d        = Column(String(500), nullable=False)
    correct_answer  = Column(String(1),   nullable=False)   # 'A', 'B', 'C', or 'D'
    explanation     = Column(Text,        nullable=True)
    image_url       = Column(String(512), nullable=True)    # optional scenario image
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


# ── Auto-migration on startup ──────────────────────────────────────────────────

class MindmapNodeORM(Base):
    __tablename__ = "mindmap_nodes"
    id            = Column(String(64),  primary_key=True)
    map_id        = Column(String(32),  primary_key=True, default="main")
    type          = Column(sa.Enum("root", "cat", "leaf"), nullable=False, default="leaf")
    icon          = Column(String(16),  nullable=False, default="📌")
    label         = Column(String(120), nullable=False)
    sub           = Column(String(120), nullable=True)
    color         = Column(String(10),  nullable=False, default="#4488ff")
    x             = Column(Integer,     nullable=False, default=1800)
    y             = Column(Integer,     nullable=False, default=1500)
    start_visible = Column(sa.Boolean,  nullable=False, default=False)
    sort_order    = Column(Integer,     nullable=False, default=0)
    active        = Column(sa.Boolean,  nullable=False, default=True)
    created_at    = Column(DateTime,    default=lambda: datetime.now(timezone.utc))
    updated_at    = Column(DateTime,    default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class MindmapEdgeORM(Base):
    __tablename__ = "mindmap_edges"
    id       = Column(Integer,    primary_key=True, autoincrement=True)
    map_id   = Column(String(32), nullable=False, default="main")
    from_id  = Column(String(64), nullable=False)
    to_id    = Column(String(64), nullable=False)


class MindmapInteractionORM(Base):
    __tablename__ = "mindmap_interactions"
    node_id     = Column(String(64),  primary_key=True)
    map_id      = Column(String(32),  primary_key=True, default="main")
    icon        = Column(String(16),  nullable=False, default="📌")
    title       = Column(String(120), nullable=False)
    context     = Column(sa.Text,     nullable=True)
    widget_type = Column(sa.Enum("choice", "slider", "tap", "bots", "none"), nullable=False, default="choice")
    widget_json = Column(sa.JSON,     nullable=True)
    aftermath   = Column(sa.Text,     nullable=True)
    media_type  = Column(sa.Enum("image", "youtube"), nullable=True)
    media_url   = Column(String(512), nullable=True)
    media_thumb = Column(String(512), nullable=True)
    updated_at  = Column(DateTime,    default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class MindmapProgressORM(Base):
    __tablename__ = "mindmap_progress"
    id         = Column(Integer,    primary_key=True, autoincrement=True)
    user_id    = Column(Integer,    nullable=False)
    map_id     = Column(String(32), nullable=False, default="main")
    node_id    = Column(String(64), nullable=False)
    viewed_at  = Column(DateTime,   default=lambda: datetime.now(timezone.utc))


class MindmapSuggestionORM(Base):
    __tablename__ = "mindmap_suggestions"
    id              = Column(Integer,    primary_key=True, autoincrement=True)
    user_id         = Column(Integer,    nullable=True)
    map_id          = Column(String(32), nullable=False, default="main")
    label           = Column(String(120), nullable=False)
    reason          = Column(sa.Text,    nullable=True)
    connect_from_id = Column(String(64), nullable=True)
    status          = Column(sa.Enum("pending", "approved", "rejected"), nullable=False, default="pending")
    admin_note      = Column(String(255), nullable=True)
    submitted_at    = Column(DateTime,   default=lambda: datetime.now(timezone.utc))
    reviewed_at     = Column(DateTime,   nullable=True)


def init_mysql_schema():
    """
    Run safe migrations on startup. Every statement is idempotent.
    Column additions check information_schema before running ALTER TABLE.
    New tables use CREATE TABLE IF NOT EXISTS.

    v4.0 note: submissions, evidence (without similarity_score), and the
    updated lessons table are the authoritative structures. The old
    evaluations table and the four removed tables (user_evaluations,
    re_evaluations, reviews, review_votes) are NOT recreated here.
    If migrating a live database, drop those tables manually after
    verifying no active references remain.
    """

    new_tables_sql = [
        # submissions (replaces evaluations — system_score & analysis_json gone)
        """CREATE TABLE IF NOT EXISTS submissions (
            id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id       INT UNSIGNED NULL,
            session_token VARCHAR(64)  NOT NULL,
            input_type    ENUM('text','url','image','pdf','file') NOT NULL DEFAULT 'text',
            raw_content   TEXT         NOT NULL,
            parsed_text   TEXT         NULL,
            status        ENUM('pending','analyzed','complete') NOT NULL DEFAULT 'pending',
            created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_submissions_user`   (`user_id`),
            KEY `idx_submissions_status` (`status`),
            CONSTRAINT `submissions_ibfk_1`
                FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
        )""",

        # claims (submission_id FK)
        """CREATE TABLE IF NOT EXISTS claims (
            id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
            submission_id  INT UNSIGNED NOT NULL,
            claim_text     TEXT         NOT NULL,
            sentence_index TINYINT UNSIGNED NULL,
            label          ENUM('supported','misleading','neutral','unverified')
                               NOT NULL DEFAULT 'unverified',
            confidence     FLOAT NULL,
            PRIMARY KEY (`id`),
            KEY `idx_claims_submission` (`submission_id`),
            CONSTRAINT `claims_ibfk_1`
                FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE
        )""",

        # evidence (no similarity_score)
        """CREATE TABLE IF NOT EXISTS evidence (
            id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
            claim_id      INT UNSIGNED NOT NULL,
            evidence_text TEXT         NOT NULL,
            type          ENUM('support','contradict','neutral') NOT NULL,
            source_url    VARCHAR(2083) NULL,
            source_label  VARCHAR(255)  NULL,
            retrieved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_evidence_claim` (`claim_id`),
            CONSTRAINT `evidence_ibfk_1`
                FOREIGN KEY (`claim_id`) REFERENCES `claims` (`id`) ON DELETE CASCADE
        )""",

        # lessons (with is_published and updated_at; no seed data)
        """CREATE TABLE IF NOT EXISTS lessons (
            id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
            lesson_key             VARCHAR(100) NOT NULL,
            title                  VARCHAR(255) NOT NULL,
            content                TEXT         NOT NULL,
            topic                  ENUM('claim_detection','source_verification',
                                        'bias_detection','evidence_evaluation','general')
                                       NOT NULL,
            difficulty             ENUM('beginner','intermediate','advanced')
                                       NOT NULL DEFAULT 'beginner',
            mil_skill              VARCHAR(50)  NULL,
            sort_order             INT          NULL,
            prerequisite_lesson_id INT          NULL,
            is_published           TINYINT(1)   NOT NULL DEFAULT 1,
            created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            UNIQUE KEY `lesson_key` (`lesson_key`)
        )""",

        # lessons_triggered (submission_id replaces user_evaluation_id)
        """CREATE TABLE IF NOT EXISTS lessons_triggered (
            id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
            submission_id  INT UNSIGNED NOT NULL,
            lesson_id      INT UNSIGNED NOT NULL,
            trigger_reason VARCHAR(255) NULL,
            was_read       TINYINT(1)   NOT NULL DEFAULT 0,
            triggered_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `submission_id` (`submission_id`),
            KEY `lesson_id`     (`lesson_id`),
            CONSTRAINT `lessons_triggered_ibfk_1`
                FOREIGN KEY (`submission_id`) REFERENCES `submissions` (`id`) ON DELETE CASCADE,
            CONSTRAINT `lessons_triggered_ibfk_2`
                FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE
        )""",

        """CREATE TABLE IF NOT EXISTS user_skill_progress (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            user_id           INT NULL,
            session_token     VARCHAR(64) NULL,
            topic             ENUM('claim_detection','source_verification','bias_detection',
                                   'evidence_evaluation','general') NOT NULL,
            current_level     ENUM('beginner','intermediate','advanced')
                                  NOT NULL DEFAULT 'beginner',
            quiz_accuracy_pct FLOAT NULL,
            lessons_completed INT NOT NULL DEFAULT 0,
            last_updated      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_usp_user  (user_id),
            INDEX idx_usp_topic (topic)
        )""",

        """CREATE TABLE IF NOT EXISTS pretest_results (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT NULL,
            session_token VARCHAR(64) NULL,
            phase         ENUM('pretest','posttest') NOT NULL,
            score_pct     INT NOT NULL,
            correct       INT NOT NULL,
            total         INT NOT NULL,
            submitted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pr_user    (user_id),
            INDEX idx_pr_session (session_token)
        )""",

        """CREATE TABLE IF NOT EXISTS lesson_completions (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT NULL,
            session_token VARCHAR(64) NULL,
            lesson_id     INT NOT NULL,
            completed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_lc_user   (user_id),
            INDEX idx_lc_lesson (lesson_id)
        )""",

        """CREATE TABLE IF NOT EXISTS mbfc_domains (
            id                 INT AUTO_INCREMENT PRIMARY KEY,
            domain             VARCHAR(255) NOT NULL UNIQUE,
            factual_reporting  VARCHAR(50)  NULL,
            bias_rating        VARCHAR(50)  NULL,
            credibility_rating VARCHAR(50)  NULL,
            country            VARCHAR(10)  NULL,
            notes_url          VARCHAR(500) NULL,
            last_synced        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_mbfc_domain (domain)
        )""",

        """CREATE TABLE IF NOT EXISTS factcheck_cache (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            claim_hash   VARCHAR(64) NOT NULL UNIQUE,
            claim_text   TEXT        NOT NULL,
            results_json TEXT        NULL,
            queried_at   DATETIME    DEFAULT CURRENT_TIMESTAMP,
            expires_at   DATETIME    NULL,
            INDEX idx_fc_hash (claim_hash)
        )""",

        # url_tracking (submission_id replaces evaluation_id)
        """CREATE TABLE IF NOT EXISTS url_tracking (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            url           VARCHAR(2083) NOT NULL,
            url_hash      VARCHAR(64)   NOT NULL,
            domain        VARCHAR(255)  NULL,
            submitted_by  INT           NULL,
            session_token VARCHAR(64)   NULL,
            submission_id INT           NULL,
            submitted_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uq_url_hash_session` (`url_hash`, `session_token`),
            INDEX idx_ut_hash       (url_hash),
            INDEX idx_ut_domain     (domain),
            INDEX idx_ut_user       (submitted_by),
            INDEX idx_ut_submission (submission_id)
        )""",

        # prebunking_questions — admin-managed scenarios for Prebunking Lab
        """CREATE TABLE IF NOT EXISTS prebunking_techniques (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            technique_id VARCHAR(64)  NOT NULL UNIQUE,
            name         VARCHAR(255) NOT NULL,
            description  TEXT         NULL,
            module       INT          NULL,
            sort_order   INT          NOT NULL DEFAULT 0,
            is_active    TINYINT(1)   NOT NULL DEFAULT 1,
            created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_pbt_active (is_active)
        )""",

        """CREATE TABLE IF NOT EXISTS prebunking_questions (
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
        )""",

        # user_behavior_profile (total_submissions replaces total_evaluations)
        """CREATE TABLE IF NOT EXISTS user_behavior_profile (
            id                        INT AUTO_INCREMENT PRIMARY KEY,
            user_id                   INT          NULL,
            session_token             VARCHAR(64)  NULL,
            claim_detection_score     FLOAT        DEFAULT 50,
            source_eval_score         FLOAT        DEFAULT 50,
            bias_detection_score      FLOAT        DEFAULT 50,
            evidence_eval_score       FLOAT        DEFAULT 50,
            avg_time_per_step_seconds FLOAT        NULL,
            steps_skipped_rate        FLOAT        DEFAULT 0,
            lesson_read_rate          FLOAT        DEFAULT 0,
            total_submissions         INT NOT NULL DEFAULT 0,
            total_lessons_read        INT NOT NULL DEFAULT 0,
            last_activity_at          DATETIME     NULL,
            updated_at                DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_ubp_user    (user_id),
            UNIQUE KEY uq_ubp_session (session_token),
            INDEX idx_ubp_user        (user_id),
            INDEX idx_ubp_session     (session_token)
        )""",
        # password_reset_tokens
        """CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         INT          NOT NULL AUTO_INCREMENT,
            user_id    INT UNSIGNED NOT NULL,
            token_hash VARCHAR(64)  NOT NULL UNIQUE,
            expires_at DATETIME     NOT NULL,
            used       TINYINT(1)   NOT NULL DEFAULT 0,
            created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_prt_user   (user_id),
            INDEX idx_prt_hash   (token_hash),
            INDEX idx_prt_expiry (expires_at)
        )""",

        # email_verification_tokens
        """CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id         INT          NOT NULL AUTO_INCREMENT,
            user_id    INT UNSIGNED NOT NULL,
            token_hash VARCHAR(64)  NOT NULL UNIQUE,
            expires_at DATETIME     NOT NULL,
            used       TINYINT(1)   NOT NULL DEFAULT 0,
            created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_evt_user   (user_id),
            INDEX idx_evt_hash   (token_hash),
            INDEX idx_evt_expiry (expires_at)
        )""",

        # mindmap_lens_progress
        """CREATE TABLE IF NOT EXISTS mindmap_lens_progress (
            id          INT          NOT NULL AUTO_INCREMENT,
            user_id     INT UNSIGNED NOT NULL,
            lens_id     VARCHAR(100) NOT NULL,
            explored_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY  uq_mlp_user_lens (user_id, lens_id),
            INDEX idx_mlp_user (user_id)
        )""",

        # ── Dynamic mindmap tables ─────────────────────────────────────────
        """CREATE TABLE IF NOT EXISTS mindmap_nodes (
            id            VARCHAR(64)  NOT NULL,
            map_id        VARCHAR(32)  NOT NULL DEFAULT 'main',
            type          ENUM('root','cat','leaf') NOT NULL DEFAULT 'leaf',
            icon          VARCHAR(16)  NOT NULL DEFAULT '📌',
            label         VARCHAR(120) NOT NULL,
            sub           VARCHAR(120) DEFAULT NULL,
            color         VARCHAR(10)  NOT NULL DEFAULT '#4488ff',
            x             INT          NOT NULL DEFAULT 1800,
            y             INT          NOT NULL DEFAULT 1500,
            start_visible TINYINT(1)   NOT NULL DEFAULT 0,
            sort_order    INT          NOT NULL DEFAULT 0,
            active        TINYINT(1)   NOT NULL DEFAULT 1,
            created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id, map_id)
        )""",

        """CREATE TABLE IF NOT EXISTS mindmap_edges (
            id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
            map_id   VARCHAR(32)  NOT NULL DEFAULT 'main',
            from_id  VARCHAR(64)  NOT NULL,
            to_id    VARCHAR(64)  NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_edge (map_id, from_id, to_id),
            KEY idx_edge_from (from_id),
            KEY idx_edge_to   (to_id)
        )""",

        """CREATE TABLE IF NOT EXISTS mindmap_interactions (
            node_id     VARCHAR(64)  NOT NULL,
            map_id      VARCHAR(32)  NOT NULL DEFAULT 'main',
            icon        VARCHAR(16)  NOT NULL DEFAULT '📌',
            title       VARCHAR(120) NOT NULL,
            context     TEXT         DEFAULT NULL,
            widget_type ENUM('choice','slider','tap','bots','none') NOT NULL DEFAULT 'choice',
            widget_json JSON         DEFAULT NULL,
            aftermath   TEXT         DEFAULT NULL,
            media_type  ENUM('image','youtube') DEFAULT NULL,
            media_url   VARCHAR(512) DEFAULT NULL,
            media_thumb VARCHAR(512) DEFAULT NULL,
            updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (node_id, map_id)
        )""",

        """CREATE TABLE IF NOT EXISTS mindmap_progress (
            id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id   INT UNSIGNED NOT NULL,
            map_id    VARCHAR(32)  NOT NULL DEFAULT 'main',
            node_id   VARCHAR(64)  NOT NULL,
            viewed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_progress (user_id, map_id, node_id),
            KEY idx_mp_user (user_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )""",

        """CREATE TABLE IF NOT EXISTS mindmap_suggestions (
            id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id         INT UNSIGNED DEFAULT NULL,
            map_id          VARCHAR(32)  NOT NULL DEFAULT 'main',
            label           VARCHAR(120) NOT NULL,
            reason          TEXT         DEFAULT NULL,
            connect_from_id VARCHAR(64)  DEFAULT NULL,
            status          ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            admin_note      VARCHAR(255) DEFAULT NULL,
            submitted_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at     DATETIME     DEFAULT NULL,
            PRIMARY KEY (id),
            KEY idx_ms_status (status),
            KEY idx_ms_user   (user_id)
        )""",

    ]

    with engine.connect() as conn:
        for sql in new_tables_sql:
            try:
                conn.execute(sa.text(sql))
                conn.commit()
            except Exception as e:
                logger.warning(f"[Migration] Table creation skipped: {e}")

    # ── Seed default prebunking techniques (INSERT IGNORE = idempotent) ───────
    seed_techniques = """
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
            conn.execute(sa.text(seed_techniques))
    except Exception as e:
        logger.warning(f"[Migration] Technique seed skipped: {e}")

    # ── Safe column additions for lessons admin features ──────────────────────
    column_migrations = [
        (
            "lessons", "is_published",
            "ALTER TABLE lessons ADD COLUMN is_published TINYINT(1) NOT NULL DEFAULT 1"
        ),
        (
            "lessons", "updated_at",
            "ALTER TABLE lessons ADD COLUMN updated_at DATETIME NOT NULL "
            "DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
        (
            "lessons", "mil_skill",
            "ALTER TABLE lessons ADD COLUMN mil_skill VARCHAR(50) NULL"
        ),
        (
            "lessons", "sort_order",
            "ALTER TABLE lessons ADD COLUMN sort_order INT NULL"
        ),
        (
            "lessons", "prerequisite_lesson_id",
            "ALTER TABLE lessons ADD COLUMN prerequisite_lesson_id INT NULL"
        ),
        (
            "quiz_questions", "difficulty",
            "ALTER TABLE quiz_questions ADD COLUMN difficulty "
            "ENUM('beginner','intermediate','advanced') NULL DEFAULT 'beginner'"
        ),
        (
            "quiz_questions", "image_url",
            "ALTER TABLE quiz_questions ADD COLUMN image_url VARCHAR(512) NULL"
        ),
        (
            "prebunking_questions", "image_url",
            "ALTER TABLE prebunking_questions ADD COLUMN image_url VARCHAR(512) NULL"
        ),
        (
            "users", "is_verified",
            "ALTER TABLE users ADD COLUMN is_verified TINYINT(1) NOT NULL DEFAULT 0"
        ),
    ]

    with engine.connect() as conn:
        for table, column, sql in column_migrations:
            try:
                result = conn.execute(sa.text(
                    "SELECT COUNT(*) FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() "
                    f"AND table_name = '{table}' AND column_name = '{column}'"
                ))
                if result.scalar() == 0:
                    conn.execute(sa.text(sql))
                    conn.commit()
                    logger.info(f"[Migration] Added column '{column}' to '{table}'")
            except Exception as e:
                logger.warning(f"[Migration] {table}.{column}: {e}")

    # ── Enum expansion ────────────────────────────────────────────────────────
    enum_migrations = [
        """ALTER TABLE submissions
           MODIFY COLUMN input_type ENUM('text','url','image','pdf','file')
           NOT NULL DEFAULT 'text'""",
    ]

    with engine.connect() as conn:
        for sql in enum_migrations:
            try:
                conn.execute(sa.text(sql))
                conn.commit()
            except Exception as e:
                logger.warning(f"[Migration] Enum expand skipped: {e}")
