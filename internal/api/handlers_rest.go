package api

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"musicsh/internal/store"
	"musicsh/internal/stream"
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
	_, err = a.parseUserIDFromRequest(r)
	if err != nil {
		JSONError(w, 401, "unauthorized")
		return
	}
	abs, _, err := a.DB.GetTrackForStream(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	_ = stream.ServeFileWithRange(w, r, abs)
}

func (a *App) albumCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	_, err = a.parseUserIDFromRequest(r)
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
	if err := a.DB.EnqueueJob(r.Context(), uuid.New(), "scan", "{}"); err != nil {
		JSONError(w, 500, "queue")
		return
	}
	JSON(w, 202, map[string]any{"ok": true, "queued": true, "at": time.Now()})
}
