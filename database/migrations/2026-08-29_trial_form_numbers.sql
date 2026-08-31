-- ============================================================================
-- Trials keep out of the enrolment sequence
--
-- Form numbers were the student's DB id, so a trial consumed one the moment
-- they were created. A trial is a prospect, not an enrolment: most never join,
-- and each one that doesn't leaves a permanent hole in a sequence the client
-- reads as "how many students we have". Two of the five demo students imported
-- so far are exactly this case.
--
-- From here trials are numbered T1, T2, T3 … on their own counter, and take a
-- real form number only when they convert — 177 enrolled students means the
-- next one enrolled is 178. The number is assigned by the API (see
-- server/src/utils/formNo.ts); this migration only moves the trials that are
-- already in the table off the enrolment sequence.
--
-- Nothing joins on form_no — every table references students.id — so the
-- renumber cannot orphan a lecture, payment or parent link. What it does break
-- is anything printed or emailed during the trial that quotes the old number,
-- so each old value is written to audit_logs before it is overwritten.
-- ============================================================================
USE classroom_app;

-- Materialised first: MySQL will not let one statement renumber students while
-- reading their row numbers back out of the same table.
--
-- The columns are declared rather than inferred from the SELECT. students.form_no
-- is utf8mb4_general_ci while CONCAT() returns the database default, and comparing
-- the two straight out of a CREATE ... AS SELECT fails with "Illegal mix of
-- collations". Declaring both as one column type puts them in one collation.
CREATE TEMPORARY TABLE trial_renumber (
  id          INT PRIMARY KEY,
  old_form_no VARCHAR(40),
  new_form_no VARCHAR(40)
);

INSERT INTO trial_renumber (id, old_form_no, new_form_no)
SELECT id,
       form_no,
       CONCAT('T', ROW_NUMBER() OVER (ORDER BY id))
  FROM students
 WHERE student_type = 'Trial';

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, before_json, after_json)
SELECT NULL, 'RENUMBER_TRIAL', 'student', t.id,
       JSON_OBJECT('form_no', t.old_form_no),
       JSON_OBJECT('form_no', t.new_form_no,
                   'reason', 'trials no longer hold an enrolment number until they enroll')
  FROM trial_renumber t
 WHERE t.old_form_no <> t.new_form_no;

UPDATE students s
  JOIN trial_renumber t ON t.id = s.id
   SET s.form_no = t.new_form_no;

DROP TEMPORARY TABLE trial_renumber;

-- The freed numbers are deliberately NOT backfilled to later students: form
-- numbers already in use stay put, and the next enrolment simply continues from
-- the highest one. Reissuing a gap would point two students at one number in
-- every register printed before today.
SELECT form_no, full_name, student_type, trial_started_on
  FROM students
 WHERE student_type = 'Trial'
 ORDER BY CAST(SUBSTRING(form_no, 2) AS UNSIGNED);
