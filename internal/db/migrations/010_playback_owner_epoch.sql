-- Monotonic owner epoch to prevent stale heartbeat overwrites after takeover.
ALTER TABLE user_playback
  ADD COLUMN IF NOT EXISTS owner_epoch BIGINT NOT NULL DEFAULT 0;
