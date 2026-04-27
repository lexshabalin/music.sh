ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT;

-- best-effort backfill from email (for existing installs)
UPDATE users
SET username = NULLIF(split_part(email, '@', 1), '')
WHERE username IS NULL AND email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username);

