-- Soft delete for fee import drafts.
-- Discarding a draft no longer hard-deletes the row; it flips status to 'discarded'.
-- This adds the new enum value to existing databases.
-- Run:  node scripts/run-sql.js ../database/migrations/2026-06-25_draft_soft_delete.sql

ALTER TABLE fee_import_drafts
  MODIFY COLUMN status ENUM('draft','imported','discarded') NOT NULL DEFAULT 'draft';
