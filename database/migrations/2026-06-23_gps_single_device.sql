-- Consolidate GPS into a single "lat,lng" column and add a parsed device column
-- (Browser · OS · DeviceType). Replaces the earlier split lat/lng columns.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-23_gps_single_device.sql

ALTER TABLE audit_logs
  DROP COLUMN gps_lat,
  DROP COLUMN gps_lng,
  ADD COLUMN gps    VARCHAR(60)  NULL,
  ADD COLUMN device VARCHAR(120) NULL;

ALTER TABLE users
  DROP COLUMN registration_lat,
  DROP COLUMN registration_lng,
  ADD COLUMN registration_gps    VARCHAR(60)  NULL,
  ADD COLUMN registration_device VARCHAR(120) NULL,
  ADD COLUMN last_login_device   VARCHAR(120) NULL;
