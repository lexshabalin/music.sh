-- Daily listen rollups so home stats can filter by day / week / month / custom range.

CREATE TABLE IF NOT EXISTS user_listen_day (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  listen_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS user_listen_genre_day (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  genre_id UUID NOT NULL REFERENCES library_genres (id) ON DELETE CASCADE,
  listen_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_user_listen_day_range ON user_listen_day (user_id, day);
CREATE INDEX IF NOT EXISTS idx_user_listen_genre_day_range ON user_listen_genre_day (user_id, day);
