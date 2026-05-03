package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dhowden/tag"
	"github.com/google/uuid"

	"musicsh/internal/disklog"
	"musicsh/internal/store"
)

// globalScanMu ensures at most one library walk runs at a time (HTTP scan, worker "scan" job),
// similar to Navidrome's single-flight scan — avoids doubled disk and DB load.
var globalScanMu sync.Mutex

// Yield every N scanned audio files so HDDs can breathe (Linux page cache stays useful on large libraries).
// Defaults (20 files, 45 ms) apply when the corresponding env var is unset. If either value is 0, throttling is off.
func scanThrottleMaybe(filesProcessed int) {
	if filesProcessed <= 0 {
		return
	}
	const defEvery, defMS = 20, 45
	n := getenvScanYieldInt("LIBRARY_SCAN_YIELD_EVERY", defEvery)
	ms := getenvScanYieldInt("LIBRARY_SCAN_YIELD_MS", defMS)
	if n <= 0 || ms <= 0 {
		return
	}
	if filesProcessed%n != 0 {
		return
	}
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

// scanDirYieldMaybe sleeps every N directory entries during walkLibraryAudio (ReadDir + subtree recursion).
// Reduces sustained metadata I/O on slow disks. LIBRARY_SCAN_DIR_YIELD_EVERY / _MS (defaults 8 / 25 ms). Either 0 disables.
func scanDirYieldMaybe(dirsEntered int) {
	if dirsEntered <= 0 {
		return
	}
	const defEvery, defMS = 8, 25
	n := getenvScanYieldInt("LIBRARY_SCAN_DIR_YIELD_EVERY", defEvery)
	ms := getenvScanYieldInt("LIBRARY_SCAN_DIR_YIELD_MS", defMS)
	if n <= 0 || ms <= 0 {
		return
	}
	if dirsEntered%n != 0 {
		return
	}
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

func getenvScanYieldInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	x, err := strconv.Atoi(v)
	if err != nil || x < 0 {
		return def
	}
	return x
}

// scanContinueOnFileError: on per-file errors (rename, stat, DB), log and continue instead of aborting the whole walk.
// Set MUSICSH_SCAN_CONTINUE_ON_ERROR=0 for strict mode (first error stops the scan).
func scanContinueOnFileError() bool {
	v := strings.TrimSpace(os.Getenv("MUSICSH_SCAN_CONTINUE_ON_ERROR"))
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

func scanProgressMinInterval() time.Duration {
	const defMS = 500
	v := strings.TrimSpace(os.Getenv("SCAN_PROGRESS_INTERVAL_MS"))
	if v == "" {
		return time.Duration(defMS) * time.Millisecond
	}
	ms, err := strconv.Atoi(v)
	if err != nil || ms < 0 {
		return time.Duration(defMS) * time.Millisecond
	}
	if ms > 30000 {
		ms = 30000
	}
	return time.Duration(ms) * time.Millisecond
}

func scanProgressMinFiles() int {
	const def = 25
	v := strings.TrimSpace(os.Getenv("SCAN_PROGRESS_MIN_FILES"))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	if n > 500 {
		return 500
	}
	return n
}

// scanProgressGate coalesces progress callbacks to cut mutex churn and UI poll amplification (Navidrome-style throttling).
type scanProgressGate struct {
	progress    func(int, int, int)
	minInterval time.Duration
	minFiles    int
	lastCount   int
	lastEmitAt  time.Time
}

func newScanProgressGate(progress func(int, int, int)) *scanProgressGate {
	if progress == nil {
		return nil
	}
	return &scanProgressGate{
		progress:    progress,
		minInterval: scanProgressMinInterval(),
		minFiles:    scanProgressMinFiles(),
	}
}

func (g *scanProgressGate) emit(scanned, found, changed int, force bool) {
	if g == nil {
		return
	}
	if !force {
		now := time.Now()
		intervalOK := now.Sub(g.lastEmitAt) >= g.minInterval
		filesOK := scanned <= 1 || scanned-g.lastCount >= g.minFiles
		if !intervalOK && !filesOK {
			return
		}
	}
	g.lastCount = scanned
	g.lastEmitAt = time.Now()
	g.progress(scanned, found, changed)
}

// normalizeAudioPathOnDisk renames bad basenames (trailing space before ext, HTML entities like &#39;) when the target is free, and updates DB paths.
func normalizeAudioPathOnDisk(ctx context.Context, s *store.DB, path string) (string, error) {
	base := filepath.Base(path)
	clean := store.SanitizeAudioFileBaseName(base)
	if clean == base {
		return path, nil
	}
	dir := filepath.Dir(path)
	newPath := filepath.Join(dir, clean)
	if _, err := os.Stat(newPath); err == nil {
		return path, nil
	}
	if err := os.Rename(path, newPath); err != nil {
		return path, err
	}
	if err := s.UpdateTrackFilePath(ctx, path, newPath); err != nil {
		_ = os.Rename(newPath, path)
		return path, err
	}
	return newPath, nil
}

// Scan walks MUSIC_DIR, upserts tracks, returns how many files were new or had mtime change
func Scan(ctx context.Context, s *store.DB, musicDir string) (changed int, err error) {
	if musicDir == "" {
		return 0, fmt.Errorf("MUSIC_DIR empty")
	}
	globalScanMu.Lock()
	defer globalScanMu.Unlock()

	var audioCount int
	cont := scanContinueOnFileError()
	err = walkLibraryAudio(ctx, musicDir, scanFollowSymlinks(), func(path string) error {
		orig := path
		var e error
		path, e = normalizeAudioPathOnDisk(ctx, s, path)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (normalize): %v", orig, e)
				return nil
			}
			return e
		}
		info, e := os.Stat(path)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (stat): %v", path, e)
				return nil
			}
			return e
		}
		st := info.Size()
		mt := info.ModTime()
		audioCount++
		scanThrottleMaybe(audioCount)
		ns := mt.UnixNano()
		if alb, ok, qerr := s.TrackUnchangedFingerprint(ctx, path, st, ns); qerr == nil && ok {
			_ = enqueueMetaJob(ctx, s, alb)
			return nil
		}
		meta := readTrackMeta(path)
		trackID, albumID, ch, e := s.UpsertTrack(ctx, path, st, ns, meta.artist, meta.albumArtist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS, meta.format, meta.bitrateKbps, meta.tagAlbumArtist, meta.genre, meta.composer, meta.comment)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (upsert): %v", path, e)
				return nil
			}
			return e
		}
		// Always try to enqueue cover metadata; dedupe is handled in DB.
		_ = enqueueMetaJob(ctx, s, albumID)
		// If metadata was inferred (flat files/no tags), try acoustid identification in background.
		if meta.inferred {
			_ = s.EnsureIdentifyTrackJob(ctx, trackID)
		}
		if ch {
			changed++
		}
		return nil
	})
	if err == nil {
		var removed int64
		removed, err = s.DeleteTracksWithMissingFiles(ctx, musicDir)
		if err == nil {
			changed += int(removed)
			err = s.PrunePlaybackQueuesRemovedTracks(ctx)
		}
	}
	// If track rows moved to a different album (e.g. because of album-artist normalization),
	// delete now-empty albums to avoid duplicate shells in the UI.
	_ = s.CleanupOrphanAlbums(ctx)
	return changed, err
}

