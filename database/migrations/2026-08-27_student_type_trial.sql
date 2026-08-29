-- ============================================================================
-- Trial students
--
-- "Demo" was being recorded inside the status column, which is why the source
-- workbook ended up with eight status values (Active, Inactive, SP-Active,
-- LP-Active, PK-Active, Demo, Demo 2, and a typo). Whether someone is a trial
-- is independent of whether they are currently studying, so it gets its own
-- column and `status` keeps meaning only Active / Inactive.
--
-- A trial converts by flipping this flag on the SAME student row, so every
-- trial lecture, the login and the parent record stay attached. Never create a
-- second student record on conversion.
--
-- A separate `billing_type` (Hourly / Monthly / Lump-sum) is still needed —
-- the client runs all three — but is deliberately left to a later migration.
-- ============================================================================
USE classroom_app;

ALTER TABLE students
  ADD COLUMN student_type      ENUM('Trial','Enrolled') NOT NULL DEFAULT 'Enrolled' AFTER status,
  ADD COLUMN trial_started_on  DATE NULL AFTER student_type,
  ADD COLUMN converted_on      DATE NULL AFTER trial_started_on,
  ADD COLUMN converted_by      INT  NULL AFTER converted_on,
  ADD INDEX idx_students_type (student_type);

-- Every existing student is a real enrolment.
UPDATE students SET student_type = 'Enrolled' WHERE student_type IS NULL;
