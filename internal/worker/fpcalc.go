package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

type fpcalcOut struct {
	Duration    int    `json:"duration"`
	Fingerprint string `json:"fingerprint"`
}

func runFpcalc(path string) (durationSec int, fingerprint string, ok bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// fpcalc -json <file>
	cmd := exec.CommandContext(ctx, "fpcalc", "-json", path)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return 0, "", false
	}
	var v fpcalcOut
	if err := json.Unmarshal(out.Bytes(), &v); err != nil {
		return 0, "", false
	}
	fp := strings.TrimSpace(v.Fingerprint)
	if v.Duration <= 0 || fp == "" {
		return 0, "", false
	}
	return v.Duration, fp, true
}

