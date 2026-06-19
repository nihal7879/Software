-- ============================================================================
-- Seed data — derived from the real Trail workbook.
-- Includes edge cases: negative Hours Left, SP-Active, group lecture,
-- a student with 3 teachers (Sofia), discount/adjusted hours, AED amounts.
--
-- NOTE: password_hash below is bcrypt for the password "password123".
--       Generate your own with: node server/scripts/hash.js <password>
-- ============================================================================
USE tuition_erp;

SET @PW := '$2b$10$N9qo8uLOickgx2ZMRZoMy.MrqK0nVfA0p8ZQ4tQ7tQ7tQ7tQ7tQ7'; -- placeholder, replace via hash.js

-- Branches -------------------------------------------------------------------
INSERT INTO branches (name, location) VALUES
  ('JLT Branch', 'Jumeirah Lakes Towers, Dubai'),
  ('Oud Metha Branch', 'Oud Metha, Dubai'),
  ('Online', 'Remote');

-- Users (admin, one faculty, one student, one parent) ------------------------
INSERT INTO users (role, email, password_hash, display_name, branch_id) VALUES
  ('admin',   'admin@tuition.ae',   @PW, 'Institute Admin', 1),
  ('faculty', 'sachin@tuition.ae',  @PW, 'Sachin Chawan',   1),
  ('student', 'sofia@tuition.ae',   @PW, 'Sofia',           3),
  ('parent',  'zelia@tuition.ae',   @PW, 'Zelia Campos',    3);

-- Subjects -------------------------------------------------------------------
INSERT INTO subjects (name) VALUES ('Chemistry'), ('Physics'), ('Maths');

-- Teachers -------------------------------------------------------------------
INSERT INTO teachers (name, email, mobile, specialization, branch_id, user_id) VALUES
  ('Krishna Wadhvani', NULL, NULL, 'Chemistry/Maths', 1, NULL),
  ('Chandresh Fooria', NULL, NULL, 'Physics',         1, NULL),
  ('Chetan Masurkar',  NULL, NULL, 'Physics',         3, NULL),
  ('Sachin Chawan',    'sachin@tuition.ae', NULL, 'Chemistry', 1, 2),
  ('Prabhu Paul',      NULL, NULL, 'Chemistry',       2, NULL),
  ('Sumit Jain',       NULL, NULL, 'Maths',           1, NULL);

-- Students (Student Master) --------------------------------------------------
-- form 20 = Sofia (the detailed-tracked student), plus the 6 ledger students.
INSERT INTO students
  (form_no, date_of_joining, status, first_name, middle_name, last_name, full_name,
   year_grade, school_name, exam_board, father_name, mother_name, relationship,
   email, age, gender, nationality, student_mobile, parent_mobile, extra_mobile,
   fees_received, form_received, branch_id, user_id) VALUES
  ('1','2025-09-01','Inactive','Akanksha',NULL,'Mahapatra','Akanksha Mahapatra',
    'Y13','XYZ School','IAL','Dhaval k Jasani','Sunita Rath','Mother',
    'xyz@gmail.com',16,'Female','Indian','971 11 111 1111','971 11 111 1111',NULL,150,TRUE,1,NULL),
  ('2',NULL,'SP-Active','Dhanvir','Dhaval','Jasani','Dhanvir Dhaval Jasani',
    'Y13','XYZ School','AS','Dhaval k Jasani',NULL,'Father',
    'xyz@gmail.com',17,'Male','Indian','971 11 111 1111','971 11 111 1111','971 11 111 1111',0,TRUE,1,NULL),
  ('3',NULL,'Active','Aadam',NULL,'Khalique','Aadam Khalique',
    'Y11','XYZ School','AQA','Arsalan Balal Khalique',NULL,'Father',
    NULL,NULL,'Male','Indian','971 11 111 1111','971 11 111 1111','971 11 111 1111',250,FALSE,1,NULL),
  ('4',NULL,'Active','Nikita',NULL,'Jain','Nikita Jain',
    'Y11','XYZ School',NULL,'Sumit Jain',NULL,'Father',
    NULL,15,'Female','Indian','971 11 111 1111','971 11 111 1111','971 11 111 1111',450,TRUE,1,NULL),
  ('5',NULL,'SP-Active','Kartik','Rajiv','Raipancholia','Kartik Raipancholia',
    'Y11',NULL,NULL,NULL,'Archana Rajiv Raipancholia','Mother',
    NULL,15,'Male','Indian','971 11 111 1111','971 11 111 1111','971 11 111 1111',0,TRUE,1,NULL),
  ('6',NULL,'Inactive','Bora',NULL,NULL,'Bora',
    'Y12',NULL,NULL,NULL,NULL,'Father',
    NULL,NULL,NULL,'Indian','971 11 111 1111','971 11 111 1111',NULL,0,FALSE,1,NULL),
  ('20','2025-09-17','Active','Sofia',NULL,NULL,'Sofia',
    'Y12','XYZ School','IB',NULL,'Zelia Campos Dionisio','Mother',
    'sofia@tuition.ae',16,'Female','Portuguese','971 11 111 1111','971 11 111 1111',NULL,420,TRUE,3,3);

