//go:build linux

package subproclow

import (
	"context"
	"os"
	"os/exec"
	"strings"
)

func wrapExec(ctx context.Context, program string, args []string) *exec.Cmd {
	if strings.TrimSpace(os.Getenv("MUSICSH_DISABLE_DISK_IO_PRIORITY")) == "1" {
		return exec.CommandContext(ctx, program, args...)
	}
	if ionice, err := exec.LookPath("ionice"); err == nil && ionice != "" {
		wrapped := append([]string{"-c2", "-n7", program}, args...)
		return exec.CommandContext(ctx, ionice, wrapped...)
	}
	if nice, err := exec.LookPath("nice"); err == nil && nice != "" {
		wrapped := append([]string{"-n", "15", program}, args...)
		return exec.CommandContext(ctx, nice, wrapped...)
	}
	return exec.CommandContext(ctx, program, args...)
}
