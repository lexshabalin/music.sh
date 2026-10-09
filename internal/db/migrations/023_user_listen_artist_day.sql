-- Daily listen rollups by primary artist for the Stats page.

CREATE TABLE IF NOT EXISTS user_listen_artist_day (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  artist_id UUID NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  listen_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_user_listen_artist_day_range ON user_listen_artist_day (user_id, day);
