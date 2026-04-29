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
	MusicBrainzRelease *string    `json:"musicbrainzReleaseId,omitempty"`
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
	FilePath     string     `json:"-"` // not exposed; stream uses id
	Album        *TrackAlbum `json:"album,omitempty"`
	Artist       *TrackArtist `json:"artist,omitempty"`
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
