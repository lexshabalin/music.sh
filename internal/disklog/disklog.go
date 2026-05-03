// Package disklog emits optional "disk:" lines to the standard logger (Docker captures stdout/stderr).
// Enable with MUSICSH_LOG_DISK_ACCESS=1 (or true/yes/on).
package disklog

import (
	"log"
	"os"
	"strings"
)

// On reports whether disk access logging is enabled.
func On() bool {
	v := strings.TrimSpace(os.Getenv("MUSICSH_LOG_DISK_ACCESS"))
	if v == "" {
		return false
	}
	switch strings.ToLower(v) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

// Printf logs one line with a "disk: " prefix when On(); no-op otherwise.
func Printf(format string, v ...any) {
	if !On() {
		return
	}
	log.Printf("disk: "+format, v...)
}
