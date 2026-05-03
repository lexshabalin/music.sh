package scanner

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestWalkLibraryAudio_FlacPlain(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "album")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(sub, "track.flac")
	if err := os.WriteFile(want, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	var got []string
	err := walkLibraryAudio(context.Background(), root, true, func(p string) error {
		got = append(got, p)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, want) {
		t.Fatalf("missing %q, got %v", want, got)
	}
}

func TestWalkLibraryAudio_FlacUnderSymlinkedDir(t *testing.T) {
	root := t.TempDir()
	real := filepath.Join(root, "realLib")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(real, "a.flac")
	if err := os.WriteFile(want, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "linkLib")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	var got []string
	err := walkLibraryAudio(context.Background(), root, true, func(p string) error {
		got = append(got, p)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(got, want) {
		t.Fatalf("expected file under symlinked dir %q in %v", want, got)
	}
}

func TestWalkLibraryAudio_NoFollowSkipsSymlinkedDir(t *testing.T) {
	// Library root contains only a symlink to a directory elsewhere — without follow, nothing is scanned.
	root := t.TempDir()
	ext := t.TempDir()
	fl := filepath.Join(ext, "only.flac")
	if err := os.WriteFile(fl, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "lib")
	if err := os.Symlink(ext, link); err != nil {
		t.Fatal(err)
	}
	var got []string
	err := walkLibraryAudio(context.Background(), root, false, func(p string) error {
		got = append(got, p)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected no files with follow=false, got %v", got)
	}
	var gotFollow []string
	err = walkLibraryAudio(context.Background(), root, true, func(p string) error {
		gotFollow = append(gotFollow, p)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(link, "only.flac")
	if !slices.Contains(gotFollow, wantPath) {
		t.Fatalf("with follow=true want %q in %v", wantPath, gotFollow)
	}
}
