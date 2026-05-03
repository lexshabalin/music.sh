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
		if !shouldTranscodeToMP3("/x"+ext, "") {
			t.Errorf("path *%q: want true", ext)
		}
	}
	// Path without extension but DB says flac
	if !shouldTranscodeToMP3("/music/album/01 - Song", "flac") {
		t.Fatal("want true when formatHint=flac and path has no ext")
	}
	if !shouldTranscodeToMP3("/music/x", ".FLAC") {
		t.Fatal("want true when formatHint has leading dot")
	}
	for _, tc := range []struct {
		path string
		hint string
	}{
		{"/a/x.mp3", "flac"},
		{"/a/x.m4a", "flac"},
		{"/a/x.wav", "flac"},
	} {
		if shouldTranscodeToMP3(tc.path, tc.hint) {
			t.Errorf("path=%q hint=%q: want false (trust file extension)", tc.path, tc.hint)
		}
	}
	for _, ext := range []string{".mp3", ".m4a", ".wav", ""} {
		if shouldTranscodeToMP3("/x"+ext, "") {
			t.Errorf("path *%q hint empty: want false", ext)
		}
	}
	_ = os.Setenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE", "1")
	t.Cleanup(func() { _ = os.Unsetenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE") })
	if shouldTranscodeToMP3("/x.flac", "") {
		t.Fatal("expected transcode off when MUSICSH_DISABLE_PLAYBACK_TRANSCODE=1")
	}
}

func TestServePlaybackFlacWithoutFFmpeg(t *testing.T) {
	orig := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", orig) })
	_ = os.Setenv("PATH", t.TempDir())

	f := filepath.Join(t.TempDir(), "x.flac")
	if err := os.WriteFile(f, []byte("not a real flac"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	if err := ServePlayback(rec, req, f, ""); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 {
		t.Fatalf("response code = %d, want 200", rec.Code)
	}
}

func TestServePlaybackFormatHintWithoutExt(t *testing.T) {
	orig := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", orig) })
	_ = os.Setenv("PATH", t.TempDir())

	f := filepath.Join(t.TempDir(), "trackdata")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	if err := ServePlayback(rec, req, f, "flac"); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 {
		t.Fatalf("response code = %d, want 200", rec.Code)
	}
}
