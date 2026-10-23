-- Web push: the browser notification that arrives with the app closed.
--
-- A subscription belongs to a BROWSER, not to a person — the same parent on
-- their phone and on their laptop is two rows, and allowing it on one says
-- nothing about the other. The endpoint is the address the browser's own push
-- service gave us; it is unique, and it is how a repeat "allow" on the same
-- device is recognised instead of stored twice.
--
-- Nothing is deleted, here as everywhere. A browser that has been cleared
-- answers 410 Gone the next time we push to it, and that row is marked
-- is_deleted rather than removed, so the history of what was sent still reads.
USE classroom_app;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  -- The push service URL. Long: Apple's run past 300 characters.
  endpoint    VARCHAR(500) NOT NULL,
  -- The two keys the browser hands over; the message is encrypted to them, so
  -- the push service in the middle cannot read what we send.
  p256dh      VARCHAR(255) NOT NULL,
  auth_key    VARCHAR(255) NOT NULL,
  -- "Chrome on Windows" — so a person can tell their own devices apart when
  -- turning one off.
  device      VARCHAR(120) NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sent_at DATETIME NULL,
  is_deleted  BOOLEAN DEFAULT FALSE,
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users (id),
  -- One row per browser. A second "allow" on the same device updates this row.
  UNIQUE KEY uq_push_endpoint (endpoint),
  INDEX idx_push_user (user_id, is_deleted)
);

-- Every notification the app tried to send, and what became of it — the same
-- reason email_log exists. "Was the parent told their child checked in?" has to
-- be answerable a month later, and a push that silently went nowhere (nobody
-- had allowed notifications) must not look like one that arrived.
CREATE TABLE IF NOT EXISTS notification_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  kind        VARCHAR(40) NOT NULL,       -- registration_new | registration_approved | hours_statement | check_in | check_out | test
  user_id     INT NULL,                   -- who it was for
  title       VARCHAR(160) NOT NULL,
  -- What was shown. Deliberately free of amounts, balances and other families'
  -- names: a notification is read off a lock screen by whoever is holding the
  -- phone. The figures live behind the sign-in.
  body        VARCHAR(255) NOT NULL,
  url         VARCHAR(255) NULL,          -- where tapping it opens
  status      ENUM('sent', 'no_device', 'failed', 'not_configured') NOT NULL,
  devices     INT NOT NULL DEFAULT 0,     -- how many browsers it reached
  error       VARCHAR(500) NULL,
  student_id  INT NULL,                   -- the child it was about, where there is one
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_user (user_id, created_at),
  INDEX idx_notif_kind (kind, created_at),
  INDEX idx_notif_student (student_id)
);
