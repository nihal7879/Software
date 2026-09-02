-- ============================================================================
-- A trial's number must not come back after they enrol
--
-- Trial numbers were handed out as MAX(current T-numbers) + 1. Enrolling
-- rewrites form_no from T-something to an enrolment number, so the trial's
-- T-number stopped counting and the maximum fell back — the next trial was
-- then given a number a different student had already used.
--
-- With T1..T10 in the table, enrolling Hind (T10) drops the maximum to T9 and
-- the next prospect is handed T10 again. Two people, one number, on every
-- register and message sent during either trial.
--
-- trial_form_no records the T-number at the moment it is issued and is never
-- cleared, so the counter only ever moves forward. It doubles as the record of
-- what an enrolled student was called while on trial, which the audit log
-- previously had to be read for.
-- ============================================================================
USE classroom_app;

ALTER TABLE students
  ADD COLUMN trial_form_no VARCHAR(10) NULL AFTER student_type;

-- Every trial currently in the table keeps the number it already holds.
UPDATE students
   SET trial_form_no = form_no
 WHERE form_no REGEXP '^T[0-9]+$';

-- Trials converted before this column existed would also need their old number
-- recovered from audit_logs. The two CONVERT entries on record predate
-- T-numbering entirely (both logged a null form_no, and both were reverted), so
-- there is nothing to recover — but the statement is written out rather than
-- assumed, in case this migration is run against another copy of the database.
UPDATE students s
  JOIN (
    SELECT entity_id AS id,
           MAX(before_json->>'$.form_no') AS old_form
      FROM audit_logs
     WHERE action = 'CONVERT'
       AND before_json->>'$.form_no' REGEXP '^T[0-9]+$'
     GROUP BY entity_id
  ) a ON a.id = s.id
   SET s.trial_form_no = a.old_form
 WHERE s.trial_form_no IS NULL;

SELECT form_no, trial_form_no, full_name, student_type
  FROM students
 WHERE trial_form_no IS NOT NULL
 ORDER BY CAST(SUBSTRING(trial_form_no, 2) AS UNSIGNED);
