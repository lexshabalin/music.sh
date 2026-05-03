// Package subproclow starts disk-heavy helpers (ffprobe, ffmpeg, fpcalc) at low I/O priority on Linux
// (ionice best-effort class + nice), to reduce host saturation when the music library lives on a slow or SMR disk / VM passthrough.
package subproclow

import (
	"context"
	"os/exec"
)

// Command builds exec.CommandContext(program, args...) or a Linux wrapper (ionice, then nice fallback).
func Command(ctx context.Context, program string, args ...string) *exec.Cmd {
	return wrapExec(ctx, program, args)
}
