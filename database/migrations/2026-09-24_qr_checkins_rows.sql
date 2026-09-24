-- QR check-in, one row per student — not a class with a group of students in it.
--
-- A scan records the student, their teacher, the date and the time in; the
-- second scan fills the time out. Each row then waits in the teacher's inbox
-- like an imported payment waits in Finance: the teacher fills the subject,
-- topic, subtopic and remark, and confirms. Confirming writes a real lecture
-- for that one student and charges them THEIR OWN time — in 4:15, out 5:20 is
-- 1.08 hours for them, whatever anyone else in the room did.
--
-- Rows on the same day can be filled in together (tick several, apply the same
-- subject and topic), but they stay separate rows and separate lectures.
--
-- This replaces yesterday's class_sessions / class_checkins pair, which grouped
-- students into one class. Nothing used them yet, so they go.
USE classroom_app;

DROP TABLE IF EXISTS class_checkins;
DROP TABLE IF EXISTS class_sessions;

CREATE TABLE IF NOT EXISTS lecture_checkins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id    INT          NOT NULL,              -- whose QR was scanned
  student_id    INT          NOT NULL,
  session_date  DATE         NOT NULL,              -- the Dubai date of the first scan
  in_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  out_at        TIMESTAMP    NULL,                  -- null until they scan out
  hours         DECIMAL(6,2) NULL,                  -- out - in, worked out when confirmed

  -- What the teacher fills in afterwards. All optional at scan time.
  subject_id    INT          NULL,
  topic         VARCHAR(200) NULL,
  subtopic      VARCHAR(200) NULL,
  remark        VARCHAR(500) NULL,
  venue         VARCHAR(80)  NULL,
  meeting_link  VARCHAR(255) NULL,

  status        ENUM('Pending','Confirmed','Discarded') NOT NULL DEFAULT 'Pending',
  lecture_id    INT          NULL,                  -- the lecture this became
  confirmed_by  INT          NULL,
  confirmed_at  TIMESTAMP    NULL,

  -- Where the scan came from, for checking a disputed attendance.
  scanned_ip     VARCHAR(45)  NULL,
  scanned_gps    VARCHAR(60)  NULL,
  scanned_device VARCHAR(120) NULL,

  is_deleted    TINYINT(1)   NOT NULL DEFAULT 0,

  CONSTRAINT fk_lc_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT fk_lc_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_lc_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_lc_lecture FOREIGN KEY (lecture_id) REFERENCES lecture_sessions(id),

  -- The teacher's inbox: today's pending rows, newest first.
  INDEX idx_lc_teacher_day (teacher_id, session_date, status),
  -- A student's own attendance history.
  INDEX idx_lc_student (student_id, session_date)
);
