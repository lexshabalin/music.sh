package store

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/google/uuid"
)

func trimTrackFilePath(s string) string {
	s = strings.ReplaceAll(s, "\x00", "")
	return strings.TrimSpace(s)
}

// isPathNotFoundErr is true for common "this path is not there" results from os.Stat / Open.
func isPathNotFoundErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, fs.ErrNotExist) || os.IsNotExist(err) {
		return true
	}
	var pe *os.PathError
	if errors.As(err, &pe) && pe.Err != nil {
		if errors.Is(pe.Err, fs.ErrNotExist) || os.IsNotExist(pe.Err) {
			return true
		}
		var errno syscall.Errno
		if errors.As(pe.Err, &errno) {
			switch errno {
			case syscall.ENOENT, syscall.ENOTDIR:
				return true
			}
		}
	}
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.ENOENT, syscall.ENOTDIR:
			return true
		}
	}
	return false
}

func trackPathProbeCandidates(musicRoot, fp string) []string {
	fp = filepath.Clean(trimTrackFilePath(fp))
	if fp == "" || fp == "." {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	add := func(p string) {
		p = filepath.Clean(strings.TrimSpace(p))
		if p == "" || p == "." {
			return
		}
		if _, ok := seen[p]; ok {
			return
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	add(fp)
	mr := filepath.Clean(trimTrackFilePath(musicRoot))
	if mr != "" && mr != "." && !filepath.IsAbs(fp) {
		add(filepath.Join(mr, fp))
	}
	return out
}

// trackFileAbsentOnDisk tries the same logical locations that might have been recorded as file_path:
// plain path plus, for relative paths, MUSIC_DIR-relative resolution.
func trackFileAbsentOnDisk(musicRoot, fp string) (absent bool, skipErr error) {
	fp = trimTrackFilePath(fp)
	if fp == "" {
		return true, nil
	}
	for _, p := range trackPathProbeCandidates(musicRoot, fp) {
		_, err := os.Stat(p)
		if err == nil {
			return false, nil
		}
		if !isPathNotFoundErr(err) {
			return false, err
		}
	}
	return true, nil
}

// DeleteTracksWithMissingFiles removes rows whose paths do not resolve to existing files on disk.
// musicRoot matches configured MUSIC_DIR and is needed when file_path rows are stored as relative paths.
func (d *DB) DeleteTracksWithMissingFiles(ctx context.Context, musicRoot string) (int64, error) {
	rows, err := d.Pool.Query(ctx, `SELECT id, file_path FROM tracks`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	const batch = 256
	var ids []uuid.UUID
	flush := func() (int64, error) {
		if len(ids) == 0 {
			return 0, nil
		}
		tag, e := d.Pool.Exec(ctx, `DELETE FROM tracks WHERE id = ANY($1::uuid[])`, ids)
		if e != nil {
			return 0, e
		}
		n := tag.RowsAffected()
		ids = ids[:0]
		return n, nil
	}

	var total int64
	for rows.Next() {
		var id uuid.UUID
		var fp string
		if err := rows.Scan(&id, &fp); err != nil {
			return total, err
		}
		absent, skip := trackFileAbsentOnDisk(musicRoot, fp)
		if skip != nil {
			continue
		}
		if absent {
			ids = append(ids, id)
		}
		if len(ids) >= batch {
			n, e := flush()
			total += n
			if e != nil {
				return total, e
			}
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	n, err := flush()
	total += n
	return total, err
}
