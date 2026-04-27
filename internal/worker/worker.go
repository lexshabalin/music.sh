package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"

	"musicsh/internal/cover"
	"musicsh/internal/mb"
	"musicsh/internal/scanner"
	"musicsh/internal/store"
)

type Config struct {
	MusicDir string
	DataDir  string
}

// Worker processes background jobs
type Worker struct {
	DB  *store.DB
	MB  *mb.Client
	Cfg Config
}

func (h *Worker) Run(ctx context.Context) {
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := h.runOne(ctx); err != nil {
				log.Printf("worker: %v", err)
			}
		}
	}
}

func (h *Worker) runOne(ctx context.Context) error {
	id, jt, payload, err := h.DB.ClaimNextJob(ctx)
	if err != nil {
		return err
	}
	if id == uuid.Nil {
		return nil
	}
	switch jt {
	case "scan":
		_, serr := scanner.Scan(ctx, h.DB, h.Cfg.MusicDir)
		if serr != nil {
			_ = h.DB.FailJob(ctx, id, serr.Error())
			return serr
		}
		return h.DB.CompleteJob(ctx, id)
	case "fetch_album":
		var p struct {
			AlbumID string `json:"albumId"`
		}
		if uerr := json.Unmarshal([]byte(payload), &p); uerr != nil {
			_ = h.DB.FailJob(ctx, id, uerr.Error())
			return uerr
		}
		aid, uerr := uuid.Parse(p.AlbumID)
		if uerr != nil {
			_ = h.DB.FailJob(ctx, id, uerr.Error())
			return uerr
		}
		ferr := h.fetchAlbumMeta(ctx, aid)
		if ferr != nil {
			_ = h.DB.FailJob(ctx, id, ferr.Error())
			return ferr
		}
		return h.DB.CompleteJob(ctx, id)
	default:
		_ = h.DB.FailJob(ctx, id, "unknown job: "+jt)
		return nil
	}
}

func (h *Worker) fetchAlbumMeta(ctx context.Context, albumID uuid.UUID) error {
	has, err := h.DB.AlbumHasCover(ctx, albumID)
	if err != nil {
		return err
	}
	if has {
		return nil
	}
	mbid, _ := h.DB.GetAlbumMbid(ctx, albumID)
	title, _, artist, err := h.DB.GetAlbumByID(ctx, albumID)
	if err != nil {
		return err
	}
	if mbid == "" {
		rel, _, _, _ := h.MB.SearchRelease(artist, title)
		if rel == "" {
			q := fmt.Sprintf("%s %s", artist, title)
			rel, _, _ = h.MB.SearchByFreeText(q)
		}
		mbid = rel
	}
	if mbid == "" {
		// no match online — end job; user can re-scan if metadata services become available
		log.Printf("no MusicBrainz release for %q — %q", title, artist)
		return nil
	}
	_ = h.DB.SetMBReleaseID(ctx, albumID, mbid)
	dest := filepath.Join(h.Cfg.DataDir, "covers", albumID.String()+".jpg")
	if err = os.MkdirAll(filepath.Join(h.Cfg.DataDir, "covers"), 0o755); err != nil {
		return err
	}
	if err = cover.DownloadFront(mbid, dest); err != nil {
		return err
	}
	rel := filepath.Join("covers", albumID.String()+".jpg")
	if err = h.DB.SetAlbumCoverPath(ctx, albumID, rel); err != nil {
		return err
	}
	// enqueue scan not needed; cover is set
	_ = title
	_ = artist
	return nil
}
