-- "Payment Required" now triggers when hours_left is 0 OR negative (was only < 0).
-- A student who has fully consumed their hours (0 left) should already be flagged
-- to pay, not wait until they go negative.
-- Run: node scripts/run-sql.js ../database/migrations/2026-06-26_payment_required_zero_hours.sql

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
    WHEN COALESCE(la.pending_fees,0) > 0
      OR ((COALESCE(pk.package_hours,0)+COALESCE(pk.discount_hours,0)+COALESCE(pk.adjusted_hours,0)+COALESCE(adj.total,0)) - COALESCE(con.consumed,0)) <= 0
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