-- Link Sofia's user + parent
INSERT INTO parents (student_id, user_id, name, mobile, relationship)
  VALUES ((SELECT id FROM students WHERE form_no='20'), 4, 'Zelia Campos Dionisio', '971 11 111 1111', 'Mother');

-- Student<->Teacher mapping --------------------------------------------------
-- Sofia (form 20) is taught by Sachin Chawan, Chetan Masurkar, Prabhu Paul (Chemistry/Physics)
INSERT INTO student_teacher_mapping (student_id, teacher_id, subject_id, package_hours)
SELECT s.id, t.id, sub.id, 0 FROM students s, teachers t, subjects sub
WHERE s.form_no='20' AND sub.name='Chemistry' AND t.name IN ('Sachin Chawan','Prabhu Paul');
INSERT INTO student_teacher_mapping (student_id, teacher_id, subject_id, package_hours)
SELECT s.id, t.id, sub.id, 0 FROM students s, teachers t, subjects sub
WHERE s.form_no='20' AND sub.name='Physics' AND t.name='Chetan Masurkar';

-- Fee packages (154-Summary: committed/discount/adjusted/rate) ----------------
-- Values chosen so the VIEW reproduces the sheet's Hours Left & status.
INSERT INTO fee_packages (student_id, course_name, package_hours, rate_per_hour, discount_hours, adjusted_hours, start_date) VALUES
  ((SELECT id FROM students WHERE form_no='1'), 'IAL Chemistry', 219.5, 0,    0, 0,   '2025-09-01'),
  ((SELECT id FROM students WHERE form_no='2'), 'AS Sciences',   0,     0,    0, 0.2, '2025-09-01'),
  ((SELECT id FROM students WHERE form_no='3'), 'AQA Chemistry', 80,    105,  0, 0,   '2025-10-01'),
  ((SELECT id FROM students WHERE form_no='4'), 'Maths Package', 223,   105,  0, 0.1, '2025-10-01'),
  ((SELECT id FROM students WHERE form_no='5'), 'Combined',      45,    0,    0, 0,   '2025-10-01'),
  ((SELECT id FROM students WHERE form_no='6'), 'Trial Package', 9,     140,  0, 0,   '2025-12-01'),
  ((SELECT id FROM students WHERE form_no='20'),'IB Chemistry',  60,    105,  0, 0,   '2025-09-17');

-- Ledger adjustments (amount credited / pending fees / extra left) ------------
INSERT INTO ledger_adjustments (student_id, amount_credited, pending_fees, extra_amount_left) VALUES
  ((SELECT id FROM students WHERE form_no='1'), 1234, 0,   0),
  ((SELECT id FROM students WHERE form_no='2'), 321,  0,   0),
  ((SELECT id FROM students WHERE form_no='3'), 456,  0,   123),
  ((SELECT id FROM students WHERE form_no='4'), 4500, 0,   12),
  ((SELECT id FROM students WHERE form_no='5'), 789,  0,   0),
  ((SELECT id FROM students WHERE form_no='6'), 125,  210, -210),
  ((SELECT id FROM students WHERE form_no='20'),420,  0,   0);

-- ----------------------------------------------------------------------------
-- Lectures. To reproduce the ledger's "consumed" totals without inserting
-- hundreds of rows, we insert one summarising lecture per student carrying the
-- total consumed hours, PLUS a few real detailed Sofia lectures + a GROUP lecture.
-- (The student_hours_summary view sums lecture_attendees.hours_consumed.)
-- ----------------------------------------------------------------------------

-- Summarising consumption rows (back-fill of historical totals) --------------
-- Akanksha 219.5, Dhanvir 272.5, Aadam 71.8, Nikita 219.5, Kartik 158.1, Bora 10.5
INSERT INTO lecture_sessions (session_date, month, teacher_id, subject_id, total_hours, hours_rounded, topic, venue, created_by) VALUES
  ('2026-04-01','2026-04',(SELECT id FROM teachers WHERE name='Krishna Wadhvani'),(SELECT id FROM subjects WHERE name='Chemistry'),219.5,219.5,'Historical consumption back-fill','JLT',1),
  ('2026-04-20','2026-04',(SELECT id FROM teachers WHERE name='Krishna Wadhvani'),(SELECT id FROM subjects WHERE name='Chemistry'),272.5,272.5,'Historical consumption back-fill','JLT',1),
  ('2026-05-14','2026-05',(SELECT id FROM teachers WHERE name='Krishna Wadhvani'),(SELECT id FROM subjects WHERE name='Chemistry'),71.8,71.8,'Historical consumption back-fill','JLT',1),
  ('2026-05-16','2026-05',(SELECT id FROM teachers WHERE name='Sumit Jain'),(SELECT id FROM subjects WHERE name='Maths'),219.5,219.5,'Historical consumption back-fill','JLT',1),
  ('2026-05-16','2026-05',(SELECT id FROM teachers WHERE name='Chetan Masurkar'),(SELECT id FROM subjects WHERE name='Physics'),158.1,158.1,'Historical consumption back-fill','JLT',1),
  ('2026-02-06','2026-02',(SELECT id FROM teachers WHERE name='Prabhu Paul'),(SELECT id FROM subjects WHERE name='Chemistry'),10.5,10.5,'Historical consumption back-fill','JLT',1);

