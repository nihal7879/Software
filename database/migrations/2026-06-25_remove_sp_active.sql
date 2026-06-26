-- Remove the 'SP-Active' student status. The app now uses only Active / Inactive.
-- Any existing SP-Active students are converted to Active before the enum is shrunk.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-25_remove_sp_active.sql

UPDATE students SET status = 'Active' WHERE status = 'SP-Active';

ALTER TABLE students
  MODIFY COLUMN status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active';
