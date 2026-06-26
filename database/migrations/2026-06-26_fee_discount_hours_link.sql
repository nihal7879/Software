-- Finance: store discount_hours on a fee transaction (fixes "Unknown column
-- 'discount_hours'" crash when editing a payment) and link each credited
-- fee_package back to its source transaction so deleting the transaction also
-- removes those hours from every student hours statement.
-- Run: node scripts/run-sql.js ../database/migrations/2026-06-26_fee_discount_hours_link.sql

ALTER TABLE fee_transactions   ADD COLUMN discount_hours DECIMAL(8,2) AFTER course_package_hours;
ALTER TABLE fee_import_drafts  ADD COLUMN discount_hours DECIMAL(8,2) AFTER course_package_hours;
ALTER TABLE fee_packages       ADD COLUMN transaction_id INT AFTER student_id;

CREATE INDEX idx_pkg_transaction ON fee_packages (transaction_id);
