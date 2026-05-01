-- Extra tag fields read from files on scan; used for imprint dry-run / apply targets.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS tag_album_artist TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS tag_genre TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS tag_composer TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS tag_comment TEXT;
