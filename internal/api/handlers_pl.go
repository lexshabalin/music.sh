package api

import (
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"musicsh/internal/store"
)

type plCreate struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}
type plPatch struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}
type plAddTrack struct {
	TrackID uuid.UUID `json:"trackId"`
}

func (a *App) listPl(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	list, err := a.DB.ListPlaylists(r.Context(), uid)
	if err != nil {
		log.Printf("list playlists db error: %v", err)
		JSONError(w, 500, "db: "+err.Error())
		return
	}
	JSON(w, 200, list)
}

func (a *App) createPl(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b plCreate
	if err := ReadJSON(r, &b); err != nil || b.Name == "" {
		JSONError(w, 400, "name required")
		return
	}
	p, err := a.DB.CreatePlaylist(r.Context(), uuid.New(), uid, b.Name, b.Description)
	if err != nil {
		log.Printf("create playlist db error: %v", err)
		JSONError(w, 500, "db: "+err.Error())
		return
	}
	JSON(w, 201, p)
}

func (a *App) getPl(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	p, tr, err := a.DB.GetPlaylist(r.Context(), uid, id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	JSON(w, 200, store.PlaylistWithTracks{Playlist: p, Tracks: tr})
}

func (a *App) patchPl(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	var b plPatch
	_ = ReadJSON(r, &b)
	if err := a.DB.UpdatePlaylist(r.Context(), uid, id, b.Name, b.Description); err != nil {
		log.Printf("patch playlist db error: %v", err)
		JSONError(w, 400, "update: "+err.Error())
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}

func (a *App) deletePl(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if err := a.DB.DeletePlaylist(r.Context(), uid, id); err != nil {
		log.Printf("delete playlist db error: %v", err)
		JSONError(w, 500, "db: "+err.Error())
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}

func (a *App) addPlTrack(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	pl, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	var b plAddTrack
	if err = ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "json")
		return
	}
	if err = a.DB.AddToPlaylist(r.Context(), uid, pl, b.TrackID); err != nil {
		JSONError(w, 400, err.Error())
		return
	}
	JSON(w, 201, map[string]any{"ok": true})
}

func (a *App) removePlTrack(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	pl, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	tid, err := uuid.Parse(chi.URLParam(r, "trackId"))
	if err != nil {
		JSONError(w, 400, "trackId")
		return
	}
	if err = a.DB.RemoveFromPlaylist(r.Context(), uid, pl, tid); err != nil {
		JSONError(w, 400, "not found")
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}

// likes

type likeBody struct {
	TrackID uuid.UUID `json:"trackId"`
}

func (a *App) listLikes(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	ids, err := a.DB.ListLikes(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"trackIds": ids})
}

func (a *App) addLike(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b likeBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "json")
		return
	}
	if b.TrackID == uuid.Nil {
		JSONError(w, 400, "trackId")
		return
	}
	if err := a.DB.SetLike(r.Context(), uid, b.TrackID, true); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}

func (a *App) removeLike(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	tid, err := uuid.Parse(chi.URLParam(r, "trackId"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if err := a.DB.SetLike(r.Context(), uid, tid, false); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}
