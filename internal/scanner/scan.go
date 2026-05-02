package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"
	"github.com/google/uuid"

	"musicsh/internal/store"
)

// Yield every N scanned audio files so HDDs can breathe (Linux page cache stays useful on large libraries).
func scanThrottleMaybe(filesProcessed int) {
	if filesProcessed <= 0 {
		return
	}
	n := getenvIntPositive("LIBRARY_SCAN_YIELD_EVERY", 0)
	if n <= 0 {
		return
	}
	ms := getenvIntPositive("LIBRARY_SCAN_YIELD_MS", 0)
	if ms <= 0 {
		return
	}
	if filesProcessed%n != 0 {
		return
	}
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

func getenvIntPositive(key string, def int) int {
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

// rememberLibraryPath records a path confirmed on disk during a full walk (after normalize + Stat).
func rememberLibraryPath(seen map[string]struct{}, path string) {
	if seen == nil || strings.TrimSpace(path) == "" {
		return
	}
	seen[filepath.Clean(path)] = struct{}{}
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
	seen := make(map[string]struct{})
	var audioCount int
	err = filepath.Walk(musicDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info == nil || info.IsDir() {
			return nil
		}
		if !store.IsAudioFilename(info.Name()) {
			return nil
		}
		path, e := normalizeAudioPathOnDisk(ctx, s, path)
		if e != nil {
			return e
		}
		info, e = os.Stat(path)
		if e != nil {
			return e
		}
		rememberLibraryPath(seen, path)
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
		removed, err = s.DeleteTracksUnderRootNotSeen(ctx, musicDir, seen)
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
	seen := make(map[string]struct{})
	lastReport := 0
	err := filepath.Walk(musicDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info == nil || info.IsDir() {
			return nil
		}
		if !store.IsAudioFilename(info.Name()) {
			return nil
		}
		path, e := normalizeAudioPathOnDisk(ctx, s, path)
		if e != nil {
			return e
		}
		info, e = os.Stat(path)
		if e != nil {
			return e
		}
		rememberLibraryPath(seen, path)
		st := info.Size()
		mt := info.ModTime()
		ns := mt.UnixNano()
		scanned++
		found++
		scanThrottleMaybe(scanned)
		if alb, ok, qerr := s.TrackUnchangedFingerprint(ctx, path, st, ns); qerr == nil && ok {
			_ = enqueueMetaJob(ctx, s, alb)
			if progress != nil && (scanned-lastReport >= 10 || scanned == 1) {
				lastReport = scanned
				progress(scanned, found, changed)
			}
			return nil
		}
		meta := readTrackMeta(path)
		trackID, albumID, ch, e := s.UpsertTrack(ctx, path, st, ns, meta.artist, meta.albumArtist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS, meta.format, meta.bitrateKbps, meta.tagAlbumArtist, meta.genre, meta.composer, meta.comment)
		if e != nil {
			return e
		}
		_ = enqueueMetaJob(ctx, s, albumID)
		if meta.inferred {
			_ = s.EnsureIdentifyTrackJob(ctx, trackID)
		}
		if ch {
			changed++
		}
		if progress != nil && (scanned-lastReport >= 10 || scanned == 1) {
			lastReport = scanned
			progress(scanned, found, changed)
		}
		return nil
	})
	if err != nil {
		return err
	}
	removed, delErr := s.DeleteTracksUnderRootNotSeen(ctx, musicDir, seen)
	if delErr != nil {
		return delErr
	}
	changed += int(removed)
	if err := s.PrunePlaybackQueuesRemovedTracks(ctx); err != nil {
		return err
	}
	if progress != nil {
		progress(scanned, found, changed)
	}
	_ = s.CleanupOrphanAlbums(ctx)
	return nil
}

type trackMeta struct {
	artist, albumArtist, album, title string
	track, disc, year                *int
	durationMS                      *int
	format                          *string
	bitrateKbps                     *int
	inferred                        bool
	// Optional tag-derived strings stored on tracks for imprint (raw from tags / file).
	tagAlbumArtist, genre, composer, comment string
}

var reArtistTitle = regexp.MustCompile(`\s*-\s*`)
var reTrackPrefix = regexp.MustCompile(`^\s*(\d{1,3})([.)\s_-]+)\s*`)
var reYearPrefix = regexp.MustCompile(`^\d{4}$`)

func inferFromPath(p string) (artist, album, title string) {
	title = strings.TrimSpace(store.BaseName(p))

	// Strip leading track numbers like "01 -", "1.", "03_"
	title = reTrackPrefix.ReplaceAllString(title, "")

	// Common pattern: "Artist - Title.ext"
	parts := reArtistTitle.Split(title, -1)
	// Examples in flat libraries:
	// - "1970 - Led Zeppelin - Immigrant Song"
	// - "Led Zeppelin - Immigrant Song"
	// - "Artist - Album - Title"
	if len(parts) >= 2 {
		p0 := strings.TrimSpace(parts[0])
		// drop year prefix if present
		if reYearPrefix.MatchString(p0) && len(parts) >= 3 {
			parts = parts[1:]
		}
		p0 = strings.TrimSpace(parts[0])
		if len(parts) == 2 {
			a := strings.TrimSpace(parts[0])
			t := strings.TrimSpace(parts[1])
			if a != "" && t != "" {
				artist = a
				title = t
			}
		} else if len(parts) >= 3 {
			// best-effort: Artist - Album - Title
			a := p0
			alb := strings.TrimSpace(parts[1])
			t := strings.TrimSpace(parts[len(parts)-1])
			if a != "" && t != "" {
				artist = a
				title = t
			}
			// album is optional; avoid treating "feat" etc as album by mistake
			if alb != "" && alb != t {
				album = alb
			}
		}
	}

	// Folder-based: /Artist/Album/Track.ext
	dir := filepath.Dir(p)
	albumDir := strings.TrimSpace(filepath.Base(dir))
	parent := filepath.Dir(dir)
	artistDir := strings.TrimSpace(filepath.Base(parent))

	if albumDir != "" && albumDir != "." && albumDir != string(filepath.Separator) {
		// only use folder album if we didn't already infer album from filename
		if strings.TrimSpace(album) == "" {
			album = albumDir
		}
	}
	if artist == "" && artistDir != "" && artistDir != "." && artistDir != string(filepath.Separator) {
		artist = artistDir
	}
	return
}

func readTrackMeta(p string) trackMeta {
	f, err := os.Open(p)
	if err != nil {
		artist, album, title := inferFromPath(p)
		out := trackMeta{
			artist:      strings.TrimSpace(artist),
			albumArtist: strings.TrimSpace(artist),
			album:       strings.TrimSpace(album),
			title:       strings.TrimSpace(title),
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
		if strings.TrimSpace(out.album) == "" {
			out.album = "Unknown"
		}
		out.albumArtist = primaryArtistForAlbumGrouping(out.albumArtist)
		out.inferred = true
		return out
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		artist, album, title := inferFromPath(p)
		out := trackMeta{
			artist:      strings.TrimSpace(artist),
			albumArtist: strings.TrimSpace(artist),
			album:       strings.TrimSpace(album),
			title:       strings.TrimSpace(title),
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
		if strings.TrimSpace(out.album) == "" {
			out.album = "Unknown"
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

	// If tags were empty-ish, try to improve from filename/folders.
	if strings.EqualFold(strings.TrimSpace(out.title), strings.TrimSpace(store.BaseName(p))) || out.title == "" {
		ia, ialb, it := inferFromPath(p)
		if strings.TrimSpace(out.title) == "" && strings.TrimSpace(it) != "" {
			out.title = strings.TrimSpace(it)
		}
		if (artist == "" || artist == "Unknown Artist") && strings.TrimSpace(ia) != "" {
			artist = strings.TrimSpace(ia)
			out.artist = artist
			if albumArtistRaw == "" {
				out.albumArtist = primaryArtistForAlbumGrouping(artist)
			}
		}
		if (album == "" || album == "Unknown") && strings.TrimSpace(ialb) != "" {
			out.album = strings.TrimSpace(ialb)
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
