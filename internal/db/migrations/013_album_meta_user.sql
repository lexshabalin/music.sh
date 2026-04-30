-- User-edited album metadata; scan does not move tracks off such albums arbitrarily.
ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS meta_user_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_artist TEXT,
  ADD COLUMN IF NOT EXISTS meta_user_year INT,
  ADD COLUMN IF NOT EXISTS meta_cover_locked BOOLEAN NOT NULL DEFAULT false;
