ALTER TABLE users ADD COLUMN IF NOT EXISTS background_type TEXT; -- preset|custom|null
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_preset TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_path TEXT; -- relative to DATA_DIR
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_mime TEXT;

