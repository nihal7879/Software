-- Forgot password: a code emailed to the address on file.
--
-- The code is never stored. Only its bcrypt hash is, exactly like a password —
-- a leaked backup of this table must not hand anyone the account it was about
-- to open. Rows are kept after use so "who asked for a reset, from where" can
-- be answered later; nothing here is ever deleted.
--
-- Only one row per account can be live at a time: asking again puts the earlier
-- row out of use (used_at is set), so an old code in an old email is dead.
USE classroom_app;

CREATE TABLE IF NOT EXISTS password_resets (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  -- bcrypt of the six digits that were emailed. Never the digits themselves.
  otp_hash        VARCHAR(255) NOT NULL,
  -- Where it went, kept so the office can see the reset reached the right
  -- family. Masked when it is shown back ("a***@gmail.com").
  sent_to         VARCHAR(255) NOT NULL,
  expires_at      DATETIME NOT NULL,
  -- Wrong tries against this code. At the cap the row dies: six digits is a
  -- million guesses a script makes in minutes if nothing stops it.
  attempts        INT NOT NULL DEFAULT 0,
  -- Set the moment the code is spent, superseded, or burnt by too many tries.
  used_at         DATETIME NULL,
  requested_ip    VARCHAR(45) NULL,
  requested_device VARCHAR(255) NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pwreset_user FOREIGN KEY (user_id) REFERENCES users (id),
  -- The live code for an account, and the "how many did this person ask for in
  -- the last quarter hour" count, both read off this index.
  INDEX idx_pwreset_user (user_id, created_at),
  INDEX idx_pwreset_ip (requested_ip, created_at)
);

-- A reset hands out a password the system made up, so it is in a WhatsApp
-- message within the hour. This makes the app insist on a new one at the next
-- sign-in: until it is set, every screen is the change-password screen.
ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash;

-- Signs out every device, which a reset has to do.
--
-- The sign-in token is self-contained: nothing is stored server-side, so until
-- now there was nothing to cancel and a token already copied off a device kept
-- working for a whole day after the password changed — which is the one thing a
-- reset is for. The number is stamped into each token and checked against this
-- column; raising it leaves every token issued before it worthless.
ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0 AFTER must_change_password;
