-- `relationship` answers "who pays for this student". It defaulted to 'Father',
-- so every row claimed a father whether or not one was ever recorded — 65 of
-- 183 students were showing a "Father" chip next to an empty parent name.
--
-- The column now defaults to NULL, meaning "not set yet", and the existing rows
-- that named a relation without naming the person are cleared to match.
-- Rows where the named parent does exist are left untouched.
USE classroom_app;

ALTER TABLE students
  MODIFY COLUMN relationship ENUM('Father','Mother','Guardian') NULL DEFAULT NULL;

UPDATE students
   SET relationship = NULL
 WHERE relationship IS NOT NULL
   AND COALESCE(
         CASE relationship
           WHEN 'Mother' THEN mother_name
           WHEN 'Father' THEN father_name
           ELSE COALESCE(father_name, mother_name)
         END, '') = '';
