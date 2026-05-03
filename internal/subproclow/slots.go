package subproclow

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// Global cap on concurrent ffprobe / ffmpeg / fpcalc processes (any mix).
// Reduces disk seek storms when the worker pool runs several jobs while a library scan calls ffprobe.
// Set MUSICSH_MEDIA_PROC_SLOTS=0 to disable (each job still uses ionice/nice on Linux when enabled).
var (
	slotsOnce sync.Once
	slotsCh   chan struct{} // nil == unlimited
)

func maxMediaProcSlots() int {
	const def = 4
	v := strings.TrimSpace(os.Getenv("MUSICSH_MEDIA_PROC_SLOTS"))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return def
	}
	if n == 0 {
		return 0
	}
	if n > 32 {
		return 32
	}
	return n
}

func initSlots() {
	slotsOnce.Do(func() {
		n := maxMediaProcSlots()
		if n > 0 {
			slotsCh = make(chan struct{}, n)
		}
	})
}

func acquireSlot(ctx context.Context) error {
	initSlots()
	if slotsCh == nil {
		return nil
	}
	select {
	case slotsCh <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func releaseSlot() {
	initSlots()
	if slotsCh == nil {
		return
	}
	<-slotsCh
}

// Run acquires a media slot (if configured), then runs cmd.
func Run(cmd *exec.Cmd) error {
	if err := acquireSlot(cmd.Context()); err != nil {
		return err
	}
	defer releaseSlot()
	return cmd.Run()
}

// Output acquires a media slot (if configured), then runs cmd.Output().
func Output(cmd *exec.Cmd) ([]byte, error) {
	if err := acquireSlot(cmd.Context()); err != nil {
		return nil, err
	}
	defer releaseSlot()
	return cmd.Output()
}

// CombinedOutput acquires a media slot (if configured), then runs cmd.CombinedOutput().
func CombinedOutput(cmd *exec.Cmd) ([]byte, error) {
	if err := acquireSlot(cmd.Context()); err != nil {
		return nil, err
	}
	defer releaseSlot()
	return cmd.CombinedOutput()
}
