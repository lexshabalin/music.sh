package stream

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"musicsh/internal/subproclow"
)

var (
	ffmpegOnce sync.Once
	ffmpegPath string // empty if not on PATH
)

func ffmpegExecutable() string {
	ffmpegOnce.Do(func() {
		p, err := exec.LookPath("ffmpeg")
		if err == nil {
			ffmpegPath = p
		}
	})
	return ffmpegPath
}

func playbackTranscodeDisabled() bool {
	v := strings.TrimSpace(os.Getenv("MUSICSH_DISABLE_PLAYBACK_TRANSCODE"))
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

// shouldTranscodeToMP3 reports extensions we pipe through ffmpeg as MP3 when ffmpeg is on PATH.
// Includes .flac (large FLAC libraries: Safari and some browsers do not decode FLAC in <audio>),
// plus .aiff / .aif for the same HTML5 limitations.
func shouldTranscodeToMP3(ext string) bool {
	if playbackTranscodeDisabled() {
		return false
	}
	switch strings.ToLower(ext) {
	case ".flac", ".aiff", ".aif":
		return true
	default:
		return false
	}
}

// ServePlayback streams a library audio file. For a few extensions it pipes MP3 from ffmpeg
// when ffmpeg is on PATH, so browsers that cannot decode the original container still play.
// Otherwise it falls back to ServeFileWithRange (byte-accurate Range, native Content-Type).
func ServePlayback(w http.ResponseWriter, r *http.Request, path string) error {
	ext := filepath.Ext(path)
	if ffmpegExecutable() != "" && shouldTranscodeToMP3(ext) {
		return serveTranscodedMP3(w, r, path)
	}
	return ServeFileWithRange(w, r, path)
}

func serveTranscodedMP3(w http.ResponseWriter, r *http.Request, abs string) error {
	ctx := r.Context()
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Del("Accept-Ranges")
		w.WriteHeader(http.StatusOK)
		return nil
	}
	if r.Method != http.MethodGet {
		return nil
	}

	// Transcoded stream is not byte-range compatible with the source file; ignore Range.
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Del("Accept-Ranges")
	w.Header().Del("Content-Length")
	w.Header().Del("Content-Range")

	cmd := subproclow.Command(ctx, "ffmpeg",
		"-hide_banner", "-loglevel", "error",
		"-nostdin",
		"-threads", "2",
		"-i", abs,
		"-vn",
		"-f", "mp3",
		"-acodec", "libmp3lame",
		"-b:a", "192k",
		"-write_id3v1", "0",
		"-id3v2_version", "0",
		"-",
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = w

	if err := subproclow.Run(ctx, cmd); err != nil {
		if stderr.Len() > 0 {
			err = &ffmpegStderrErr{Err: err, Stderr: stderr.String()}
		}
		return err
	}
	return nil
}

type ffmpegStderrErr struct {
	Err    error
	Stderr string
}

func (e *ffmpegStderrErr) Error() string {
	if e.Stderr != "" {
		return e.Err.Error() + ": " + strings.TrimSpace(e.Stderr)
	}
	return e.Err.Error()
}

func (e *ffmpegStderrErr) Unwrap() error { return e.Err }
