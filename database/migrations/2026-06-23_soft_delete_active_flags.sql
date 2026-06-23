-- Add is_active (enable/disable) and is_deleted (soft delete) flags where needed.
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS" — run this ONCE on an existing DB.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-23_soft_delete_active_flags.sql
-- (Runs against the DB_NAME in your .env — no hardcoded database name.)

-- users / teachers / branches / fee_packages already have is_active → only add is_deleted
ALTER TABLE users          ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;
ALTER TABLE teachers       ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;
ALTER TABLE branches       ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;
ALTER TABLE fee_packages   ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;

-- students keep their status ENUM; add both flags for uniform soft-delete handling
ALTER TABLE students       ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT TRUE  AFTER status;
ALTER TABLE students       ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;

-- tables that previously had no active/deleted concept
ALTER TABLE parents        ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                           ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subjects       ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                           ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE student_teacher_mapping ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                                    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE lecture_sessions   ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fee_transactions   ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- helpful filtered indexes
CREATE INDEX idx_students_deleted     ON students (is_deleted);
CREATE INDEX idx_tx_deleted           ON fee_transactions (is_deleted);
CREATE INDEX idx_lec_deleted          ON lecture_sessions (is_deleted);