// ScanWithProgress is used by the API to show progress.
// progress(scannedFiles, foundTracks, changedTracks)
func ScanWithProgress(ctx context.Context, s *store.DB, musicDir string, progress func(int, int, int)) error {
	var scanned, found, changed int
	if musicDir == "" {
		return fmt.Errorf("MUSIC_DIR empty")
	}
	globalScanMu.Lock()
	defer globalScanMu.Unlock()

	pg := newScanProgressGate(progress)
	// Immediate tick so status polling sees Running + zero counts (avoids silent gap on huge dirs before first audio).
	pg.emit(0, 0, 0, true)
	cont := scanContinueOnFileError()
	err := walkLibraryAudio(ctx, musicDir, scanFollowSymlinks(), func(path string) error {
		orig := path
		var e error
		path, e = normalizeAudioPathOnDisk(ctx, s, path)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (normalize): %v", orig, e)
				return nil
			}
			return e
		}
		info, e := os.Stat(path)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (stat): %v", path, e)
				return nil
			}
			return e
		}
		st := info.Size()
		mt := info.ModTime()
		ns := mt.UnixNano()
		scanned++
		found++
		scanThrottleMaybe(scanned)
		if alb, ok, qerr := s.TrackUnchangedFingerprint(ctx, path, st, ns); qerr == nil && ok {
			_ = enqueueMetaJob(ctx, s, alb)
			pg.emit(scanned, found, changed, false)
			return nil
		}
		meta := readTrackMeta(path)
		trackID, albumID, ch, e := s.UpsertTrack(ctx, path, st, ns, meta.artist, meta.albumArtist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS, meta.format, meta.bitrateKbps, meta.tagAlbumArtist, meta.genre, meta.composer, meta.comment)
		if e != nil {
			if cont {
				log.Printf("musicsh scanner: skip %q (upsert): %v", path, e)
				return nil
			}
			return e
		}
		_ = enqueueMetaJob(ctx, s, albumID)
		if meta.inferred {
			_ = s.EnsureIdentifyTrackJob(ctx, trackID)
		}
		if ch {
			changed++
		}
		pg.emit(scanned, found, changed, false)
		return nil
	})
	if err != nil {
		return err
	}
	removed, delErr := s.DeleteTracksWithMissingFiles(ctx, musicDir)
	if delErr != nil {
		return delErr
	}
	changed += int(removed)
	if err := s.PrunePlaybackQueuesRemovedTracks(ctx); err != nil {
		return err
	}
	pg.emit(scanned, found, changed, true)
	_ = s.CleanupOrphanAlbums(ctx)
	return nil
}

