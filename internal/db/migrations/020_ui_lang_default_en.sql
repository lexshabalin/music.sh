-- New default UI language for accounts without an explicit preference.
ALTER TABLE users
  ALTER COLUMN ui_lang SET DEFAULT 'en';
