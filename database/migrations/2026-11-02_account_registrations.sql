-- Teacher and parent self-registrations, held for an administrator.
--
-- Until now a teacher or parent who registered was signed in straight away.
-- The institute asked for them to wait for approval, as students already do.
--
-- A registration is only a request, like student_registrations: no users,
-- teachers or parents row exists until an admin approves it, and approving is
-- what creates them. Holding it here rather than as an inactive users row keeps
-- an unapproved teacher off every teacher list and workload count, and an
-- unapproved parent off the child's record, without each of those queries
-- having to learn to skip them.
--
-- The password is chosen at registration and kept only as its bcrypt hash; it
-- moves to users.password_hash on approval.

CREATE TABLE IF NOT EXISTS account_registrations (
  id INT NOT NULL AUTO_INCREMENT,
  role ENUM('faculty','parent') NOT NULL,
  username VARCHAR(160) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(160) NOT NULL,
  mobile VARCHAR(40) DEFAULT NULL,
  -- teacher
  specialization VARCHAR(500) DEFAULT NULL,
  -- parent: the child they were matched to by Form No (and DOB) at registration
  child_student_id INT DEFAULT NULL,
  relationship ENUM('Father','Mother','Guardian') DEFAULT NULL,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  reject_reason VARCHAR(255) DEFAULT NULL,
  -- the login created on approval
  user_id INT DEFAULT NULL,
  reviewed_by INT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  registration_ip VARCHAR(64) DEFAULT NULL,
  registration_gps VARCHAR(64) DEFAULT NULL,
  registration_device VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_acc_reg_status (status, role),
  KEY idx_acc_reg_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
