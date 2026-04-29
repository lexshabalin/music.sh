-- When paused, playback resume data expires ~12h after stop (checked on read).
ALTER TABLE user_playback
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
