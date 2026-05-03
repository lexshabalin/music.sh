package scanner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"musicsh/internal/store"
)

const libraryWalkMaxDepth = 256

// scanFollowSymlinks controls descending into directory symlinks (filepath.Walk does not).
// Default on: typical libraries use symlinks to another disk or NAS. Set MUSICSH_SCAN_FOLLOW_SYMLINKS=0 to disable.
func scanFollowSymlinks() bool {
	v := strings.TrimSpace(os.Getenv("MUSICSH_SCAN_FOLLOW_SYMLINKS"))
	if v == "" {
		return true
	}
	switch strings.ToLower(v) {
	case "0", "false", "off", "no":
		return false
	default:
		return true
	}
}

// walkLibraryAudio visits every audio file under musicDir (store.IsAudioFilename), depth-first.
// When followSymlinks is true, directory symlinks are followed once per resolved real path (cycle-safe).
func walkLibraryAudio(ctx context.Context, musicDir string, followSymlinks bool, visit func(path string) error) error {
	musicDir = filepath.Clean(musicDir)
	st, err := os.Stat(musicDir)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return fmt.Errorf("music dir is not a directory: %s", musicDir)
	}
	symlinkDirSeen := make(map[string]struct{})
	var walk func(dir string, depth int) error
	walk = func(dir string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if depth > libraryWalkMaxDepth {
			return fmt.Errorf("library walk: max depth %d exceeded at %s", libraryWalkMaxDepth, dir)
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, ent := range entries {
			if err := ctx.Err(); err != nil {
				return err
			}
			full := filepath.Join(dir, ent.Name())
			typ := ent.Type()
			if typ&os.ModeSymlink != 0 {
				st, err := os.Stat(full)
				if err != nil {
					continue
				}
				if st.IsDir() && followSymlinks {
					key, err := filepath.EvalSymlinks(full)
					if err != nil {
						key = filepath.Clean(full)
					} else {
						key = filepath.Clean(key)
					}
					if _, dup := symlinkDirSeen[key]; dup {
						continue
					}
					symlinkDirSeen[key] = struct{}{}
					if err := walk(full, depth+1); err != nil {
						return err
					}
					continue
				}
				if st.IsDir() {
					// Symlink to directory but follow disabled: skip (same as filepath.Walk).
					continue
				}
				if !store.IsAudioFilename(ent.Name()) {
					continue
				}
				if err := visit(full); err != nil {
					return err
				}
				continue
			}
			if ent.IsDir() {
				if err := walk(full, depth+1); err != nil {
					return err
				}
				continue
			}
			if !store.IsAudioFilename(ent.Name()) {
				continue
			}
			if err := visit(full); err != nil {
				return err
			}
		}
		return nil
	}
	return walk(musicDir, 0)
}
