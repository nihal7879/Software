-- ============================================================================
-- Tuition Institute ERP — MySQL 8 Schema
-- Keyed on Form No. Currency: AED. Hours model is prepaid (can go negative).
-- ============================================================================

DROP DATABASE IF EXISTS tuition_erp;
CREATE DATABASE tuition_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tuition_erp;

-- ----------------------------------------------------------------------------
-- Branches (multi-branch support)
-- ----------------------------------------------------------------------------
CREATE TABLE branches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  location    VARCHAR(160),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- Users (auth + RBAC)
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  role          ENUM('student','parent','faculty','admin') NOT NULL,
  email         VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(160),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  registration_ip     VARCHAR(45),
  registration_gps    VARCHAR(60),
  registration_device VARCHAR(120),
  last_login_ip       VARCHAR(45),
  last_login_device   VARCHAR(120),
  last_login_at       DATETIME,
  branch_id     INT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Students (Student Master sheet) — Form No is the universal key
-- ----------------------------------------------------------------------------
CREATE TABLE students (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  form_no         VARCHAR(40) NOT NULL UNIQUE,
  date_of_joining DATE,
  status          ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  first_name      VARCHAR(80),
  middle_name     VARCHAR(80),
  last_name       VARCHAR(80),
  full_name       VARCHAR(200),
  year_grade      VARCHAR(20),          -- Y11, Y12, Y13...
  school_name     VARCHAR(160),
  exam_board      VARCHAR(40),          -- IB, IAL, IGCSE, AQA, AS, A-Level...
  father_name     VARCHAR(160),
  mother_name     VARCHAR(160),
  relationship    ENUM('Father','Mother','Guardian') DEFAULT 'Father',
  email           VARCHAR(160),
  dob             DATE,
  age             INT,
  gender          ENUM('Male','Female','Other'),
  nationality     VARCHAR(80),
  student_mobile  VARCHAR(40),
  parent_mobile   VARCHAR(40),
  extra_mobile    VARCHAR(40),
  fees_received   DECIMAL(10,2) DEFAULT 0,
  form_received   BOOLEAN NOT NULL DEFAULT FALSE,
  profile_completed    BOOLEAN NOT NULL DEFAULT FALSE,  -- student submitted their profile
  profile_submitted_at DATETIME NULL,
  user_id         INT,
  branch_id       INT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user   FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT fk_students_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  INDEX idx_students_status (status),
  INDEX idx_students_grade (year_grade),
  INDEX idx_students_board (exam_board)
);

