-- ============================================================================
-- A teacher mapping without a subject
--
-- The Students master screen reads student_teacher_mapping for its "Teachers"
-- column. That table required a subject, so a student whose lectures record a
-- teacher but no subject could not be mapped at all and their Teachers cell
-- rendered empty — even though the teacher is known and sitting right there in
-- lecture_sessions.
--
-- 2,854 of 7,432 lectures have no subject recorded, while only 2 have no
-- teacher. Requiring the subject to record the teacher throws away the fact we
-- have in order to demand the one we don't. Seven students were affected:
-- Alayna, Hadi, Rayed, Ahan, Myrah Singhal, Maira and Aarna Srivastav.
--
-- The subject cannot simply be guessed from the teacher. Krishna Wadhvani — who
-- teaches five of those seven — has taught Chemistry 791 times, Physics 660,
-- Biology 461 and Maths 130. Any guess would be wrong most of the time, and a
-- wrong subject on a student's record is worse than a blank one.
--
-- So the subject becomes optional. Filling it in later is still an improvement;
-- it is no longer the price of recording the teacher.
--
-- Every read of this table that joins `subjects` must be a LEFT JOIN from here
-- on, or subject-less mappings silently vanish from the teacher's roster. The
-- four affected queries in server/src/routes/teachers.ts are updated alongside
-- this migration.
-- ============================================================================
USE classroom_app;

ALTER TABLE student_teacher_mapping
  MODIFY subject_id INT NULL;

-- Note on uq_stm (student_id, teacher_id, subject_id): MySQL treats NULLs as
-- distinct in a UNIQUE index, so this constraint no longer blocks a duplicate
-- (student, teacher, NULL) pair. Inserts must therefore dedupe explicitly with
-- a NULL-safe comparison (`<=>`), which backfill-teacher-mappings.js does.