INSERT INTO lecture_attendees (lecture_id, student_id, hours_consumed) VALUES
  ((SELECT id FROM lecture_sessions WHERE topic='Historical consumption back-fill' AND total_hours=219.5 AND month='2026-04'),(SELECT id FROM students WHERE form_no='1'),219.5),
  ((SELECT id FROM lecture_sessions WHERE total_hours=272.5),(SELECT id FROM students WHERE form_no='2'),272.5),
  ((SELECT id FROM lecture_sessions WHERE total_hours=71.8),(SELECT id FROM students WHERE form_no='3'),71.8),
  ((SELECT id FROM lecture_sessions WHERE total_hours=219.5 AND month='2026-05'),(SELECT id FROM students WHERE form_no='4'),219.5),
  ((SELECT id FROM lecture_sessions WHERE total_hours=158.1),(SELECT id FROM students WHERE form_no='5'),158.1),
  ((SELECT id FROM lecture_sessions WHERE total_hours=10.5),(SELECT id FROM students WHERE form_no='6'),10.5);

-- A few real detailed Sofia (form 20) lectures -------------------------------
INSERT INTO lecture_sessions (session_date, month, teacher_id, subject_id, time_in, time_out, total_hours, hours_rounded, topic, venue, created_by) VALUES
  ('2026-05-29','2026-05',(SELECT id FROM teachers WHERE name='Sachin Chawan'),(SELECT id FROM subjects WHERE name='Chemistry'),'12:00:00','15:00:00',3.0,3,'Revision marathon','JLT',2),
  ('2026-05-30','2026-05',(SELECT id FROM teachers WHERE name='Sachin Chawan'),(SELECT id FROM subjects WHERE name='Chemistry'),'14:30:00','18:00:00',3.5,3.5,'Mock paper','JLT',2),
  ('2026-06-01','2026-06',(SELECT id FROM teachers WHERE name='Sachin Chawan'),(SELECT id FROM subjects WHERE name='Chemistry'),'10:30:00','16:00:00',5.5,5.5,'Final prep','JLT',2);

INSERT INTO lecture_attendees (lecture_id, student_id, hours_consumed) VALUES
  ((SELECT id FROM lecture_sessions WHERE topic='Revision marathon'),(SELECT id FROM students WHERE form_no='20'),3.0),
  ((SELECT id FROM lecture_sessions WHERE topic='Mock paper'),(SELECT id FROM students WHERE form_no='20'),3.5),
  ((SELECT id FROM lecture_sessions WHERE topic='Final prep'),(SELECT id FROM students WHERE form_no='20'),5.5);

-- A GROUP lecture: one session, multiple attendees ---------------------------
INSERT INTO lecture_sessions (session_date, month, teacher_id, subject_id, time_in, time_out, total_hours, hours_rounded, topic, venue, created_by)
VALUES ('2026-06-09','2026-06',(SELECT id FROM teachers WHERE name='Krishna Wadhvani'),(SELECT id FROM subjects WHERE name='Chemistry'),'17:00:00','19:00:00',2.0,2,'Born Haber cycle (group)','JLT',1);
INSERT INTO lecture_attendees (lecture_id, student_id, hours_consumed) VALUES
  ((SELECT id FROM lecture_sessions WHERE topic='Born Haber cycle (group)'),(SELECT id FROM students WHERE form_no='3'),2.0),
  ((SELECT id FROM lecture_sessions WHERE topic='Born Haber cycle (group)'),(SELECT id FROM students WHERE form_no='4'),2.0);

-- Fee transactions (Total Fees) ----------------------------------------------
INSERT INTO fee_transactions (student_id, parent_name, amount, payment_date, month, transaction_reference, payment_source, course_package_hours, notes, created_by) VALUES
  ((SELECT id FROM students WHERE form_no='4'), 'Sumit Jain', 350, '2026-06-09','2026-06','MWM000000','MASHQ FUND TRANSFER',33,'Summary of classes done with Nikita. 29.5 hours completed till date.',1),
  ((SELECT id FROM students WHERE form_no='20'),'Zelia Campos Dionisio', 150,'2026-06-10','2026-06','AEXXXXXXXXX','MASHQ Inward Remittance',30,'Package of 30 hours, 25.5 already completed.',1),
  ((SELECT id FROM students WHERE form_no='2'), 'Rajiv Ramesh Thakur', 500,'2026-06-06','2026-06','AEXXXXXXXXX','MASHQ FUND TRANSFER',NULL,'Tuition fees for June.',1),
  ((SELECT id FROM students WHERE form_no='3'), 'Ankit Goyal', 420,'2026-06-04','2026-06','AEXXXXXXX','MASHQ Inward Remittance',30,'Record of sessions; 4.8 additional hours after initial package. Renew 30 hours.',1);

-- Seeded students already have full details → mark their profiles complete.
UPDATE students SET profile_completed = TRUE;
