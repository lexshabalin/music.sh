-- User-uploaded cover art for a track (relative path under data dir). Not touched by library scan.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS art_path TEXT;
