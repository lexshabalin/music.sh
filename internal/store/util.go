package store

import (
	"html"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

func normalizeSearch(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return ""
	}
	return strings.Join(strings.Fields(s), " ")
}

func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if pe, ok := err.(*pgconn.PgError); ok {
		return pe.Code == "23505"
	}
	return false
}

func isAudioExt(ext string) bool {
	switch ext {
	case ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav":
		return true
	default:
		return false
	}
}

// AudioExt for MIME - caller passes lowercase with dot
func IsAudioFilename(name string) bool {
	lower := strings.ToLower(name)
	dot := strings.LastIndexByte(lower, '.')
	if dot < 0 {
		return false
	}
	return isAudioExt(lower[dot:])
}

// NormalizeAudioFileName trims trailing spaces and tabs in the filename stem (before the last extension).
// Example: "Artist - Song .mp3" -> "Artist - Song.mp3". Unknown extensions are returned unchanged.
func NormalizeAudioFileName(name string) string {
	if name == "" || name == "." || name == ".." {
		return name
	}
	lower := strings.ToLower(name)
	dot := strings.LastIndexByte(lower, '.')
	if dot < 0 {
		return strings.TrimRight(name, " \t")
	}
	ext := name[dot:]
	if !isAudioExt(strings.ToLower(ext)) {
		return name
	}
	stem := name[:dot]
	stem = strings.TrimRight(stem, " \t")
	return stem + ext
}

// SanitizeAudioFileBaseName decodes HTML entities in the basename (e.g. &#39; -> ') and trims stray spaces before the extension.
// Used when renaming library files on scan and for consistent imprint labels.
func SanitizeAudioFileBaseName(name string) string {
	return NormalizeAudioFileName(html.UnescapeString(name))
}
