-- The profile form now asks for each family contact with their own number —
-- father, mother, or a guardian — instead of two names, a "relationship to the
-- child" dropdown and one shared "parent mobile".
--
-- Nothing is dropped. `relationship` and `parent_mobile` stay: parent_mobile is
-- what every list, search and teacher roster reads, so the server keeps it
-- filled with the family's first number when a profile is saved, and
-- relationship still says who pays. No backfill either — `relationship`
-- defaults to 'Father', so copying today's parent_mobile into father_mobile
-- would file some mothers' numbers under the father. The form instead
-- pre-fills the existing number where it most likely belongs, visibly, for
-- whoever next saves the profile to confirm.
USE classroom_app;

ALTER TABLE students
  ADD COLUMN father_mobile   VARCHAR(40)  NULL AFTER father_name,
  ADD COLUMN mother_mobile   VARCHAR(40)  NULL AFTER mother_name,
  ADD COLUMN guardian_name   VARCHAR(160) NULL AFTER mother_mobile,
  ADD COLUMN guardian_mobile VARCHAR(40)  NULL AFTER guardian_name;
