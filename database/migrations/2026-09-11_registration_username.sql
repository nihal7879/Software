-- Siblings share a parent's email, but each needs their own login.
--
-- A student registration now carries a username — what the student signs in
-- with, and unique across every login — separately from the email, which is
-- only a contact address and may be the same for a brother and sister. On
-- approval the login is created under the username (users.email already holds
-- plain usernames for many existing students, so sign-in needs no change).
--
-- Nullable: a request made before this column existed has no username, and is
-- approved under its email as before.
USE classroom_app;

ALTER TABLE student_registrations
  ADD COLUMN username VARCHAR(160) NULL AFTER email,
  ADD INDEX idx_reg_username (username);
