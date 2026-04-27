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
		_, albumID, ch, e := s.UpsertTrack(ctx, path, st, mt.UnixNano(), meta.artist, meta.album, meta.title, meta.track, meta.disc, meta.year, meta.durationMS)
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
	return
}

type trackMeta struct {
	artist, album, title                string
	track, disc, year                  *int
	durationMS                        *int
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
	album := strings.TrimSpace(m.Album())
	if out.title == "" {
		out.title = store.BaseName(p)
	}
	if artist == "" {
		artist = "Unknown Artist"
	}
	if album == "" {
		album = "Unknown"
	}
	out.artist = artist
	out.album = album

	if n, _ := m.Track(); n > 0 {
		t := n
		out.track = &t
	}
	if m.Year() > 0 {
		y := m.Year()
		out.year = &y
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
