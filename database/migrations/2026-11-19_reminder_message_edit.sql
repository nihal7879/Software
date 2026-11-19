-- Let the office edit a reminder's wording before they send it.
--
-- The system writes a good message, but it cannot know the package amount:
-- AED 4200 for 30 hours for most families, 2100 for 15, 1900 for 15, and
-- 4200 for 35 for one long-standing family. The office adds that, and
-- whatever else a particular parent needs said, before it goes out.
--
-- Two columns, so the row can show that a person changed it. The original
-- system wording is not lost: the audit trail carries it, as it must wherever
-- a user edit overwrites something the system recorded.
USE classroom_app;

ALTER TABLE reminders
  ADD COLUMN message_edited_at DATETIME NULL AFTER message,
  ADD COLUMN message_edited_by INT      NULL AFTER message_edited_at,
  ADD CONSTRAINT fk_reminders_edited_by FOREIGN KEY (message_edited_by) REFERENCES users(id) ON DELETE SET NULL;

SELECT COUNT(*) AS reminders, SUM(message_edited_at IS NOT NULL) AS edited FROM reminders;
