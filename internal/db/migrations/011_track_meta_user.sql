-- User-edited metadata: pinned fields are not overwritten by library rescan.
ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS meta_user_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_artist TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_album TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_album_artist TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_year INT,
  ADD COLUMN IF NOT EXISTS meta_user_track_no INT,
  ADD COLUMN IF NOT EXISTS meta_user_disc_no INT;
