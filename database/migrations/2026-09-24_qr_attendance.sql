-- QR check-in: students scan their teacher's code at the start and end of a
-- class, and the teacher confirms it afterwards with the subject, venue, topic
-- and remark.
--
-- Two tables and one column, all additions. Nothing existing changes, and until
-- a teacher confirms a class nothing reaches lecture_sessions, so hours and
-- statements are untouched by anything scanned.
--
-- Times are Dubai: every connection now runs SET time_zone = '+04:00', so NOW()
-- and these TIMESTAMP columns read on the institute's own clock.
USE classroom_app;

-- The code printed and stuck on a teacher's desk. Fixed, not rotating: the
-- client accepted that a photograph of it could be used from elsewhere, because
-- nothing counts until the teacher confirms the class.
ALTER TABLE teachers
  ADD COLUMN qr_code CHAR(12) NULL UNIQUE AFTER user_id;

-- A class opened by the first scan of the day for that teacher, waiting to be
-- confirmed. Confirming writes a normal lecture and points lecture_id at it.
CREATE TABLE IF NOT EXISTS class_sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id    INT          NOT NULL,
  session_date  DATE         NOT NULL,              -- the Dubai date of the first scan
  opened_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at     TIMESTAMP    NULL,                  -- when the teacher confirmed it
  status        ENUM('Open','Confirmed','Cancelled') NOT NULL DEFAULT 'Open',
  lecture_id    INT          NULL,                  -- the lecture it became
  confirmed_by  INT          NULL,
  is_deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_cs_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT fk_cs_lecture FOREIGN KEY (lecture_id) REFERENCES lecture_sessions(id),
  INDEX idx_cs_teacher_day (teacher_id, session_date, status)
);

-- One student's attendance of that class: when they scanned in, and out.
-- A student is charged their OWN time, not the class window — arriving at 4:15
-- and leaving at 5:20 is 1.08 hours for them, whatever everyone else did — so
-- the minutes are kept per student and the hours worked out from them.
CREATE TABLE IF NOT EXISTS class_checkins (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  class_session_id  INT          NOT NULL,
  student_id        INT          NOT NULL,
  in_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  out_at            TIMESTAMP    NULL,               -- null until they scan out
  -- Filled when the teacher confirms: (out_at - in_at) in hours, or the class
  -- window if they forgot to scan out and the teacher fills the time in.
  hours             DECIMAL(6,2) NULL,
  scanned_ip        VARCHAR(45)  NULL,
  scanned_gps       VARCHAR(60)  NULL,
  scanned_device    VARCHAR(120) NULL,
  is_deleted        TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_ck_session FOREIGN KEY (class_session_id) REFERENCES class_sessions(id),
  CONSTRAINT fk_ck_student FOREIGN KEY (student_id) REFERENCES students(id),
  -- One row per student per class; scanning out updates it rather than adding.
  UNIQUE KEY uq_checkin (class_session_id, student_id),
  INDEX idx_ck_student (student_id, in_at)
);
