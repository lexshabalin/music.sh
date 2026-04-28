package stream

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// ServeFileWithRange supports HTTP Range for audio; path must be absolute
func ServeFileWithRange(w http.ResponseWriter, r *http.Request, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	size := st.Size()
	ct := mimeType(path)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Type", ct)

	ra := r.Header.Get("Range")
	if ra == "" {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
		_, err = io.Copy(w, f)
		if isClientDisconnect(err, r) {
			return nil
		}
		return err
	}
	start, end, ok := parseRange(ra, size)
	if !ok {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return nil
	}
	if _, err = f.Seek(start, io.SeekStart); err != nil {
		return err
	}
	chunk := end - start + 1
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
	w.Header().Set("Content-Length", strconv.FormatInt(chunk, 10))
	w.WriteHeader(http.StatusPartialContent)
	_, err = io.CopyN(w, f, chunk)
	if isClientDisconnect(err, r) {
		return nil
	}
	return err
}

func isClientDisconnect(err error, r *http.Request) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, syscall.EPIPE) || errors.Is(err, syscall.ECONNRESET) {
		return true
	}
	var ne net.Error
	if errors.As(err, &ne) && !ne.Timeout() {
		return true
	}
	if r != nil && r.Context() != nil && errors.Is(r.Context().Err(), context.Canceled) {
		return true
	}
	return false
}

func parseRange(ra string, size int64) (start, end int64, ok bool) {
	if !strings.HasPrefix(ra, "bytes=") {
		return 0, 0, false
	}
	ra = strings.TrimPrefix(ra, "bytes=")
	parts := strings.Split(ra, "-")
	if len(parts) != 2 {
		return 0, 0, false
	}
	if parts[0] == "" {
		// suffix: last N bytes
		suf, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || suf <= 0 {
			return 0, 0, false
		}
		if suf > size {
			suf = size
		}
		return size - suf, size - 1, true
	}
	s, err1 := strconv.ParseInt(parts[0], 10, 64)
	if err1 != nil || s < 0 {
		return 0, 0, false
	}
	var e int64
	if parts[1] == "" {
		e = size - 1
	} else {
		var err2 error
		e, err2 = strconv.ParseInt(parts[1], 10, 64)
		if err2 != nil || e < s {
			return 0, 0, false
		}
	}
	if s >= size {
		return 0, 0, false
	}
	if e >= size {
		e = size - 1
	}
	return s, e, true
}

func mimeType(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	ct := mime.TypeByExtension(ext)
	if ct == "" {
		switch ext {
		case ".mp3":
			return "audio/mpeg"
		case ".flac":
			return "audio/flac"
		case ".m4a", ".mp4", ".aac":
			return "audio/mp4"
		case ".ogg", ".opus":
			return "audio/ogg"
		case ".wav":
			return "audio/wav"
		default:
			return "application/octet-stream"
		}
	}
	// trim charset for browser
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return ct
}
