-- An email address for each parent, beside their own mobile number.
--
-- Until now the only address on a student was the student's own, and 81 of 210
-- students have none at all. That matters more than it looks: the forgotten-
-- password flow emails a code to the address on file, so an account with no
-- address cannot recover itself — and it is the parents who read the statements
-- and need the notices.
--
-- One per person, not one for the family. The father and the mother usually
-- have different addresses, and the form already asks for them separately with
-- their own numbers; an address belongs to a person in the same way a mobile
-- does. Each sits directly after that person's mobile so the pair reads
-- together in the table and in a SELECT *.
USE classroom_app;

ALTER TABLE students
  ADD COLUMN father_email   VARCHAR(160) NULL AFTER father_mobile,
  ADD COLUMN mother_email   VARCHAR(160) NULL AFTER mother_mobile,
  ADD COLUMN guardian_email VARCHAR(160) NULL AFTER guardian_mobile;

-- Searched when the office looks a family up by address, and read by the
-- password reset when deciding where a code can go.
CREATE INDEX idx_students_father_email   ON students (father_email);
CREATE INDEX idx_students_mother_email   ON students (mother_email);
CREATE INDEX idx_students_guardian_email ON students (guardian_email);
