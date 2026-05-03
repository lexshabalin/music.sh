package stream

import (
	"bytes"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"musicsh/internal/disklog"
	"musicsh/internal/store"
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

// playbackRawContentType picks Content-Type for byte-accurate streaming when ffmpeg is not used.
// Paths without an extension (or unknown ext → application/octet-stream) would otherwise make
// browsers reject the stream (mediaErr=4 / NotSupportedError) even when bytes are valid audio.
func playbackRawContentType(filePath string, formatHint string) string {
	ct := store.AudioContentTypeForPath(filePath)
	ext := strings.ToLower(filepath.Ext(filePath))
	alt := store.AudioContentTypeForFormatHint(formatHint)
	if alt != "" && (ext == "" || ct == "application/octet-stream") {
		return alt
	}
	return ct
}

// shouldTranscodeToMP3 reports whether we pipe this file through ffmpeg as MP3 when ffmpeg is on PATH.
// Uses file_path extension first; if missing or ambiguous, falls back on tracks.format from the DB
// (e.g. path without ".flac" suffix but format = flac).
// Ogg/WebM/Opus are often rejected by Safari as <audio> (NotSupportedError / mediaErr=4) even when HEAD succeeds.
// .m4a/.mp4 often hold ALAC or AAC profiles Chrome refuses; transcoding to MP3 is the reliable <audio> path.
func shouldTranscodeToMP3(filePath string, formatHint string) bool {
	if playbackTranscodeDisabled() {
		return false
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".flac", ".aiff", ".aif", ".ogg", ".oga", ".opus", ".weba", ".webm",
		".m4a", ".mp4":
		return true
	// Assume already browser-friendly as raw stream.
	case ".mp3", ".aac", ".wav":
		return false
	}
	h := strings.TrimSpace(strings.ToLower(formatHint))
	h = strings.TrimPrefix(h, ".")
	switch h {
	case "flac", "aiff", "aif", "ogg", "opus", "vorbis", "webm", "weba", "alac", "m4a", "mp4":
		return true
	default:
		return false
	}
}

// ServePlayback streams a library audio file. For a few extensions it pipes MP3 from ffmpeg
// when ffmpeg is on PATH, so browsers that cannot decode the original container still play.
// formatHint is DB tracks.format (e.g. "flac") when file_path may lack a reliable extension.
// Otherwise it falls back to ServeFileWithRange (byte-accurate Range, native Content-Type).
func ServePlayback(w http.ResponseWriter, r *http.Request, path string, formatHint string) error {
	if ffmpegExecutable() != "" && shouldTranscodeToMP3(path, formatHint) {
		return serveTranscodedMP3(w, r, path)
	}
	return serveFileWithRangeContentType(w, r, path, playbackRawContentType(path, formatHint))
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

	disklog.Printf("stream_transcode_ffmpeg path=%q", abs)
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
