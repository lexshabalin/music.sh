package scanner

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"musicsh/internal/store"
)

func libraryWalkMaxDepth() int {
	const def = 256
	v := strings.TrimSpace(os.Getenv("MUSICSH_SCAN_MAX_DEPTH"))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	if n > 10000 {
		return 10000
	}
	return n
}

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
// Directory symlinks are followed when followSymlinks is true (deduped by resolved real path).
//
// Classification uses os.Lstat/os.Stat per entry — not DirEntry.Type()/IsDir() alone: on NFS/SMB/FUSE,
// d_type is often DT_UNKNOWN so ReadDir would not mark symlink-to-dir, and we would skip entire subtrees.
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
	dirEntered := 0
	var walk func(dir string, depth int) error
	walk = func(dir string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		dirEntered++
		scanDirYieldMaybe(dirEntered)
		maxD := libraryWalkMaxDepth()
		if depth > maxD {
			return fmt.Errorf("library walk: max depth %d exceeded at %s", maxD, dir)
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			// One unreadable mount or permission error must not abort the entire library scan.
			log.Printf("musicsh scanner: skipping unreadable directory %q: %v", dir, err)
			return nil
		}
		for _, ent := range entries {
			if err := ctx.Err(); err != nil {
				return err
			}
			name := ent.Name()
			full := filepath.Join(dir, name)

			fi, err := os.Lstat(full)
			if err != nil {
				continue
			}
			mode := fi.Mode()

			if mode&os.ModeSymlink != 0 {
				dst, err := os.Stat(full)
				if err != nil {
					continue
				}
				if dst.IsDir() {
					if !followSymlinks {
						continue
					}
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
				if store.IsAudioFilename(name) {
					if err := visit(full); err != nil {
						return err
					}
				}
				continue
			}

			if mode.IsDir() {
				if err := walk(full, depth+1); err != nil {
					return err
				}
				continue
			}

			// Do not require ModeRegular: some FUSE/SMB stacks report ModeIrregular for normal files.
			if mode&(os.ModeNamedPipe|os.ModeSocket|os.ModeDevice|os.ModeCharDevice) != 0 {
				continue
			}
			if store.IsAudioFilename(name) {
				if err := visit(full); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(musicDir, 0)
}
