package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"musicsh/internal/acoustid"
	"musicsh/internal/cover"
	"musicsh/internal/mb"
	"musicsh/internal/scanner"
	"musicsh/internal/store"
)

type Config struct {
	MusicDir string
	DataDir  string
	AcoustIDKey string
}

// Worker processes background jobs
type Worker struct {
	DB  *store.DB
	MB  *mb.Client
	AC  *acoustid.Client
	Cfg Config
}

func (h *Worker) Run(ctx context.Context) {
	// Run up to 3 jobs concurrently (requested parallelism limit).
	for i := 0; i < 3; i++ {
		go func() {
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
		}()
	}
	<-ctx.Done()
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
	case "identify_track":
		var p struct {
			TrackID string `json:"trackId"`
		}
		if uerr := json.Unmarshal([]byte(payload), &p); uerr != nil {
			_ = h.DB.FailJob(ctx, id, uerr.Error())
			return uerr
		}
		tid, uerr := uuid.Parse(p.TrackID)
		if uerr != nil {
			_ = h.DB.FailJob(ctx, id, uerr.Error())
			return uerr
		}
		if h.AC == nil {
			h.AC = acoustid.New(h.Cfg.AcoustIDKey)
		}
		ierr := h.identifyTrack(ctx, tid)
		if ierr != nil {
			_ = h.DB.FailJob(ctx, id, ierr.Error())
			return ierr
		}
		return h.DB.CompleteJob(ctx, id)
	case "imprint_tags":
		var p struct {
			AlbumID string `json:"albumId"`
			Tracks  []struct {
				TrackID string   `json:"trackId"`
				Fields  []string `json:"fields"`
			} `json:"tracks"`
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
		if err := h.imprintTagsJob(ctx, id, aid, p.Tracks); err != nil {
			_ = h.DB.FailJob(ctx, id, err.Error())
			return err
		}
		return h.DB.CompleteJob(ctx, id)
	default:
		_ = h.DB.FailJob(ctx, id, "unknown job: "+jt)
		return nil
	}
}

func (h *Worker) identifyTrack(ctx context.Context, trackID uuid.UUID) error {
	path, _, durMs, _, _, rec, err := h.DB.TrackIdentifyInput(ctx, trackID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(path) == "" {
		return nil
	}
	// already identified
	if rec != nil && strings.TrimSpace(*rec) != "" {
		return nil
	}

	durSec, fp, ok := runFpcalc(path)
	if !ok {
		// fpcalc missing or failed - don't retry forever
		return nil
	}
	// prefer fpcalc duration if db missing
	if durMs == nil && durSec > 0 {
		x := durSec * 1000
		durMs = &x
	}

	res, err := h.AC.Lookup(durSec, fp)
	if err != nil {
		return err
	}
	if res == nil || res.RecordingID == "" || res.Score < 0.55 {
		// too weak / no match
		return nil
	}

	albumID, err := h.DB.ApplyIdentifiedMeta(ctx, trackID, res.Title, res.Artist, res.Album, res.Year, res.RecordingID)
	if err != nil {
		return err
	}
	if albumID != uuid.Nil {
		_ = h.DB.EnsureFetchAlbumJob(ctx, albumID)
	}
	return nil
}

func (h *Worker) fetchAlbumMeta(ctx context.Context, albumID uuid.UUID) error {
	locked, err := h.DB.AlbumCoverLocked(ctx, albumID)
	if err != nil {
		return err
	}
	if locked {
		return nil
	}
	has, err := h.DB.AlbumHasCover(ctx, albumID)
	if err != nil {
		return err
	}
	if has {
		return nil
	}

	// Prefer local folder images if present (cover.jpg/folder.jpg/front.*, any jpg/png).
	if p, ok := h.findLocalCoverForAlbum(ctx, albumID); ok {
		if err := os.MkdirAll(filepath.Join(h.Cfg.DataDir, "covers"), 0o755); err != nil {
			return err
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
			ext = ".jpg"
		}
		// normalize .jpeg to .jpg to simplify downstream content-type logic
		if ext == ".jpeg" {
			ext = ".jpg"
		}
		dest := filepath.Join(h.Cfg.DataDir, "covers", albumID.String()+ext)
		if err := copyFile(dest, p); err != nil {
			return err
		}
		rel := filepath.Join("covers", albumID.String()+ext)
		return h.DB.SetAlbumCoverPath(ctx, albumID, rel)
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
		// 404 means there is no cover in CAA; don't retry forever.
		var se cover.HTTPStatusError
		if errors.As(err, &se) && se.StatusCode == 404 {
			log.Printf("no cover in CAA for %s (%q/%q)", mbid, artist, title)
			return nil
		}
		// transient issues -> retry via FailJob
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

func (h *Worker) findLocalCoverForAlbum(ctx context.Context, albumID uuid.UUID) (string, bool) {
	path, err := h.DB.GetAnyTrackPathForAlbum(ctx, albumID)
	if err != nil || strings.TrimSpace(path) == "" {
		return "", false
	}
	dir := filepath.Dir(path)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}

	type cand struct {
		path  string
		score int
	}
	var cands []cand
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		n := strings.ToLower(e.Name())
		ext := strings.ToLower(filepath.Ext(n))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		score := 0
		switch {
		case strings.Contains(n, "cover"):
			score += 100
		case strings.Contains(n, "folder"):
			score += 90
		case strings.Contains(n, "front"):
			score += 80
		}
		if ext == ".png" {
			score += 5
		}
		cands = append(cands, cand{path: filepath.Join(dir, e.Name()), score: score})
	}
	if len(cands) == 0 {
		return "", false
	}
	sort.SliceStable(cands, func(i, j int) bool {
		return cands[i].score > cands[j].score
	})
	return cands[0].path, true
}

func copyFile(dst, src string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
