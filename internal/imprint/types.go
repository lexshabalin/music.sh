package imprint

import "github.com/google/uuid"

type Field string

const (
	FieldTitle        Field = "title"
	FieldArtist       Field = "artist"
	FieldAlbum        Field = "album"
	FieldAlbumArtist  Field = "albumArtist"
	FieldGenre        Field = "genre"
	FieldComposer     Field = "composer"
	FieldComment      Field = "comment"
	FieldYear         Field = "year"
	FieldTrackNo      Field = "trackNo"
	FieldDiscNo       Field = "discNo"
	FieldCover        Field = "cover"
)

type TrackTarget struct {
	TrackID uuid.UUID
	FilePath string
	Format   string

	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Genre       string
	Composer    string
	Comment     string
	Year    *int
	TrackNo *int
	DiscNo  *int

	// CoverRelPath is relative to DATA_DIR.
	// Source: track art_path, else album cover_path.
	CoverRelPath *string
}

type FieldDiff struct {
	Field     Field   `json:"field"`
	Supported bool    `json:"supported"`
	Changed   bool    `json:"changed"`
	Before    *string `json:"before,omitempty"`
	After     *string `json:"after,omitempty"`
	Warning   *string `json:"warning,omitempty"`
}

type TrackDryRun struct {
	TrackID  uuid.UUID   `json:"trackId"`
	FileName string      `json:"fileName"`
	Format   string      `json:"format"`
	Warnings []string    `json:"warnings,omitempty"`
	Diff     []FieldDiff `json:"diff"`
}

type AlbumDryRun struct {
	AlbumID          uuid.UUID      `json:"albumId"`
	AvailableFields  []Field        `json:"availableFields"`
	Tracks           []TrackDryRun  `json:"tracks"`
}

