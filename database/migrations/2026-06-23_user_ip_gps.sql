-- Capture registration / login IP and (optional) GPS coordinates per user.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-23_user_ip_gps.sql
-- (Runs against the DB_NAME in your .env — no hardcoded database name.)

ALTER TABLE users
  ADD COLUMN registration_ip  VARCHAR(45)    NULL,
  ADD COLUMN registration_lat DECIMAL(10,7)  NULL,
  ADD COLUMN registration_lng DECIMAL(10,7)  NULL,
  ADD COLUMN last_login_ip    VARCHAR(45)    NULL,
  ADD COLUMN last_login_at    DATETIME       NULL;
