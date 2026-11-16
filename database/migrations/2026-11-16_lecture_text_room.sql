-- Room for what a teacher actually writes.
--
-- The bug the teachers hit: a scan's remark may be 500 characters
-- (lecture_checkins.remark VARCHAR(500)), but confirming that scan copies it
-- into lecture_sessions.remark, which was VARCHAR(400). With
-- STRICT_TRANS_TABLES on — it is — MySQL refuses the insert rather than
-- truncating, the route throws ER_DATA_TOO_LONG, and the teacher is shown
-- "Something went wrong at our end." The class cannot be entered at all, and
-- the only pattern they could see was that a short remark works.
--
-- One scan was sitting in Sachin's inbox with a 492-character remark, failing
-- every time he pressed Confirm.
--
-- So the remark becomes TEXT in both tables — a teacher's note about a class
-- is prose, and there is no reason to ration it — and the two tables are made
-- to agree on every other field a scan carries into a lecture, so nothing can
-- fit in one and not the other again:
--
--   topic / subtopic   200 on a scan, 255 on a lecture  -> 255 on both
--   remark             500 on a scan, 400 on a lecture  -> TEXT on both
--   meeting_link       255 on a scan, 400 on a lecture  -> 500 on both
--
-- lecture_attendees.homework and .notes are the same shape of risk — per
-- student prose in a VARCHAR(400). Nobody has filled one in yet, so this is
-- before the fact rather than after it.
--
-- Widening a column rewrites no data and loses nothing.

ALTER TABLE lecture_sessions
  MODIFY topic        VARCHAR(255) NULL,
  MODIFY subtopic     VARCHAR(255) NULL,
  MODIFY remark       TEXT         NULL,
  MODIFY meeting_link VARCHAR(500) NULL;

ALTER TABLE lecture_checkins
  MODIFY topic        VARCHAR(255) NULL,
  MODIFY subtopic     VARCHAR(255) NULL,
  MODIFY remark       TEXT         NULL,
  MODIFY meeting_link VARCHAR(500) NULL;

ALTER TABLE lecture_attendees
  MODIFY homework TEXT NULL,
  MODIFY notes    TEXT NULL;

-- What the two tables now say about the same four fields.
SELECT table_name, column_name, column_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND ((table_name IN ('lecture_sessions', 'lecture_checkins')
         AND column_name IN ('topic', 'subtopic', 'remark', 'meeting_link'))
     OR (table_name = 'lecture_attendees' AND column_name IN ('homework', 'notes')))
 ORDER BY column_name, table_name;
