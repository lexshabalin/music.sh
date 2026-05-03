//go:build !linux

package subproclow

import (
	"context"
	"os/exec"
)

func wrapExec(ctx context.Context, program string, args []string) *exec.Cmd {
	return exec.CommandContext(ctx, program, args...)
}
