-- Signing out cancels the token (security review S-08, Nov 2026).
--
-- Every sign-in token now carries its own id (jti). Signing out records it
-- here until the moment the token would have expired anyway; requireAuth
-- refuses any token listed. Only that one token is cancelled — the same person
-- stays signed in on their other devices. A password change still ends every
-- session at once through users.token_version.
--
-- A row is only useful until expires_at. Old rows can be cleared at any time:
--   DELETE FROM revoked_tokens WHERE expires_at < NOW();

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti VARCHAR(40) NOT NULL,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (jti),
  KEY idx_revoked_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
