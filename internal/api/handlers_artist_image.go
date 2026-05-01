package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"musicsh/internal/artistimage"
	"musicsh/internal/coverproc"
	"musicsh/internal/imprint"
)

func artistImageStoreRel(id uuid.UUID) string {
	return "covers/artists/" + id.String() + ".jpg"
}

func (a *App) artistImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if _, err := a.parseUserIDFromMediaRequest(r); err != nil {
		JSONError(w, 401, "unauthorized")
		return
	}

	artist, err := a.DB.GetArtist(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}

	storeRel := artistImageStoreRel(id)
	abs := imprint.AbsDataPath(a.DataDir, storeRel)
	if abs == "" {
		JSONError(w, 500, "path")
		return
	}

	if fi, err := os.Stat(abs); err == nil && fi.Size() > 0 {
		a.serveArtistImageFile(w, r, abs)
		return
	}

	if r.Method == http.MethodHead {
		JSONError(w, 404, "no image")
		return
	}

	absReady, err := a.ensureArtistImageFile(r.Context(), id, artist.Name, abs)
	if err != nil {
		if errors.Is(err, artistimage.ErrNotFound) {
			JSONError(w, 404, "no image")
			return
		}
		log.Printf("artist image fetch artist=%s: %v", id, err)
		JSONError(w, 502, "fetch")
		return
	}
	a.serveArtistImageFile(w, r, absReady)
}

func (a *App) serveArtistImageFile(w http.ResponseWriter, r *http.Request, abs string) {
	fi, err := os.Stat(abs)
	if err != nil {
		JSONError(w, 404, "file")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
		w.WriteHeader(http.StatusOK)
		return
	}
	http.ServeFile(w, r, abs)
}

func (a *App) ensureArtistImageFile(ctx context.Context, id uuid.UUID, name, abs string) (string, error) {
	v, err, _ := a.artistImgSf.Do(id.String(), func() (interface{}, error) {
		if fi, e := os.Stat(abs); e == nil && fi.Size() > 0 {
			return abs, nil
		}
		picURL, err := artistimage.DeezerPictureURL(ctx, name)
		if err != nil {
			return "", err
		}
		raw, err := coverproc.FetchImageURL(ctx, picURL)
		if err != nil {
			return "", err
		}
		jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
		if err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return "", err
		}
		tmp := abs + ".tmp"
		if err := os.WriteFile(tmp, jpeg, 0o644); err != nil {
			return "", err
		}
		if err := os.Rename(tmp, abs); err != nil {
			_ = os.Remove(tmp)
			return "", err
		}
		return abs, nil
	})
	if err != nil {
		return "", err
	}
	out, _ := v.(string)
	return out, nil
}
