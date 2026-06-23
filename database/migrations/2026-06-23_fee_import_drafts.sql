-- Finance Excel import — drafts queue.
-- Rows parsed from an uploaded sheet that could NOT be auto-matched to a student
-- (or were missing amount/date) land here as 'draft'. Admin assigns a student
-- later, which creates the real fee_transaction and flips status to 'imported'.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-23_fee_import_drafts.sql
-- (Runs against the DB_NAME in your .env — no hardcoded database name.)

CREATE TABLE IF NOT EXISTS fee_import_drafts (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  student_id            INT NULL,                  -- matched/assigned student (if any)
  guessed_form_no       VARCHAR(40),
  guessed_student_name  VARCHAR(200),
  amount                DECIMAL(12,2),
  payment_date          DATE NULL,
  month                 VARCHAR(7),
  transaction_reference VARCHAR(120),
  payment_source        VARCHAR(160),
  parent_name           VARCHAR(160),
  course_package_hours  DECIMAL(8,2) NULL,
  notes                 TEXT,
  reason                VARCHAR(200),              -- why it went to draft
  raw_json              JSON,                      -- original spreadsheet row
  status                ENUM('draft','imported') NOT NULL DEFAULT 'draft',
  created_by            INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fid_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  INDEX idx_fid_status (status)
);
