-- A role above admin. The day-to-day admin runs students, hours, fees and
-- teachers; the super admin additionally sees the money overview (revenue,
-- pending fees, the revenue trend) and the Pivots reports.
--
-- Adding to the list only; every existing account keeps the role it has.
USE classroom_app;

ALTER TABLE users
  MODIFY COLUMN role ENUM('student','parent','faculty','admin','superadmin') NOT NULL;
