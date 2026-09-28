-- Who did it: the office, or the super admin.
--
-- The log has always held the user id, but answering "was this the admin or the
-- super admin" meant joining to users and reading the role they hold TODAY. A
-- role can change, and then the history reads wrong.
--
-- The role is now stamped on the entry as it was at the time, filled in by the
-- same INSERT so nothing extra is fetched. Existing rows are backfilled from
-- the role each user holds now, which is the best that can be known for them.
USE classroom_app;

ALTER TABLE audit_logs
  ADD COLUMN actor_role VARCHAR(20) NULL AFTER user_id;

UPDATE audit_logs a
   JOIN users u ON u.id = a.user_id
    SET a.actor_role = u.role
  WHERE a.actor_role IS NULL;

-- "Everything the office did last week", without a join.
CREATE INDEX idx_audit_role ON audit_logs (actor_role, created_at);
