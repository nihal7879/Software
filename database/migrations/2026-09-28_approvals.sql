-- Approvals: the office proposes, the super admin decides.
--
-- This replaces the permission switches. The admin is no longer blocked from
-- anything — they enter the change as they always did — but a change that moves
-- a family's balance is held here until the super admin approves it, and only
-- then is it written to the live tables.
--
-- Nothing is written anywhere else while a request waits. That is deliberate:
-- the hours formula (utils/hoursSummary.ts) counts packages, attendee rows and
-- adjustments, and a "pending" row hidden inside any of those would have to be
-- excluded from every one of the many queries that read them. Holding the whole
-- change here instead means a pending request cannot leak into a balance, a
-- total, a statement or an export by being missed in one place.
--
-- payload holds everything needed to carry the change out on approval, so the
-- approving code applies exactly what the office typed and nothing is recomputed
-- from a stale page.
USE classroom_app;

CREATE TABLE IF NOT EXISTS approvals (
  id            INT AUTO_INCREMENT PRIMARY KEY,

  -- What the office is asking to do.
  kind          ENUM('hours_add','hours_deduct','hours_edit','hours_delete','fee_entry') NOT NULL,
  student_id    INT          NOT NULL,

  -- Everything needed to apply it, exactly as it was entered.
  payload       JSON         NOT NULL,

  -- The row it changes, when it changes one that already exists
  -- (an edit or a removal). Null for anything new.
  target_type   VARCHAR(32)  NULL,     -- 'hours_adjustment'
  target_id     INT          NULL,

  -- One line for the queue, written when the request is made, so the list reads
  -- the same later even if the underlying figures have moved on.
  summary       VARCHAR(255) NOT NULL,

  status        ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  requested_by  INT          NOT NULL,
  requested_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by    INT          NULL,
  decided_at    TIMESTAMP    NULL,
  -- Why it was turned down, so the office is told something useful.
  decision_note VARCHAR(255) NULL,

  -- What approving it created, so the queue can point at the result.
  result_type   VARCHAR(32)  NULL,
  result_id     INT          NULL,

  is_deleted    TINYINT(1)   NOT NULL DEFAULT 0,

  CONSTRAINT fk_appr_student   FOREIGN KEY (student_id)   REFERENCES students(id),
  CONSTRAINT fk_appr_requester FOREIGN KEY (requested_by) REFERENCES users(id),

  -- The queue: what is waiting, oldest first.
  INDEX idx_appr_status (status, requested_at),
  -- Everything ever asked for about one student.
  INDEX idx_appr_student (student_id, status)
);
