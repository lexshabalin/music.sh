-- Adds per-user UI language preference (i18n).
-- Values: 'ru' | 'en'

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_lang text;

UPDATE users SET ui_lang = 'ru' WHERE ui_lang IS NULL OR BTRIM(ui_lang) = '';

ALTER TABLE users
  ALTER COLUMN ui_lang SET DEFAULT 'ru';

