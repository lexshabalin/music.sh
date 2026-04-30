package store

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID          uuid.UUID `json:"id"`
	Username    *string   `json:"username,omitempty"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"displayName,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`

	BackgroundType   *string `json:"backgroundType,omitempty"`
	BackgroundPreset *string `json:"backgroundPreset,omitempty"`
	BackgroundURL    *string `json:"backgroundUrl,omitempty"`
	BackgroundMime   *string `json:"backgroundMime,omitempty"`
}

type Artist struct {
	ID             uuid.UUID  `json:"id"`
	Name           string     `json:"name"`
	MusicBrainzID  *string    `json:"musicbrainzId,omitempty"`
}

type Album struct {
	ID                 uuid.UUID  `json:"id"`
	Title              string     `json:"title"`
	Year               *int       `json:"year,omitempty"`
	ArtistID           *uuid.UUID `json:"artistId,omitempty"`
	ArtistName         *string    `json:"artistName,omitempty"`
	CoverPath          *string    `json:"-"`
	MusicBrainzRelease *string    `json:"musicBrainzReleaseId,omitempty"`
	Meta               *AlbumMetaPins `json:"meta,omitempty"`
}

// AlbumMetaPins marks user-edited album fields (persist across library rescan).
type AlbumMetaPins struct {
	Title  bool `json:"title,omitempty"`
	Artist bool `json:"artist,omitempty"`
	Year   bool `json:"year,omitempty"`
	Cover  bool `json:"cover,omitempty"`
}

// AlbumMetaUpdate is input for PATCH /api/albums/{id}.
type AlbumMetaUpdate struct {
	ClearTitle, ClearArtist, ClearYear, ClearCover bool
	Title, ArtistName                              *string
	Year                                           *int
}

type Track struct {
	ID           uuid.UUID  `json:"id"`
	Title        *string    `json:"title,omitempty"`
	DurationMs   *int       `json:"durationMs,omitempty"`
	Format       *string    `json:"format,omitempty"`
	BitrateKbps  *int       `json:"bitrateKbps,omitempty"`
	TrackNo      *int       `json:"trackNo,omitempty"`
	DiscNo       *int       `json:"discNo,omitempty"`
	Year         *int       `json:"year,omitempty"`
	// CoverURL is set when the track has custom art (GET /api/tracks/{id}/cover).
	CoverURL     *string    `json:"coverUrl,omitempty"`
	FilePath     string     `json:"-"` // not exposed; stream uses id
	Album        *TrackAlbum `json:"album,omitempty"`
	Artist       *TrackArtist `json:"artist,omitempty"`
	// Meta lists which fields are user-pinned (not overwritten on rescan).
	Meta *TrackMetaPins `json:"meta,omitempty"`
}

// TrackMetaPins indicates user overrides active for the track.
type TrackMetaPins struct {
	Title   bool `json:"title,omitempty"`
	Artist  bool `json:"artist,omitempty"`
	Album   bool `json:"album,omitempty"`
	Year    bool `json:"year,omitempty"`
	TrackNo bool `json:"trackNo,omitempty"`
	DiscNo  bool `json:"discNo,omitempty"`
	Art     bool `json:"art,omitempty"`
}

// TrackMetaUpdate is the store layer input for PATCH /api/tracks/{id} metadata.
type TrackMetaUpdate struct {
	ClearTitle, ClearArtist, ClearAlbum, ClearYear, ClearTrackNo, ClearDiscNo, ClearArt bool
	Title, ArtistName, AlbumTitle, AlbumArtistName                                      *string
	Year                                                                                  *int
	TrackNo, DiscNo                                                                       *int
	// AlbumID links to an existing album row (library pick); string pins are cleared so the track inherits album metadata.
	AlbumID *uuid.UUID
}

type TrackAlbum struct {
	ID   uuid.UUID `json:"id"`
	Title string   `json:"title"`
}

type TrackArtist struct {
	ID   uuid.UUID `json:"id"`
	Name string   `json:"name"`
}

type Playlist struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Description *string  `json:"description,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type PlaylistWithTracks struct {
	Playlist
	Tracks []Track `json:"tracks"`
}

type JobType string

const (
	JobScan        JobType = "scan"
	JobFetchAlbum  JobType = "fetch_album"
	JobIdentifyTrack JobType = "identify_track"
)

type Job struct {
	ID        uuid.UUID  `json:"id"`
	Type      string     `json:"type"`
	Status    string     `json:"status"`
	Attempts  int        `json:"attempts"`
	LastError *string    `json:"lastError,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// PlaybackState is persisted for cross-device resume (queue order + position).
type PlaybackState struct {
	TrackIDs         []uuid.UUID
	CurrentIndex     int
	PositionMs       int
	IsPlaying        bool
	SourcePlaylistID *uuid.UUID
	PlaybackClientID string
	OwnerEpoch       int64
	StoppedAt        *time.Time
	UpdatedAt        time.Time
}
