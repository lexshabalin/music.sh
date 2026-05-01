-- Album-level genre; meta_user_genre is user-pinned and is rolled out to track tag_genre on save.
ALTER TABLE albums ADD COLUMN IF NOT EXISTS genre TEXT;
ALTER TABLE albums ADD COLUMN IF NOT EXISTS meta_user_genre TEXT;
