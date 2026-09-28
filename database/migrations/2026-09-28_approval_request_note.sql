-- Why the office is asking — a note written for the super admin alone.
--
-- Not to be confused with hours_adjustments.reason, which is the note printed
-- beside the entry on the student's statement and read by the family. This one
-- is the case the office makes for the change ("Mrs Khan called, the 12 June
-- class was cancelled by us") and it never leaves this table.
--
-- Required when the office asks for something; a super admin changing the
-- statement directly has nobody to explain it to, so theirs stays null.
USE classroom_app;

ALTER TABLE approvals
  ADD COLUMN request_note VARCHAR(500) NULL AFTER summary;