-- ----------------------------------------------------------------------------
-- Parents
-- ----------------------------------------------------------------------------
CREATE TABLE parents (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,
  user_id      INT,
  name         VARCHAR(160),
  mobile       VARCHAR(40),
  relationship ENUM('Father','Mother','Guardian') DEFAULT 'Father',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_parents_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_parents_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Teachers
-- ----------------------------------------------------------------------------
CREATE TABLE teachers (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(160) NOT NULL,
  email          VARCHAR(160),
  mobile         VARCHAR(40),
  specialization VARCHAR(160),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  user_id        INT,
  branch_id      INT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_teachers_user   FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT fk_teachers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Subjects
-- ----------------------------------------------------------------------------
CREATE TABLE subjects (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- ----------------------------------------------------------------------------
-- Student <-> Teacher mapping (per subject). Many-to-many.
-- ----------------------------------------------------------------------------
CREATE TABLE student_teacher_mapping (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,
  teacher_id   INT NOT NULL,
  subject_id   INT NOT NULL,
  package_hours DECIMAL(8,2) DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stm_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_stm_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_stm_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_stm (student_id, teacher_id, subject_id)
);

-- ----------------------------------------------------------------------------
-- Lecture sessions (Combine Tracker). A session can have many attendees (group).
-- ----------------------------------------------------------------------------
CREATE TABLE lecture_sessions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_date  DATE NOT NULL,
  month         VARCHAR(7),               -- derived YYYY-MM
  teacher_id    INT,
  subject_id    INT,
  time_in       TIME,
  time_out      TIME,
  total_hours   DECIMAL(6,2) DEFAULT 0,   -- auto = time_out - time_in (decimal)
  hours_rounded DECIMAL(6,2) DEFAULT 0,

  topic         VARCHAR(255),             -- main topic
  subtopic      VARCHAR(255),             -- sub-topic under the topic
  remark        VARCHAR(400),             -- separate teacher remark
  venue         VARCHAR(80),              -- JLT, Online, Oud Metha...
  meeting_link  VARCHAR(400),            -- Google Meet / Zoom / recording
  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,
  branch_id     INT,
  created_by    INT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lec_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
  CONSTRAINT fk_lec_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL,
  CONSTRAINT fk_lec_branch  FOREIGN KEY (branch_id)  REFERENCES branches(id) ON DELETE SET NULL,
  INDEX idx_lec_date (session_date),
  INDEX idx_lec_month (month)
);

CREATE TABLE lecture_attendees (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  lecture_id        INT NOT NULL,
  student_id        INT NOT NULL,
  hours_consumed    DECIMAL(6,2) NOT NULL DEFAULT 0,
  attendance_status ENUM('Present','Absent','Late') NOT NULL DEFAULT 'Present',
  homework          VARCHAR(400),
  notes             VARCHAR(400),
  performance_rating TINYINT,            -- 1..5
  CONSTRAINT fk_att_lecture FOREIGN KEY (lecture_id) REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE KEY uq_att (lecture_id, student_id)
);

-- ----------------------------------------------------------------------------
-- Fee packages (154-Summary). Drives the hours ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE fee_packages (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  student_id      INT NOT NULL,
  transaction_id  INT,                               -- fee_transaction that created this credit (NULL = manual)
  course_name     VARCHAR(160),
  package_hours   DECIMAL(8,2) NOT NULL DEFAULT 0,   -- hours committed
  rate_per_hour   DECIMAL(10,2) DEFAULT 0,
  discount_hours  DECIMAL(8,2) DEFAULT 0,
  adjusted_hours  DECIMAL(8,2) DEFAULT 0,
  start_date      DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pkg_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- Fee transactions (Total Fees sheet)
-- ----------------------------------------------------------------------------
CREATE TABLE fee_transactions (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  student_id            INT NOT NULL,
  parent_name           VARCHAR(160),
  amount                DECIMAL(12,2) NOT NULL,   -- AED
  payment_date          DATE NOT NULL,
  month                 VARCHAR(7),                -- derived YYYY-MM
  transaction_reference VARCHAR(120),
  payment_source        VARCHAR(160),              -- e.g. MASHQ bank transfer
  course_package_hours  DECIMAL(8,2),
  discount_hours        DECIMAL(8,2),
  notes                 TEXT,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by            INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tx_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  INDEX idx_tx_month (month),
  INDEX idx_tx_date (payment_date)
);

-- ----------------------------------------------------------------------------
-- Manual ledger adjustments (pending fees / extra amount left)
-- ----------------------------------------------------------------------------
CREATE TABLE ledger_adjustments (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT NOT NULL UNIQUE,
  amount_credited   DECIMAL(12,2) DEFAULT 0,
  pending_fees      DECIMAL(12,2) DEFAULT 0,
  extra_amount_left DECIMAL(12,2) DEFAULT 0,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ladj_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- Finance Excel import — drafts queue (unmatched / incomplete rows)
-- ----------------------------------------------------------------------------
CREATE TABLE fee_import_drafts (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  student_id            INT NULL,
  guessed_form_no       VARCHAR(40),
  guessed_student_name  VARCHAR(200),
  amount                DECIMAL(12,2),
  payment_date          DATE NULL,
  month                 VARCHAR(7),
  transaction_reference VARCHAR(120),
  payment_source        VARCHAR(160),
  parent_name           VARCHAR(160),
  course_package_hours  DECIMAL(8,2) NULL,
  discount_hours        DECIMAL(8,2) NULL,
  notes                 TEXT,
  reason                VARCHAR(200),
  raw_json              JSON,
  status                ENUM('draft','imported','discarded') NOT NULL DEFAULT 'draft',
  created_by            INT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fid_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  INDEX idx_fid_status (status)
);

-- ----------------------------------------------------------------------------
-- Audit logs
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  action      VARCHAR(40),
  entity_type VARCHAR(60),
  entity_id   VARCHAR(60),
  before_json JSON,
  after_json  JSON,
  ip_address  VARCHAR(45),
  gps         VARCHAR(60),
  device      VARCHAR(120),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_created (created_at)
);

-- ============================================================================
-- VIEW: student_hours_summary  (the live ledger — Hours Left CAN be negative)
--   total_hours_credited = package_hours + discount_hours + adjusted_hours
--   total_hours_consumed = SUM(lecture_attendees.hours_consumed)
--   hours_left           = credited - consumed   (NOT clamped)
--   fee_status           = 'Payment Required' if hours_left<=0 (else Active)
-- ============================================================================
-- Manual hours adjustments (admin "Adjust Hours") — each a dated ledger event.
CREATE TABLE IF NOT EXISTS hours_adjustments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  student_id  INT NOT NULL,
  delta       DECIMAL(8,2) NOT NULL,
  reason      VARCHAR(255),
  created_by  INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ha_student (student_id)
);

CREATE OR REPLACE VIEW student_hours_summary AS
SELECT
  s.id                              AS student_id,
  s.form_no                         AS form_no,
  s.full_name                       AS student_name,
  s.status                          AS status,
  COALESCE(pk.package_hours,0)      AS hours_committed,
  COALESCE(pk.discount_hours,0)     AS discount_hours,
  COALESCE(pk.adjusted_hours,0) + COALESCE(adj.total,0)  AS adjusted_hours,
  COALESCE(pk.package_hours,0) + COALESCE(pk.discount_hours,0) + COALESCE(pk.adjusted_hours,0) + COALESCE(adj.total,0)
                                    AS total_hours_credited,
  COALESCE(con.consumed,0)          AS total_hours_consumed,
  (COALESCE(pk.package_hours,0) + COALESCE(pk.discount_hours,0) + COALESCE(pk.adjusted_hours,0) + COALESCE(adj.total,0))
    - COALESCE(con.consumed,0)      AS hours_left,
  COALESCE(pk.rate_per_hour,0)      AS rate_per_hour,
  COALESCE(la.amount_credited,0)    AS amount_credited,
  COALESCE(la.pending_fees,0)       AS pending_fees,
  COALESCE(la.extra_amount_left,0)  AS extra_amount_left,
  CASE
    WHEN ((COALESCE(pk.package_hours,0)+COALESCE(pk.discount_hours,0)+COALESCE(pk.adjusted_hours,0)+COALESCE(adj.total,0)) - COALESCE(con.consumed,0)) <= 0
    THEN 'Payment Required' ELSE 'Active'
  END                               AS fee_status,
  con.last_lecture_date             AS last_attended_lecture
FROM students s
LEFT JOIN (
  SELECT student_id,
         SUM(package_hours)  AS package_hours,
         SUM(discount_hours) AS discount_hours,
         SUM(adjusted_hours) AS adjusted_hours,
         MAX(rate_per_hour)  AS rate_per_hour
  FROM fee_packages WHERE is_active = TRUE GROUP BY student_id
) pk ON pk.student_id = s.id
LEFT JOIN (
  SELECT a.student_id,
         SUM(a.hours_consumed) AS consumed,
         MAX(l.session_date)   AS last_lecture_date
  FROM lecture_attendees a
  JOIN lecture_sessions l ON l.id = a.lecture_id
  GROUP BY a.student_id
) con ON con.student_id = s.id
LEFT JOIN (
  SELECT student_id, SUM(delta) AS total FROM hours_adjustments GROUP BY student_id
) adj ON adj.student_id = s.id
LEFT JOIN ledger_adjustments la ON la.student_id = s.id;
