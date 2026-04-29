ALTER TABLE user_playback
  ADD COLUMN IF NOT EXISTS playback_client_id TEXT NOT NULL DEFAULT '';
