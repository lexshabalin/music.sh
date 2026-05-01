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

// absUnderData joins DATA_DIR with a slash-style relative cover path stored in Postgres.
func absUnderData(dataDir, rel string) string {
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

