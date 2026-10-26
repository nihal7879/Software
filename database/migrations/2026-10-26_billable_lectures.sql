-- Billable and not billable lectures.
--
-- A lecture is taught either way; whether it comes off the family's balance is
-- a separate question. A make-up class for one the teacher had to cancel, a
-- free extra before an exam, a demo for a student still deciding — all of them
-- happened, all of them belong on the record with their real length, and none
-- of them should be charged.
--
-- Until now the only way to not charge for a class was to not record it, which
-- loses the teacher's work and the student's attendance, or to record it and
-- then correct the balance with an hours adjustment, which needs the super
-- admin and reads on the statement as if something went wrong.
--
-- So the flag goes on the ATTENDEE row, not the lecture: a group class can
-- quite reasonably be charged to four students and free for the fifth who was
-- sitting in. Everyone is billable by default — the normal case must be the one
-- nobody has to remember.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--   • The balance (credited − consumed) counts billable rows only.
--   • hours_consumed still holds the REAL length. A free class shows as 2 h on
--     the statement, marked free, rather than as a 0 h class that looks like a
--     mistake.
--   • The teacher's taught-hours figures count every row. The teacher worked
--     those hours whoever paid for them.
--   • Attendance, last-attended date and the lecture lists are untouched: the
--     student was there.
USE classroom_app;

-- Everything already recorded was charged, which is what DEFAULT TRUE makes of
-- the existing rows. No balance moves because of this migration.
ALTER TABLE lecture_attendees
  ADD COLUMN is_billable TINYINT(1) NOT NULL DEFAULT 1 AFTER hours_consumed;

-- The QR inbox carries the choice from the scan to the lecture it becomes, so
-- the teacher can mark a class free before confirming it rather than having to
-- go and correct it afterwards.
ALTER TABLE lecture_checkins
  ADD COLUMN is_billable TINYINT(1) NOT NULL DEFAULT 1 AFTER hours;

-- The summing index now carries the flag, so the balance subquery is still
-- answered from the index alone.
ALTER TABLE lecture_attendees
  ADD INDEX idx_att_student_billable (student_id, is_billable, is_deleted);

-- The view, rebuilt to match utils/hoursSummary.ts.
--
-- consumed uses SUM(CASE …) rather than a WHERE, because last_lecture_date is
-- worked out in the same subquery and must still see the free classes — the
-- student did attend them.
CREATE OR REPLACE VIEW student_hours_summary AS
SELECT
  s.id                              AS student_id,
  s.form_no                         AS form_no,
  s.full_name                       AS student_name,
  s.status                          AS status,
  s.student_type                    AS student_type,
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
    WHEN s.student_type = 'Trial' THEN 'Trial'
    WHEN ((COALESCE(pk.package_hours,0)+COALESCE(pk.discount_hours,0)+COALESCE(pk.adjusted_hours,0)+COALESCE(adj.total,0)) - COALESCE(con.consumed,0)) <= 0
    THEN 'Payment Required' ELSE 'In Credit'
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
         SUM(CASE WHEN a.is_billable = TRUE THEN a.hours_consumed ELSE 0 END) AS consumed,
         MAX(l.session_date)   AS last_lecture_date
  FROM lecture_attendees a
  JOIN lecture_sessions l ON l.id = a.lecture_id
  WHERE l.is_deleted = FALSE AND a.is_deleted = FALSE
  GROUP BY a.student_id
) con ON con.student_id = s.id
LEFT JOIN (
  SELECT student_id, SUM(delta) AS total FROM hours_adjustments
   WHERE is_deleted = FALSE GROUP BY student_id
) adj ON adj.student_id = s.id
LEFT JOIN ledger_adjustments la ON la.student_id = s.id;
