-- Reminders: the fee-chasing list the office asked for on 18 November 2026.
--
-- Until now the only thing that ever noticed a student running out of hours was
-- the student's own dashboard (HoursHero, `left <= 5`). Nothing reached the
-- office at all, so the first the institute hears of an empty package is when a
-- parent is already two or three classes into an overdraft.
--
-- This records a row each time an ACTIVE student crosses an hours step, with
-- the exact words the system wrote. The office works down the list, calls the
-- parent, types what was said, and ticks it done.
--
-- Two things are deliberate:
--
--  * `message` is STORED, not rebuilt when the screen is read. If the institute
--    rewords the 0-hour text next month, a reminder raised today still shows
--    what that parent was actually told. A list that silently rewrites its own
--    history is worse than no list.
--
--  * `credited_hours` is the student's total credited hours at the moment the
--    reminder fired. A later reminder whose credited total is HIGHER means the
--    family paid in between, so the chain starts again from 5 hours. Without
--    it there is no way to tell "fell to 0 again after paying" from "still at
--    0 since last month".
--
-- Nothing is ever deleted here either: `is_deleted`, like everywhere else.

USE classroom_app;

CREATE TABLE IF NOT EXISTS reminders (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  student_id     INT NOT NULL,
  -- 5, 0, -2, -3, -4 … The step that was crossed, not the balance.
  tier           SMALLINT NOT NULL,
  -- The balance when it fired, kept because `tier` rounds it.
  hours_left     DECIMAL(8,2) NOT NULL,
  -- Total credited then. A rise since the last reminder means a top-up.
  credited_hours DECIMAL(10,2) NOT NULL,
  -- The words as sent. TEXT, not VARCHAR: a reworded template must never be
  -- the thing that makes a row fail to save.
  message        TEXT NOT NULL,
  raised_at      DATETIME NOT NULL,
  -- Done means a person SPOKE TO THE PARENT. Not that somebody looked.
  done_at        DATETIME NULL,
  done_by        INT NULL,
  -- What the parent said, written into student_follow_ups so it also shows on
  -- the student in Student Hours. The reminder only points at it.
  follow_up_id   INT NULL,
  is_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reminders_student  FOREIGN KEY (student_id)   REFERENCES students(id)            ON DELETE CASCADE,
  CONSTRAINT fk_reminders_done_by  FOREIGN KEY (done_by)      REFERENCES users(id)               ON DELETE SET NULL,
  CONSTRAINT fk_reminders_followup FOREIGN KEY (follow_up_id) REFERENCES student_follow_ups(id)  ON DELETE SET NULL,
  -- The screen is grouped by day, newest first.
  INDEX idx_reminders_raised (raised_at),
  -- "has this student already been reminded at this step?"
  INDEX idx_reminders_student (student_id, id),
  INDEX idx_reminders_open (done_at)
);

-- ---------------------------------------------------------------------------
-- The whole rule lives in settings, so the institute can change WHEN a
-- reminder fires and WHAT it says without a developer and without a release.
--
-- Placeholders: {name} the student's full name, {form_no} their form number,
-- {n} how many hours beyond the package (the negative steps only).
--
-- setting_value is VARCHAR(255) today, which these fit inside — but only just,
-- and a sentence the office lengthens by a word would be truncated or rejected
-- by STRICT_TRANS_TABLES. That is exactly the bug the lecture remark had on
-- 16 November. Widened here rather than waiting for it to happen again.
-- ---------------------------------------------------------------------------
ALTER TABLE app_settings MODIFY COLUMN setting_value TEXT NOT NULL;

INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES
  ('reminders_enabled', '1', NULL),

  -- WHEN it fires -----------------------------------------------------------
  -- The first warning, when the balance falls to this many hours. Set to 8 and
  -- the office gets more warning; set to 3 and it gets less. Nothing fires
  -- between this and zero — one warning, not a countdown.
  ('reminder_first_hours',     '5',  NULL),
  -- Zero always fires on its own; there is no key for it, because "classes are
  -- on hold" is not a number the institute would want to move.
  -- The overdraft warning, raised when the balance reaches this or anything
  -- beyond it. The client asked for -2: two hours of goodwill before anyone is
  -- chased about an overdraft.
  --
  -- It fires ONCE per cycle, not once per hour. The institute does not want a
  -- row at -3, another at -4, another at -5 — that is the same conversation
  -- four times and the office stops reading the screen. A student who drops
  -- straight from -1 to -6 without ever sitting at -2 still gets it, raised at
  -- -6, because the test is "at or beyond", not "landed exactly on".
  ('reminder_overdraft_from',  '-2', NULL),
  -- When the overdraft is this deep or worse, the firmer wording is used.
  ('reminder_harden_at',       '-5', NULL),

  -- WHAT it says ------------------------------------------------------------
  -- In the institute's own voice, taken from the fee messages they have been
  -- sending parents on WhatsApp through 2026: the "Dear parent, greetings from
  -- Stem Vision" opening, "We request you to kindly…", "exceeded {n} hours of
  -- lectures", "will be adjusted in this package renewal". Not a tone invented
  -- by a developer.
  --
  -- {n} is the student's REAL balance, never the threshold. A parent told
  -- "you have 5 hours left" when the child has one would believe it.
  --
  -- No package amount: it is AED 4200 for 30 hours for most, 2100 for 15,
  -- 1900 for 15, 4200 for 35 for one long-standing family. The system does not
  -- know which, and a wrong amount in a fee message is worse than none.
  ('reminder_text_first',
   'Dear parent, greetings from Stem Vision.\n\nThis is to inform you that {name} has {n} hours remaining in the current package. We request you to kindly renew the package so that the lectures continue without any break.', NULL),
  ('reminder_text_0',
   'Dear parent, greetings from Stem Vision.\n\nThis is to inform you that the package hours for {name} are now complete. We request you to kindly renew the package at the earliest so that the lectures continue without any break.', NULL),
  ('reminder_text_over',
   'Dear parent, greetings from Stem Vision.\n\nPlease note that {name} has exceeded {n} hours of lectures. We request you to kindly renew the package at the earliest. Kindly note that the previous {n} hours will be adjusted in this package renewal.', NULL),
  -- Deeper, but not harsher. The institute never threatens a parent in that
  -- chat, and a system that suddenly did would not sound like them. What this
  -- adds is the consequence they do mention themselves: the lecture slots.
  ('reminder_text_over_5',
   'Dear parent, greetings from Stem Vision.\n\nPlease note that {name} has exceeded {n} hours of lectures. We request you to kindly clear the balance at the earliest so that we can continue to block the lecture slots for {name}. Kindly note that the previous {n} hours will be adjusted in the package renewal.', NULL),
  -- The block pasted under every fee message. One place to change a bank,
  -- rather than the same correction made in four templates.
  ('reminder_signature',
   'Pls find the bank details for fees transfer: INITIUM EDUCATIONAL SERVICES FZCO\nAccount Number : 019101766738\nIBAN Number : AE340330000019101766738\nCurrency : AED\nBANK NAME: MASHREQ NEOBIZ\n\nKindly let us know once the fees is paid.\n\nThanking you in anticipation.', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

SELECT setting_key, setting_value FROM app_settings
 WHERE setting_key LIKE 'reminder%' ORDER BY setting_key;
