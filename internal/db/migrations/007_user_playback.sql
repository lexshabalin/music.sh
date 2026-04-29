-- Cross-device playback sync: one row per user (last writer wins).
CREATE TABLE IF NOT EXISTS user_playback (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  track_ids UUID[] NOT NULL DEFAULT '{}',
  current_index INT NOT NULL DEFAULT 0,
  position_ms INT NOT NULL DEFAULT 0,
  is_playing BOOLEAN NOT NULL DEFAULT false,
  source_playlist_id UUID REFERENCES playlists (id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_playback_updated ON user_playback (updated_at);
