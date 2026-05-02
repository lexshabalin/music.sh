-- Listening time / genre breakdown / album recency (incremented during playback PUTs).

CREATE TABLE IF NOT EXISTS user_listen_stats (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  total_listen_ms BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_listen_genre (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES library_genres (id) ON DELETE CASCADE,
  listen_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, genre_id)
);

CREATE TABLE IF NOT EXISTS user_listen_album (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  album_id UUID NOT NULL REFERENCES albums (id) ON DELETE CASCADE,
  last_listened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  listen_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, album_id)
);

CREATE INDEX IF NOT EXISTS idx_user_listen_album_recent ON user_listen_album (user_id, last_listened_at DESC);
