package store

import (
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
