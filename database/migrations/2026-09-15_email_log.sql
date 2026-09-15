-- Every email the app tries to send, and what became of it.
--
-- Written for all three kinds — a new registration (to the admin), an approved
-- registration (to the student), and an hours statement (to a parent) — so it
-- is always possible to answer "was this person emailed?". While the SMTP
-- settings in server/.env are still placeholders, rows are recorded with status
-- 'not_configured' and nothing leaves the server.
USE classroom_app;

CREATE TABLE IF NOT EXISTS email_log (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  kind           VARCHAR(40)  NOT NULL,          -- registration_admin | registration_approved | hours_statement
  to_address     VARCHAR(500) NOT NULL,
  subject        VARCHAR(255) NOT NULL,
  status         ENUM('sent', 'failed', 'not_configured') NOT NULL,
  error          VARCHAR(500) NULL,
  attachment     VARCHAR(255) NULL,              -- file name only, never the file
  student_id     INT NULL,
  sent_by        INT NULL,                        -- the admin, when a person sent it
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_kind (kind),
  INDEX idx_email_student (student_id)
);