type trackMeta struct {
	artist, albumArtist, album, title string
	track, disc, year                 *int
	durationMS                        *int
	format                            *string
	bitrateKbps                       *int
	inferred                          bool
	// Optional tag-derived strings stored on tracks for imprint (raw from tags / file).
	tagAlbumArtist, genre, composer, comment string
}

var reArtistTitle = regexp.MustCompile(`\s*-\s*`)
var reTrackPrefix = regexp.MustCompile(`^\s*(\d{1,3})([.)\s_-]+)\s*`)
var reYearPrefix = regexp.MustCompile(`^\d{4}$`)

// inferTitleFromPath picks a nicer track title from the file basename only (strip track
// prefixes; with " - " segments, keep the last segment). Artist/album/grouping strings
// must come from embedded tags — never from directory names or earlier filename segments.
func inferTitleFromPath(p string) string {
	title := strings.TrimSpace(store.BaseName(p))

	// Strip leading track numbers like "01 -", "1.", "03_"
	title = reTrackPrefix.ReplaceAllString(title, "")

	parts := reArtistTitle.Split(title, -1)
	if len(parts) < 2 {
		return title
	}
	p0 := strings.TrimSpace(parts[0])
	if reYearPrefix.MatchString(p0) && len(parts) >= 3 {
		parts = parts[1:]
	}
	if len(parts) >= 2 {
		return strings.TrimSpace(parts[len(parts)-1])
	}
	return title
}

