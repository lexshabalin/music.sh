package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"musicsh/internal/store"
	"musicsh/internal/stream"
	"musicsh/internal/scanner"
)

// --- library ---

func (a *App) listArtists(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	list, err := a.DB.ListArtists(r.Context(), q)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, list)
}

type albumOut struct {
	store.Album
	CoverURL *string `json:"coverUrl,omitempty"`
}

func (a *App) getAlbum(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	al, err := a.DB.GetAlbum(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	ao := albumOut{Album: al}
	if al.CoverPath != nil && *al.CoverPath != "" {
		ao.CoverURL = a.coverURLFor(al.ID)
	}
	JSON(w, 200, ao)
}

func (a *App) listAlbums(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	var aid *uuid.UUID
	if s := r.URL.Query().Get("artistId"); s != "" {
		u, err := uuid.Parse(s)
		if err == nil {
			aid = &u
		}
	}
	list, err := a.DB.ListAlbums(r.Context(), q, aid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	var out []albumOut
	for _, al := range list {
		ao := albumOut{Album: al}
		if al.CoverPath != nil && *al.CoverPath != "" {
			ao.CoverURL = a.coverURLFor(al.ID)
		}
		out = append(out, ao)
	}
	JSON(w, 200, out)
}

func (a *App) coverURLFor(id uuid.UUID) *string {
	s := "/api/albums/" + id.String() + "/cover"
	return &s
}

func (a *App) listTracks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("query")
	var albumID, artistID *uuid.UUID
	if s := r.URL.Query().Get("albumId"); s != "" {
		if u, err := uuid.Parse(s); err == nil {
			albumID = &u
		}
	}
	if s := r.URL.Query().Get("artistId"); s != "" {
		if u, err := uuid.Parse(s); err == nil {
			artistID = &u
		}
	}
	list, err := a.DB.ListTracks(r.Context(), q, albumID, artistID)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, list)
}

func (a *App) getTrack(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	t, err := a.DB.GetTrackByID(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	JSON(w, 200, t)
}

func (a *App) stream(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	_, err = a.parseUserIDFromMediaRequest(r)
	if err != nil {
		JSONError(w, 401, "unauthorized")
		return
	}
	abs, _, err := a.DB.GetTrackForStream(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	if err := stream.ServeFileWithRange(w, r, abs); err != nil {
		// If we can't even open/stat/seek the file, return a useful error instead of a broken stream.
		JSONError(w, 404, "stream failed")
		return
	}
}

func (a *App) albumCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	_, err = a.parseUserIDFromMediaRequest(r)
	if err != nil {
		JSONError(w, 401, "unauthorized")
		return
	}
	rel, err := a.DB.GetAlbumCoverPath(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "no cover")
		return
	}
	abs := filepath.Join(a.DataDir, rel)
	f, err := os.Open(abs)
	if err != nil {
		JSONError(w, 404, "file")
		return
	}
	_ = f.Close()
	// re-open for sendfile-style
	ct := "image/jpeg"
	if filepath.Ext(abs) == ".png" {
		ct = "image/png"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, abs)
}

// --- scan ---

func (a *App) scan(w http.ResponseWriter, r *http.Request) {
	a.scanMu.Lock()
	if a.scanState.Running {
		st := a.scanState
		a.scanMu.Unlock()
		JSON(w, 202, map[string]any{"ok": true, "running": true, "state": st})
		return
	}
	a.scanState = scanState{Running: true, StartedAt: time.Now()}
	a.scanMu.Unlock()

	go a.runScan(context.Background())

	JSON(w, 202, map[string]any{"ok": true, "running": true, "at": time.Now()})
}

func (a *App) scanStatus(w http.ResponseWriter, r *http.Request) {
	a.scanMu.Lock()
	st := a.scanState
	a.scanMu.Unlock()
	JSON(w, 200, st)
}

func (a *App) runScan(ctx context.Context) {
	var scanned, found, changed int
	err := scanner.ScanWithProgress(ctx, a.DB, a.MusicDir, func(scannedFiles int, foundTracks int, changedTracks int) {
		a.scanMu.Lock()
		a.scanState.ScannedFiles = scannedFiles
		a.scanState.FoundTracks = foundTracks
		a.scanState.Changed = changedTracks
		a.scanMu.Unlock()
		scanned = scannedFiles
		found = foundTracks
		changed = changedTracks
	})
	a.scanMu.Lock()
	defer a.scanMu.Unlock()
	a.scanState.Running = false
	a.scanState.FinishedAt = time.Now()
	a.scanState.ScannedFiles = scanned
	a.scanState.FoundTracks = found
	a.scanState.Changed = changed
	if err != nil {
		a.scanState.Error = err.Error()
	}
}
