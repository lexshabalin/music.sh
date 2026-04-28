package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dhowden/tag"
	"github.com/google/uuid"

	"musicsh/internal/store"
)

// Scan walks MUSIC_DIR, upserts tracks, returns how many files were new or had mtime change
func Scan(ctx context.Context, s *store.DB, musicDir string) (changed int, err error) {
	if musicDir == "" {
		return 0, fmt.Errorf("MUSIC_DIR empty")
	}
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
		st := info.Size()
		mt := info.ModTime()
		meta := readTrackMeta(path)
		_, albumID, ch, e := s.UpsertTrack(ctx, path, st, mt.UnixNano(), meta.artist, meta.albumArtist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS, meta.format, meta.bitrateKbps)
		if e != nil {
			return e
		}
		// Always try to enqueue cover metadata; dedupe is handled in DB.
		_ = enqueueMetaJob(ctx, s, albumID)
		if ch {
			changed++
		}
		return nil
	})
	// If track rows moved to a different album (e.g. because of album-artist normalization),
	// delete now-empty albums to avoid duplicate shells in the UI.
	_ = s.CleanupOrphanAlbums(ctx)
	return
}

// ScanWithProgress is used by the API to show progress.
// progress(scannedFiles, foundTracks, changedTracks)
func ScanWithProgress(ctx context.Context, s *store.DB, musicDir string, progress func(int, int, int)) error {
	var scanned, found, changed int
	if musicDir == "" {
		return fmt.Errorf("MUSIC_DIR empty")
	}
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
		scanned++
		found++
		st := info.Size()
		mt := info.ModTime()
		meta := readTrackMeta(path)
		_, albumID, ch, e := s.UpsertTrack(ctx, path, st, mt.UnixNano(), meta.artist, meta.albumArtist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS, meta.format, meta.bitrateKbps)
		if e != nil {
			return e
		}
		_ = enqueueMetaJob(ctx, s, albumID)
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
	_ = s.CleanupOrphanAlbums(ctx)
	return nil
}

type trackMeta struct {
	artist, albumArtist, album, title   string
	track, disc, year                  *int
	durationMS                        *int
	format                            *string
	bitrateKbps                        *int
}

func readTrackMeta(p string) trackMeta {
	f, err := os.Open(p)
	if err != nil {
		return trackMeta{title: store.BaseName(p)}
	}
	defer f.Close()
	m, err := tag.ReadFrom(f)
	if err != nil {
		return trackMeta{title: store.BaseName(p)}
	}
	out := trackMeta{title: strings.TrimSpace(m.Title())}
	artist := strings.TrimSpace(m.Artist())
	albumArtist := ""
	// Not all tag formats expose album-artist; use optional interface.
	type albumArtistGetter interface{ AlbumArtist() string }
	if aa, ok := m.(albumArtistGetter); ok {
		albumArtist = strings.TrimSpace(aa.AlbumArtist())
	}
	album := strings.TrimSpace(m.Album())
	if out.title == "" {
		out.title = store.BaseName(p)
	}
	if artist == "" {
		artist = "Unknown Artist"
	}
	if albumArtist == "" {
		albumArtist = artist
	}
	if album == "" {
		album = "Unknown"
	}
	out.artist = artist
	out.albumArtist = albumArtist
	out.album = album

	if n, _ := m.Track(); n > 0 {
		t := n
		out.track = &t
	}
	if m.Year() > 0 {
		y := m.Year()
		out.year = &y
	}

	// Basic audio meta: expose container/format by extension; estimate bitrate if duration is known.
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(p), "."))
	if ext != "" {
		out.format = &ext
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
