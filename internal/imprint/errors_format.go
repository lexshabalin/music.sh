package imprint

import (
	"errors"
	"os"
	"strings"
	"syscall"
)

// FormatApplyError turns low-level OS errors into actionable text for job/UI results.
func FormatApplyError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, syscall.EROFS) {
		return "read-only file system: imprint must write into audio files under MUSIC_DIR. " +
			"Mount the library volume read-write (remove :ro in Docker Compose / Kubernetes volume)."
	}
	var pe *os.PathError
	if errors.As(err, &pe) && errors.Is(pe.Err, syscall.EROFS) {
		return "read-only file system: imprint must write into audio files under MUSIC_DIR. " +
			"Mount the library volume read-write (remove :ro in Docker Compose / Kubernetes volume)."
	}
	low := strings.ToLower(err.Error())
	if strings.Contains(low, "read-only file system") {
		return "read-only library: cannot write tags. Use a read-write MUSIC_DIR mount (not :ro)."
	}
	return err.Error()
}
