-- Student self-registration now waits for an administrator.
--
-- A registration used to create a live login and an enrolled student record on
-- the spot, so anyone with the link was a student the moment they pressed
-- Register. It now lands here instead, as a request. Nothing in `users` or
-- `students` exists until an admin approves it — at which point they choose
-- Trial or Enrolled, the right kind of form number is claimed, and the login is
-- created. Until then the student cannot sign in, and no student list, hours
-- total or form-number counter ever sees a half-made student.
--
-- The password is stored hashed at registration time, so approval never needs
-- the student to set it again and the admin never sees it.
USE classroom_app;

CREATE TABLE IF NOT EXISTS student_registrations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  first_name      VARCHAR(80)  NOT NULL,
  last_name       VARCHAR(80)  NULL,
  email           VARCHAR(160) NOT NULL,
  mobile          VARCHAR(40)  NULL,
  password_hash   VARCHAR(255) NOT NULL,
  status          ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  -- Filled on approval: the student record it became, and as what.
  student_id      INT NULL,
  approved_as     ENUM('Trial','Enrolled') NULL,
  reject_reason   VARCHAR(255) NULL,
  reviewed_by     INT NULL,
  reviewed_at     DATETIME NULL,
  registration_ip     VARCHAR(64)  NULL,
  registration_gps    VARCHAR(64)  NULL,
  registration_device VARCHAR(255) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reg_status (status),
  INDEX idx_reg_email (email)
);
