package scanner

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"time"

	"musicsh/internal/subproclow"
)

// probeDurationMS tries to read duration via ffprobe.
// Returns (ms, true) on success; (nil, false) if ffprobe missing or fails.
func probeDurationMS(path string) (*int, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 <file>
	cmd := subproclow.Command(ctx, "ffprobe",
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=nk=1:nw=1",
		path,
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := subproclow.Run(ctx, cmd); err != nil {
		return nil, false
	}
	s := strings.TrimSpace(out.String())
	if s == "" {
		return nil, false
	}
	sec, err := strconv.ParseFloat(s, 64)
	if err != nil || !isFinitePositive(sec) {
		return nil, false
	}
	ms := int(sec * 1000.0)
	if ms <= 0 {
		return nil, false
	}
	return &ms, true
}

func isFinitePositive(f float64) bool {
	if f <= 0 {
		return false
	}
	// NaN check: NaN != NaN
	if f != f {
		return false
	}
	return true
}

