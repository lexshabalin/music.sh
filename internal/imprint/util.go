package imprint

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"
	"strings"

	"musicsh/internal/store"
)

func baseName(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	return store.SanitizeAudioFileBaseName(filepath.Base(p))
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// AbsDataPath joins DATA_DIR with a slash-style relative path stored in Postgres (covers, etc.).
func AbsDataPath(dataDir, rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return ""
	}
	rel = filepath.ToSlash(strings.ReplaceAll(rel, `\`, `/`))
	rel = strings.Trim(rel, "/")
	if rel == "" || strings.Contains(rel, "..") {
		return ""
	}
	return filepath.Join(dataDir, filepath.FromSlash(rel))
}

func absUnderData(dataDir, rel string) string { return AbsDataPath(dataDir, rel) }

// NormalizeEmbedPictureMIME returns a safe image/* type for ID3/FLAC (APIC) embedding.
func NormalizeEmbedPictureMIME(m string) string {
	m = strings.TrimSpace(m)
	if i := strings.IndexByte(m, ';'); i >= 0 {
		m = strings.TrimSpace(m[:i])
	}
	m = strings.ToLower(m)
	switch m {
	case "image/jpg", "image/jpeg", "image/pjpeg":
		return "image/jpeg"
	case "image/png", "image/x-png":
		return "image/png"
	case "image/webp":
		return "image/webp"
	case "image/gif":
		return "image/gif"
	default:
		if strings.HasPrefix(m, "image/") {
			return m
		}
		return ""
	}
}

// coverMIME returns image/* from filename; falls back to magic sniff for unknown extensions (e.g. .bin).
func coverMIME(relOrAbs string, raw []byte) string {
	m := mimeByExt(relOrAbs)
	if m != "" {
		return m
	}
	if len(raw) == 0 {
		return ""
	}
	n := len(raw)
	if n > 512 {
		n = 512
	}
	ct := http.DetectContentType(raw[:n])
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	if strings.HasPrefix(ct, "image/") {
		return ct
	}
	return ""
}

