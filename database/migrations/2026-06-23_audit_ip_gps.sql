-- Add IP + GPS to the audit trail so every logged action records where it came from.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-23_audit_ip_gps.sql
-- (Runs against the DB_NAME in your .env — no hardcoded database name.)

ALTER TABLE audit_logs
  ADD COLUMN ip_address VARCHAR(45)   NULL,
  ADD COLUMN gps_lat    DECIMAL(10,7) NULL,
  ADD COLUMN gps_lng    DECIMAL(10,7) NULL;

CREATE INDEX idx_audit_user ON audit_logs (user_id);
CREATE INDEX idx_audit_created ON audit_logs (created_at);
