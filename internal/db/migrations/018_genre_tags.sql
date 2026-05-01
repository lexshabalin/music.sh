-- Multi-value genres as tags + manual track flag for scan behavior.
CREATE TABLE IF NOT EXISTS library_genres (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS album_genres (
  album_id UUID NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES library_genres (id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, genre_id)
);

CREATE TABLE IF NOT EXISTS track_genres (
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES library_genres (id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_album_genres_album ON album_genres (album_id);
CREATE INDEX IF NOT EXISTS idx_track_genres_track ON track_genres (track_id);

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS genres_manual BOOLEAN NOT NULL DEFAULT FALSE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO library_genres (id, label, normalized)
SELECT gen_random_uuid(), v.label, lower(v.label)
FROM (
  SELECT DISTINCT NULLIF(trim(both coalesce(meta_user_genre::text, '')), '') AS label FROM albums WHERE meta_user_genre IS NOT NULL
  UNION
  SELECT DISTINCT NULLIF(trim(both coalesce(genre::text, '')), '') FROM albums WHERE genre IS NOT NULL
  UNION
  SELECT DISTINCT NULLIF(trim(both coalesce(tag_genre::text, '')), '') FROM tracks WHERE tag_genre IS NOT NULL
) v
WHERE v.label IS NOT NULL AND v.label <> ''
ON CONFLICT (normalized) DO NOTHING;

INSERT INTO album_genres (album_id, genre_id, position)
SELECT DISTINCT a.id, g.id, 0
FROM albums a
JOIN library_genres g ON lower(trim(both coalesce(a.meta_user_genre::text, ''))) = g.normalized
WHERE trim(both coalesce(a.meta_user_genre::text, '')) <> ''
ON CONFLICT (album_id, genre_id) DO NOTHING;

INSERT INTO album_genres (album_id, genre_id, position)
SELECT DISTINCT a.id, g.id, 1
FROM albums a
JOIN library_genres g ON lower(trim(both coalesce(a.genre::text, ''))) = g.normalized
WHERE trim(both coalesce(a.genre::text, '')) <> ''
  AND trim(both coalesce(a.meta_user_genre::text, '')) = ''
ON CONFLICT (album_id, genre_id) DO NOTHING;

INSERT INTO track_genres (track_id, genre_id, position)
SELECT DISTINCT t.id, g.id, 0
FROM tracks t
JOIN library_genres g ON lower(trim(both coalesce(t.tag_genre::text, ''))) = g.normalized
WHERE trim(both coalesce(t.tag_genre::text, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = t.album_id)
ON CONFLICT (track_id, genre_id) DO NOTHING;

ALTER TABLE albums DROP COLUMN IF EXISTS genre;
ALTER TABLE albums DROP COLUMN IF EXISTS meta_user_genre;
ALTER TABLE tracks DROP COLUMN IF EXISTS tag_genre;
