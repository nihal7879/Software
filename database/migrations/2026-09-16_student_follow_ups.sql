-- Follow-up notes on a student, written from Student Hours while chasing fees:
-- "Called the mother, paying Friday", "Left a message". Every note is kept, so
-- the history of chasing a student is visible, not just the last line.
--
-- `follow_up_on` is the optional date to come back to them — the promised
-- payment date, say — which the list flags when it falls due.
USE classroom_app;

CREATE TABLE IF NOT EXISTS student_follow_ups (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_id    INT          NOT NULL,
  note          VARCHAR(500) NOT NULL,
  follow_up_on  DATE         NULL,
  created_by    INT          NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_followup_student (student_id, id)
);
