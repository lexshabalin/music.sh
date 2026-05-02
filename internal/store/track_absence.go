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

// expandTrackProbePaths returns candidate locations for a stored file_path (bind mounts / relative paths / Abs).
func expandTrackProbePaths(musicRoot, fp string) []string {
	fp0 := trimTrackFilePath(fp)
	if fp0 == "" {
		return nil
	}
	seen := make(map[string]struct{})
	var out []string
	try := func(s string) {
		s = filepath.Clean(strings.TrimSpace(strings.ReplaceAll(s, "\x00", "")))
		if s == "" || s == "." {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	tryExtras := func(s string) {
		try(s)
		if abs, err := filepath.Abs(filepath.Clean(s)); err == nil && abs != "" {
			try(abs)
		}
		if rl, err := filepath.EvalSymlinks(filepath.Clean(s)); err == nil && rl != "" {
			try(rl)
			if abs2, err2 := filepath.Abs(rl); err2 == nil && abs2 != "" {
				try(abs2)
			}
		}
	}
	tryExtras(fp0)

	mr := trimTrackFilePath(musicRoot)
	mc := filepath.Clean(mr)
	if mr != "" && mc != "" && mc != "." {
		tryExtras(mc)
		if ev, err := filepath.EvalSymlinks(mc); err == nil && ev != "" {
			tryExtras(ev)
		}
		if !filepath.IsAbs(fp0) {
			tryExtras(filepath.Join(mc, filepath.Clean(fp0)))
			if ev, err := filepath.EvalSymlinks(mc); err == nil && ev != "" {
				tryExtras(filepath.Join(filepath.Clean(ev), filepath.Clean(fp0)))
			}
		}
	}
	return out
}

// trackFileAbsentOnDisk returns true if none of the candidate paths resolves to an existing regular file/audio file.
func trackFileAbsentOnDisk(musicRoot, fp string) (absent bool, skipErr error) {
	fp = trimTrackFilePath(fp)
	if fp == "" {
		return true, nil
	}
	hasSkip := false
	for _, p := range expandTrackProbePaths(musicRoot, fp) {
		st, err := os.Stat(p)
		if err == nil && !st.IsDir() {
			return false, nil
		}
		if err != nil && !isPathNotFoundErr(err) {
			hasSkip = true
			skipErr = err
		}
	}
	if hasSkip {
		return false, skipErr
	}
	return true, nil
}

// ListTracksMissingFiles returns IDs from the subset `ids` whose file_path does not exist on disk.
func (d *DB) ListTracksMissingFiles(ctx context.Context, musicRoot string, ids []uuid.UUID) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	const capBatch = 400
	var missing []uuid.UUID
	for start := 0; start < len(ids); start += capBatch {
		end := start + capBatch
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		rows, qerr := d.Pool.Query(ctx, `SELECT id, file_path FROM tracks WHERE id = ANY($1::uuid[])`, chunk)
		if qerr != nil {
			return missing, qerr
		}
		for rows.Next() {
			var id uuid.UUID
			var fp string
			if scanErr := rows.Scan(&id, &fp); scanErr != nil {
				rows.Close()
				return missing, scanErr
			}
			absent, skip := trackFileAbsentOnDisk(musicRoot, fp)
			if skip != nil {
				continue
			}
			if absent {
				missing = append(missing, id)
			}
		}
		qerr = rows.Err()
		rows.Close()
		if qerr != nil {
			return missing, qerr
		}
	}
	return missing, nil
}

// DeleteTracksWithMissingFiles removes rows whose paths do not resolve to existing files on disk.
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
