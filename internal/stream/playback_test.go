package stream

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestShouldTranscodeToMP3(t *testing.T) {
	t.Cleanup(func() { _ = os.Unsetenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE") })
	_ = os.Unsetenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE")

	for _, ext := range []string{".flac", ".FLAC", ".aiff", ".aif"} {
		if !shouldTranscodeToMP3(ext) {
			t.Errorf("shouldTranscodeToMP3(%q) = false, want true", ext)
		}
	}
	for _, ext := range []string{".mp3", ".m4a", ".wav", ""} {
		if shouldTranscodeToMP3(ext) {
			t.Errorf("shouldTranscodeToMP3(%q) = true, want false", ext)
		}
	}
	_ = os.Setenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE", "1")
	t.Cleanup(func() { _ = os.Unsetenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE") })
	if shouldTranscodeToMP3(".flac") {
		t.Fatal("expected transcode off when MUSICSH_DISABLE_PLAYBACK_TRANSCODE=1")
	}
}

func TestServePlaybackFlacWithoutFFmpeg(t *testing.T) {
	// Empty PATH so LookPath("ffmpeg") fails; .flac must fall back to byte range serve without panicking.
	orig := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", orig) })
	_ = os.Setenv("PATH", t.TempDir())

	f := filepath.Join(t.TempDir(), "x.flac")
	if err := os.WriteFile(f, []byte("not a real flac"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	if err := ServePlayback(rec, req, f); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 {
		t.Fatalf("response code = %d, want 200", rec.Code)
	}
}
