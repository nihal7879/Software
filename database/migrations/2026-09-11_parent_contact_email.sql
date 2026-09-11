-- Every registration now signs in with a chosen username (users.email holds it,
-- as it already does for most existing logins), so a parent's real email needs
-- somewhere to live that is not the login column. Teachers already have
-- teachers.email and students students.email; parents had nothing.
USE classroom_app;

ALTER TABLE parents
  ADD COLUMN email VARCHAR(160) NULL AFTER name;
