-- Credits: verbatim performer line per file + normalized many-to-many for library navigation.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS tag_artist TEXT;

CREATE TABLE IF NOT EXISTS track_artists (
  track_id  UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position  SMALLINT NOT NULL,
  PRIMARY KEY (track_id, position),
  UNIQUE (track_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_track_artists_by_artist ON track_artists (artist_id);
