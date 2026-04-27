-- musicsh initial schema
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
  id              UUID PRIMARY KEY,
  name            TEXT NOT NULL,
  name_search     TEXT NOT NULL,
  musicbrainz_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artists_search ON artists (name_search);

CREATE TABLE IF NOT EXISTS albums (
  id                 UUID PRIMARY KEY,
  artist_id          UUID REFERENCES artists (id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  title_search       TEXT NOT NULL,
  year               INT,
  musicbrainz_release_id TEXT,
  cover_path         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums (artist_id);
CREATE INDEX IF NOT EXISTS idx_albums_search ON albums (title_search);

CREATE TABLE IF NOT EXISTS tracks (
  id             UUID PRIMARY KEY,
  file_path      TEXT NOT NULL UNIQUE,
  file_size      BIGINT NOT NULL,
  file_mtime_ns  BIGINT NOT NULL,
  duration_ms    INT,
  title            TEXT,
  track_no         INT,
  disc_no          INT,
  year             INT,
  album_id         UUID REFERENCES albums (id) ON DELETE SET NULL,
  artist_id        UUID REFERENCES artists (id) ON DELETE SET NULL,
  cover_source_url TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks (album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title_lower ON tracks (lower(COALESCE(title, '')));
CREATE INDEX IF NOT EXISTS idx_tracks_search_path ON tracks (file_path);

CREATE TABLE IF NOT EXISTS playlists (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists (user_id);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id           UUID PRIMARY KEY,
  playlist_id  UUID NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  track_id     UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  position     INT NOT NULL,
  UNIQUE(playlist_id, position),
  UNIQUE(playlist_id, track_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pl ON playlist_tracks (playlist_id);

CREATE TABLE IF NOT EXISTS track_likes (
  user_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id  UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('pending', 'running', 'done', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS jobs (
  id          UUID PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  status      job_status NOT NULL DEFAULT 'pending',
  attempts    INT NOT NULL DEFAULT 0,
  run_after   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_next ON jobs (status, run_after) WHERE status IN ('pending', 'running');
