package imprint

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
)

func baseName(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	return filepath.Base(p)
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