func readTrackMeta(p string) trackMeta {
	disklog.Printf("scan_read_tags path=%q", p)
	f, err := os.Open(p)
	if err != nil {
		out := trackMeta{
			artist:      "",
			albumArtist: "",
			album:       "Unknown",
			title:       strings.TrimSpace(inferTitleFromPath(p)),
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
		if ext != "" {
			out.format = &ext
		}
		if out.durationMS == nil {
			if ms, ok := probeDurationMS(p); ok {
				out.durationMS = ms
			}
		}
		if strings.TrimSpace(out.artist) == "" {
			out.artist = "Unknown Artist"
			out.albumArtist = out.artist
		}
		out.albumArtist = primaryArtistForAlbumGrouping(out.albumArtist)
		out.inferred = true
		return out
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		out := trackMeta{
			artist:      "",
			albumArtist: "",
			album:       "Unknown",
			title:       strings.TrimSpace(inferTitleFromPath(p)),
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
		if ext != "" {
			out.format = &ext
		}
		if out.durationMS == nil {
			if ms, ok := probeDurationMS(p); ok {
				out.durationMS = ms
			}
		}
		if strings.TrimSpace(out.artist) == "" {
			out.artist = "Unknown Artist"
			out.albumArtist = out.artist
		}
		out.albumArtist = primaryArtistForAlbumGrouping(out.albumArtist)
		out.inferred = true
		return out
	}
	out := trackMeta{title: strings.TrimSpace(m.Title())}
	artist := strings.TrimSpace(m.Artist())
	albumArtistRaw := ""
	// Not all tag formats expose album-artist; use optional interface.
	type albumArtistGetter interface{ AlbumArtist() string }
	if aa, ok := m.(albumArtistGetter); ok {
		albumArtistRaw = strings.TrimSpace(aa.AlbumArtist())
	}
	album := strings.TrimSpace(m.Album())
	if out.title == "" {
		out.title = store.BaseName(p)
	}
	if artist == "" {
		artist = "Unknown Artist"
	}
	albumArtist := albumArtistRaw
	if albumArtist == "" {
		albumArtist = artist
	}
	if album == "" {
		album = "Unknown"
	}
	out.artist = artist
	// Album grouping should not split on featured guests in the artist string.
	// If album artist isn't explicitly tagged, derive it from the track artist.
	// If it *is* explicitly tagged but still contains collab markers, normalize it too.
	out.albumArtist = primaryArtistForAlbumGrouping(albumArtist)
	out.album = album

	// If tags were empty-ish, try to improve title from basename only (never artist/album).
	if strings.EqualFold(strings.TrimSpace(out.title), strings.TrimSpace(store.BaseName(p))) || out.title == "" {
		if it := strings.TrimSpace(inferTitleFromPath(p)); it != "" {
			if strings.TrimSpace(out.title) == "" || strings.EqualFold(strings.TrimSpace(out.title), strings.TrimSpace(store.BaseName(p))) {
				out.title = it
			}
		}
		out.inferred = true
	}

	if n, _ := m.Track(); n > 0 {
		t := n
		out.track = &t
	}
	if m.Year() > 0 {
		y := m.Year()
		out.year = &y
	}
	out.genre = strings.TrimSpace(m.Genre())
	out.composer = strings.TrimSpace(m.Composer())
	out.comment = strings.TrimSpace(m.Comment())
	out.tagAlbumArtist = strings.TrimSpace(albumArtistRaw)

	// Basic audio meta: expose container/format by extension; estimate bitrate if duration is known.
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
	if ext != "" {
		out.format = &ext
	}

	// Duration: if not present in tags, try ffprobe.
	if out.durationMS == nil {
		if ms, ok := probeDurationMS(p); ok {
			out.durationMS = ms
		}
	}

	if out.durationMS != nil && *out.durationMS > 0 {
		if st, err := os.Stat(p); err == nil && st.Size() > 0 {
			secs := float64(*out.durationMS) / 1000.0
			if secs > 0.01 {
				kbps := int(((float64(st.Size()) * 8.0) / secs) / 1000.0)
				if kbps > 0 && kbps < 50000 {
					out.bitrateKbps = &kbps
				}
			}
		}
	}
	return out
}

func enqueueMetaJob(ctx context.Context, s *store.DB, albumID uuid.UUID) error {
	has, err := s.AlbumHasCover(ctx, albumID)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	c, err := s.CountPendingMetaJobForAlbum(ctx, albumID)
	if err != nil {
		return err
	}
	if c > 0 {
		return nil
	}
	payload, err := json.Marshal(struct {
		AlbumID string `json:"albumId"`
	}{AlbumID: albumID.String()})
	if err != nil {
		return err
	}
	return s.EnqueueJob(ctx, uuid.New(), "fetch_album", string(payload))
}
