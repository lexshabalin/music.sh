package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"musicsh/internal/artistimage"
	"musicsh/internal/coverproc"
	"musicsh/internal/disklog"
	"musicsh/internal/genres"
	"musicsh/internal/imprint"
	"musicsh/internal/scanner"
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

func (a *App) listLibraryGenres(w http.ResponseWriter, r *http.Request) {
	limit := 500
	if s := strings.TrimSpace(r.URL.Query().Get("limit")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	list, err := a.DB.ListGenreSuggestions(r.Context(), limit)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, list)
}

func (a *App) listGenreCatalog(w http.ResponseWriter, r *http.Request) {
	limit := 500
	if s := strings.TrimSpace(r.URL.Query().Get("limit")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	list, err := a.DB.ListGenresCatalog(r.Context(), limit)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, list)
}

func (a *App) getLibraryGenre(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	lab, err := a.DB.LibraryGenreLabel(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"id": id.String(), "label": lab})
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
	ao.CoverURL = a.albumCoverURLForAPI(al)
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
		ao.CoverURL = a.albumCoverURLForAPI(al)
		out = append(out, ao)
	}
	JSON(w, 200, out)
}

func (a *App) coverURLFor(id uuid.UUID) *string {
	s := "/api/albums/" + id.String() + "/cover"
	return &s
}

// albumCoverURLForAPI sets coverUrl when a file exists or when lazy-fetch (Deezer) is allowed (cover slot not user-locked).
func (a *App) albumCoverURLForAPI(al store.Album) *string {
	hasPath := al.CoverPath != nil && strings.TrimSpace(*al.CoverPath) != ""
	locked := al.Meta != nil && al.Meta.Cover
	if !hasPath && locked {
		return nil
	}
	return a.coverURLFor(al.ID)
}

type albumMetaJSON struct {
	Title      *string `json:"title"`
	ArtistName *string `json:"artistName"`
	// Genres replaces album_genres and rolls out to tracks (null = omit; [] = clear all).
	Genres *[]string `json:"genres"`
	// Genre is deprecated: split into tags (same as genres from a joined string).
	Genre *string  `json:"genre"`
	Year  *int     `json:"year"`
	Clear []string `json:"clear"`
}

func (a *App) patchAlbumMeta(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	var in albumMetaJSON
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	up := store.AlbumMetaUpdate{
		Title:      in.Title,
		ArtistName: in.ArtistName,
		Year:       in.Year,
	}
	if in.Genres != nil {
		labs := genres.DedupePreserveOrder(*in.Genres)
		up.Genres = &labs
	} else if in.Genre != nil {
		labs := genres.Split(strings.TrimSpace(*in.Genre))
		up.Genres = &labs
	}
	for _, c := range in.Clear {
		switch strings.ToLower(strings.TrimSpace(c)) {
		case "title":
			up.ClearTitle = true
		case "artist", "artistname":
			up.ClearArtist = true
		case "year":
			up.ClearYear = true
		case "genre", "genres":
			up.ClearGenres = true
		case "art", "cover":
			up.ClearCover = true
		}
	}
	if up.ClearGenres && up.Genres != nil {
		up.ClearGenres = false
	}
	if up.ClearCover {
		if rel, err := a.DB.GetAlbumCoverPath(r.Context(), id); err == nil && strings.TrimSpace(rel) != "" {
			if abs := imprint.AbsDataPath(a.DataDir, rel); abs != "" {
				_ = os.Remove(abs)
			}
		}
	}
	if err := a.DB.UpdateAlbumMeta(r.Context(), id, up); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	al, err := a.DB.GetAlbum(r.Context(), id)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	ao := albumOut{Album: al}
	ao.CoverURL = a.albumCoverURLForAPI(al)
	JSON(w, 200, ao)
}

type coverURLRequest struct {
	CoverURL string `json:"coverUrl"`
}

func (a *App) persistAlbumCoverJPEG(ctx context.Context, id uuid.UUID, jpeg []byte) error {
	return a.persistAlbumCoverJPEGLocked(ctx, id, jpeg, true)
}

// persistAlbumCoverJPEGLocked writes JPEG to covers/{id}.jpg. If userPinned, marks meta_cover_locked (user upload);
// otherwise only sets cover_path (same as scanner / lazy Deezer) so scans can still replace art later.
func (a *App) persistAlbumCoverJPEGLocked(ctx context.Context, id uuid.UUID, jpeg []byte, userPinned bool) error {
	if len(jpeg) == 0 {
		return errors.New("empty jpeg")
	}
	dir := filepath.Join(a.DataDir, "covers")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	storeRel := "covers/" + id.String() + ".jpg"
	if cur, err := a.DB.GetAlbumCoverPath(ctx, id); err == nil && strings.TrimSpace(cur) != "" {
		if filepath.ToSlash(strings.TrimSpace(cur)) != storeRel {
			if oldAbs := imprint.AbsDataPath(a.DataDir, cur); oldAbs != "" {
				_ = os.Remove(oldAbs)
			}
		}
	}
	abs := imprint.AbsDataPath(a.DataDir, storeRel)
	if abs == "" {
		return errors.New("bad cover path")
	}
	tmp := abs + ".tmp"
	if err := os.WriteFile(tmp, jpeg, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	var dbErr error
	if userPinned {
		dbErr = a.DB.SetAlbumCoverUser(ctx, id, storeRel)
	} else {
		dbErr = a.DB.SetAlbumCoverPath(ctx, id, storeRel)
	}
	if dbErr != nil {
		return dbErr
	}
	a.propagateAlbumCoverToTracksWithoutArt(ctx, id, jpeg)
	return nil
}

// propagateAlbumCoverToTracksWithoutArt writes the same normalized JPEG onto every album track that
// has no saved per-track cover yet so /api/tracks/{id}/cover and track coverUrl behave like the album artwork.
func (a *App) propagateAlbumCoverToTracksWithoutArt(ctx context.Context, albumID uuid.UUID, jpeg []byte) {
	if len(jpeg) == 0 {
		return
	}
	ids, err := a.DB.ListAlbumTrackIDsWithoutStoredArt(ctx, albumID)
	if err != nil || len(ids) == 0 {
		if err != nil {
			log.Printf("propagate album cover: list tracks album=%s: %v", albumID, err)
		}
		return
	}
	for _, tid := range ids {
		if err := a.persistTrackCoverJPEG(ctx, tid, jpeg); err != nil {
			log.Printf("propagate album cover: track=%s album=%s: %v", tid, albumID, err)
		}
	}
}

func (a *App) persistTrackCoverJPEG(ctx context.Context, id uuid.UUID, jpeg []byte) error {
	if len(jpeg) == 0 {
		return errors.New("empty jpeg")
	}
	dir := filepath.Join(a.DataDir, "covers", "tracks")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	storeRel := "covers/tracks/" + id.String() + ".jpg"
	if oldRel, ok := a.DB.TrackArtRelPath(ctx, id); ok && strings.TrimSpace(oldRel) != "" {
		if filepath.ToSlash(strings.TrimSpace(oldRel)) != storeRel {
			if oldAbs := imprint.AbsDataPath(a.DataDir, oldRel); oldAbs != "" {
				_ = os.Remove(oldAbs)
			}
		}
	}
	abs := imprint.AbsDataPath(a.DataDir, storeRel)
	if abs == "" {
		return errors.New("bad cover path")
	}
	tmp := abs + ".tmp"
	if err := os.WriteFile(tmp, jpeg, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return a.DB.SetTrackArtPath(ctx, id, storeRel)
}

func (a *App) inheritAlbumCoverOntoTrack(ctx context.Context, trackID, albumID uuid.UUID) {
	relAl, err := a.DB.GetAlbumCoverPath(ctx, albumID)
	if err != nil || strings.TrimSpace(relAl) == "" {
		return
	}
	absAl := imprint.AbsDataPath(a.DataDir, relAl)
	if absAl == "" {
		return
	}
	raw, err := os.ReadFile(absAl)
	if err != nil || len(raw) == 0 {
		return
	}
	jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
	if err != nil {
		return
	}
	_ = a.persistTrackCoverJPEG(ctx, trackID, jpeg)
}

func (a *App) uploadAlbumCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if _, err := a.DB.GetAlbum(r.Context(), id); err != nil {
		JSONError(w, 404, "not found")
		return
	}
	ctx := r.Context()

	ctype := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	if strings.HasPrefix(ctype, "application/json") {
		var body coverURLRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			JSONError(w, 400, "json")
			return
		}
		raw, err := coverproc.FetchImageURL(ctx, body.CoverURL)
		if err != nil {
			switch {
			case errors.Is(err, coverproc.ErrCoverURL), errors.Is(err, coverproc.ErrCoverHost):
				JSONError(w, 400, "bad url")
			default:
				JSONError(w, 502, "fetch")
			}
			return
		}
		jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
		if err != nil {
			JSONError(w, 400, "image")
			return
		}
		if err := a.persistAlbumCoverJPEG(ctx, id, jpeg); err != nil {
			JSONError(w, 500, "write")
			return
		}
		a.jsonAlbumCoverOut(w, ctx, id)
		return
	}

	if err := r.ParseMultipartForm(8 << 20); err != nil {
		JSONError(w, 400, "bad multipart")
		return
	}
	f, _, err := r.FormFile("cover")
	if err != nil {
		f, _, err = r.FormFile("art")
	}
	if err != nil {
		JSONError(w, 400, "image required")
		return
	}
	defer f.Close()

	raw, err := io.ReadAll(io.LimitReader(f, 22<<20))
	if err != nil || len(raw) == 0 {
		JSONError(w, 400, "empty file")
		return
	}
	jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
	if err != nil {
		JSONError(w, 400, "invalid image")
		return
	}
	if err := a.persistAlbumCoverJPEG(ctx, id, jpeg); err != nil {
		JSONError(w, 500, "write")
		return
	}
	a.jsonAlbumCoverOut(w, ctx, id)
}

func (a *App) jsonAlbumCoverOut(w http.ResponseWriter, ctx context.Context, albumID uuid.UUID) {
	al, err := a.DB.GetAlbum(ctx, albumID)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	ao := albumOut{Album: al}
	ao.CoverURL = a.albumCoverURLForAPI(al)
	JSON(w, 200, ao)
}

func (a *App) deleteAlbumCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if _, err := a.DB.GetAlbum(r.Context(), id); err != nil {
		JSONError(w, 404, "not found")
		return
	}
	if rel, err := a.DB.GetAlbumCoverPath(r.Context(), id); err == nil && strings.TrimSpace(rel) != "" {
		if abs := imprint.AbsDataPath(a.DataDir, rel); abs != "" {
			_ = os.Remove(abs)
		}
	}
	if err := a.DB.ClearAlbumCover(r.Context(), id); err != nil {
		JSONError(w, 500, "db")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) listTracks(w http.ResponseWriter, r *http.Request) {
	// Ordered batch fetch for playback restore: /api/tracks?ids=id1,id2,...
	if idsStr := strings.TrimSpace(r.URL.Query().Get("ids")); idsStr != "" {
		parts := strings.Split(idsStr, ",")
		var ids []uuid.UUID
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			u, err := uuid.Parse(p)
			if err != nil {
				JSONError(w, 400, "invalid id in ids")
				return
			}
			ids = append(ids, u)
		}
		if len(ids) == 0 {
			JSON(w, 200, []store.Track{})
			return
		}
		if len(ids) > 5000 {
			JSONError(w, 400, "too many ids")
			return
		}
		m, err := a.DB.ListTracksByIds(r.Context(), ids)
		if err != nil {
			JSONError(w, 500, "db")
			return
		}
		out := make([]store.Track, 0, len(ids))
		for _, id := range ids {
			if t, ok := m[id]; ok {
				out = append(out, t)
			}
		}
		JSON(w, 200, out)
		return
	}
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
	var genreID *uuid.UUID
	if s := strings.TrimSpace(r.URL.Query().Get("genreId")); s != "" {
		u, err := uuid.Parse(s)
		if err != nil {
			JSONError(w, 400, "bad genreId")
			return
		}
		genreID = &u
	}

	if strings.TrimSpace(r.URL.Query().Get("only")) == "ids" {
		ids, err := a.DB.ListTrackIDs(r.Context(), q, albumID, artistID, genreID)
		if err != nil {
			JSONError(w, 500, "db")
			return
		}
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			out = append(out, id.String())
		}
		JSON(w, 200, map[string]any{"trackIds": out})
		return
	}

	limit := 0
	offset := 0
	if s := strings.TrimSpace(r.URL.Query().Get("limit")); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			JSONError(w, 400, "bad limit")
			return
		}
		if n > 10000 {
			n = 10000
		}
		limit = n
	}
	if s := strings.TrimSpace(r.URL.Query().Get("offset")); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			JSONError(w, 400, "bad offset")
			return
		}
		offset = n
	}
	if limit == 0 && offset > 0 {
		JSONError(w, 400, "offset requires limit")
		return
	}

	sortBy := strings.TrimSpace(r.URL.Query().Get("sort"))
	sortDir := strings.TrimSpace(r.URL.Query().Get("dir"))
	list, err := a.DB.ListTracks(r.Context(), q, albumID, artistID, genreID, limit, offset, sortBy, sortDir)
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

type trackMetaJSON struct {
	Title           *string   `json:"title"`
	ArtistName      *string   `json:"artistName"`
	AlbumTitle      *string   `json:"albumTitle"`
	AlbumArtistName *string   `json:"albumArtistName"`
	AlbumID         *string   `json:"albumId"`
	Year            *int      `json:"year"`
	TrackNo         *int      `json:"trackNo"`
	DiscNo          *int      `json:"discNo"`
	Genres          *[]string `json:"genres"`
	Genre           *string   `json:"genre"`
	Clear           []string  `json:"clear"`
}

func (a *App) patchTrackMeta(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	var in trackMetaJSON
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	up := store.TrackMetaUpdate{
		Title:           in.Title,
		ArtistName:      in.ArtistName,
		AlbumTitle:      in.AlbumTitle,
		AlbumArtistName: in.AlbumArtistName,
		Year:            in.Year,
		TrackNo:         in.TrackNo,
		DiscNo:          in.DiscNo,
	}
	if in.Genres != nil {
		labs := genres.DedupePreserveOrder(*in.Genres)
		up.Genres = &labs
	} else if in.Genre != nil {
		labs := genres.Split(strings.TrimSpace(*in.Genre))
		up.Genres = &labs
	}
	if in.AlbumID != nil && strings.TrimSpace(*in.AlbumID) != "" {
		aid, err := uuid.Parse(strings.TrimSpace(*in.AlbumID))
		if err != nil {
			JSONError(w, 400, "bad albumId")
			return
		}
		up.AlbumID = &aid
	}
	for _, c := range in.Clear {
		switch strings.ToLower(strings.TrimSpace(c)) {
		case "title":
			up.ClearTitle = true
		case "artist", "artistname":
			up.ClearArtist = true
		case "album", "albumtitle":
			up.ClearAlbum = true
		case "year":
			up.ClearYear = true
		case "trackno", "track":
			up.ClearTrackNo = true
		case "discno", "disc":
			up.ClearDiscNo = true
		case "genre", "genres":
			up.ClearGenres = true
		case "art", "cover":
			up.ClearArt = true
		}
	}
	if up.ClearGenres && up.Genres != nil {
		up.ClearGenres = false
	}
	if up.ClearArt {
		if rel, ok := a.DB.TrackArtRelPath(r.Context(), id); ok {
			if abs := imprint.AbsDataPath(a.DataDir, rel); abs != "" {
				_ = os.Remove(abs)
			}
		}
	}
	if err := a.DB.UpdateTrackMeta(r.Context(), id, up); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		if errors.Is(err, store.ErrAlbumNotForArtist) {
			JSONError(w, 400, "album does not match artist")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	if up.AlbumID != nil && !up.ClearArt {
		a.inheritAlbumCoverOntoTrack(r.Context(), id, *up.AlbumID)
	}
	t, err := a.DB.GetTrackByID(r.Context(), id)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, t)
}

func (a *App) stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	tw := &trackWriteState{ResponseWriter: w}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(tw, 400, "id")
		return
	}
	_, err = a.parseUserIDFromMediaRequest(r)
	if err != nil {
		JSONError(tw, 401, "unauthorized")
		return
	}
	abs, _, format, err := a.DB.GetTrackForStream(r.Context(), id)
	if err != nil {
		JSONError(tw, 404, "not found")
		return
	}
	disklog.Printf("stream_request track=%s path=%q method=%s", id, abs, r.Method)
	// ServePlayback may return nil even if the client cancels mid-stream (seek/buffer),
	// which is expected for <audio>. Only errors before headers are meaningful here.
	if err := stream.ServePlayback(tw, r, abs, format); err != nil {
		// If headers/body already started, do NOT write JSON (it would corrupt the media stream).
		if tw.wroteHeader {
			return
		}
		JSONError(tw, 404, "stream failed")
	}
}

type trackWriteState struct {
	http.ResponseWriter
	wroteHeader bool
}

func (t *trackWriteState) WriteHeader(statusCode int) {
	t.wroteHeader = true
	t.ResponseWriter.WriteHeader(statusCode)
}

func (t *trackWriteState) Write(p []byte) (int, error) {
	t.wroteHeader = true
	return t.ResponseWriter.Write(p)
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
	ctx := r.Context()
	al, err := a.DB.GetAlbum(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}

	rel := ""
	if al.CoverPath != nil {
		rel = strings.TrimSpace(*al.CoverPath)
	}
	if rel != "" {
		abs := imprint.AbsDataPath(a.DataDir, rel)
		if abs != "" {
			if fi, stErr := os.Stat(abs); stErr == nil && fi.Size() > 0 {
				a.serveAlbumCoverFile(w, r, abs)
				return
			}
		}
	}

	locked := al.Meta != nil && al.Meta.Cover
	if locked {
		JSONError(w, 404, "no cover")
		return
	}

	if r.Method == http.MethodHead {
		JSONError(w, 404, "no cover")
		return
	}

	absReady, err := a.ensureAlbumCoverDeezer(ctx, id)
	if err != nil {
		if errors.Is(err, artistimage.ErrNotFound) {
			JSONError(w, 404, "no cover")
			return
		}
		log.Printf("album cover lazy fetch album=%s: %v", id, err)
		JSONError(w, 502, "fetch")
		return
	}
	a.serveAlbumCoverFile(w, r, absReady)
}

func (a *App) serveAlbumCoverFile(w http.ResponseWriter, r *http.Request, abs string) {
	disklog.Printf("cover_album_serve path=%q method=%s", abs, r.Method)
	if r.Method == http.MethodHead {
		fi, err := os.Stat(abs)
		if err != nil {
			JSONError(w, 404, "file")
			return
		}
		a.setAlbumCoverResponseHeaders(w, abs)
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
		w.WriteHeader(http.StatusOK)
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		JSONError(w, 404, "file")
		return
	}
	_ = f.Close()
	a.setAlbumCoverResponseHeaders(w, abs)
	http.ServeFile(w, r, abs)
}

func (a *App) ensureAlbumCoverDeezer(ctx context.Context, albumID uuid.UUID) (string, error) {
	storeRel := "covers/" + albumID.String() + ".jpg"

	v, err, _ := a.albumCoverSf.Do(albumID.String(), func() (interface{}, error) {
		cur, err := a.DB.GetAlbum(ctx, albumID)
		if err != nil {
			return "", err
		}
		rel := ""
		if cur.CoverPath != nil {
			rel = strings.TrimSpace(*cur.CoverPath)
		}
		if rel != "" {
			p := imprint.AbsDataPath(a.DataDir, rel)
			if p != "" {
				if fi, e := os.Stat(p); e == nil && fi.Size() > 0 {
					return p, nil
				}
			}
		}
		artist := ""
		if cur.ArtistName != nil {
			artist = strings.TrimSpace(*cur.ArtistName)
		}
		title := strings.TrimSpace(cur.Title)
		pic, err := artistimage.DeezerAlbumCoverURL(ctx, artist, title, cur.Year)
		if err != nil {
			return "", err
		}
		raw, err := coverproc.FetchImageURL(ctx, pic)
		if err != nil {
			return "", err
		}
		jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
		if err != nil {
			return "", err
		}
		if err := a.persistAlbumCoverJPEGLocked(ctx, albumID, jpeg, false); err != nil {
			return "", err
		}
		outAbs := imprint.AbsDataPath(a.DataDir, storeRel)
		if outAbs == "" {
			return "", errors.New("bad cover path")
		}
		return outAbs, nil
	})
	if err != nil {
		return "", err
	}
	abs, _ := v.(string)
	return abs, nil
}

func (*App) setAlbumCoverResponseHeaders(w http.ResponseWriter, abs string) {
	ext := filepath.Ext(abs)
	ct := "image/jpeg"
	switch ext {
	case ".png":
		ct = "image/png"
	case ".webp":
		ct = "image/webp"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=3600")
}

func (a *App) trackCover(w http.ResponseWriter, r *http.Request) {
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
	rel, ok := a.DB.TrackArtRelPath(r.Context(), id)
	if !ok {
		JSONError(w, 404, "no cover")
		return
	}
	abs := imprint.AbsDataPath(a.DataDir, rel)
	if abs == "" {
		JSONError(w, 404, "file")
		return
	}
	fi, err := os.Stat(abs)
	if err != nil {
		JSONError(w, 404, "file")
		return
	}
	disklog.Printf("cover_track_serve path=%q method=%s size=%d", abs, r.Method, fi.Size())
	ct := "image/jpeg"
	switch filepath.Ext(abs) {
	case ".png":
		ct = "image/png"
	case ".webp":
		ct = "image/webp"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
		w.WriteHeader(http.StatusOK)
		return
	}
	http.ServeFile(w, r, abs)
}

func (a *App) uploadTrackCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if _, err := a.DB.GetTrackByID(r.Context(), id); err != nil {
		JSONError(w, 404, "not found")
		return
	}
	ctx := r.Context()
	ctype := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	if strings.HasPrefix(ctype, "application/json") {
		var body coverURLRequest
		dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil {
			JSONError(w, 400, "json")
			return
		}
		raw, err := coverproc.FetchImageURL(ctx, body.CoverURL)
		if err != nil {
			switch {
			case errors.Is(err, coverproc.ErrCoverURL), errors.Is(err, coverproc.ErrCoverHost):
				JSONError(w, 400, "bad url")
			default:
				JSONError(w, 502, "fetch")
			}
			return
		}
		jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
		if err != nil {
			JSONError(w, 400, "image")
			return
		}
		if err := a.persistTrackCoverJPEG(ctx, id, jpeg); err != nil {
			JSONError(w, 500, "write")
			return
		}
		a.jsonTrackOut(w, ctx, id)
		return
	}

	if err := r.ParseMultipartForm(8 << 20); err != nil {
		JSONError(w, 400, "bad multipart")
		return
	}
	f, _, err := r.FormFile("art")
	if err != nil {
		f, _, err = r.FormFile("cover")
	}
	if err != nil {
		JSONError(w, 400, "image required")
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 22<<20))
	if err != nil || len(raw) == 0 {
		JSONError(w, 400, "empty file")
		return
	}
	jpeg, err := coverproc.NormalizeAlbumCoverFromBytes(raw)
	if err != nil {
		JSONError(w, 400, "invalid image")
		return
	}
	if err := a.persistTrackCoverJPEG(ctx, id, jpeg); err != nil {
		JSONError(w, 500, "write")
		return
	}
	a.jsonTrackOut(w, ctx, id)
}

func (a *App) jsonTrackOut(w http.ResponseWriter, ctx context.Context, trackID uuid.UUID) {
	t, err := a.DB.GetTrackByID(ctx, trackID)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, t)
}

func (a *App) deleteTrackCover(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if rel, ok := a.DB.TrackArtRelPath(r.Context(), id); ok {
		if abs := imprint.AbsDataPath(a.DataDir, rel); abs != "" {
			_ = os.Remove(abs)
		}
	}
	if err := a.DB.ClearTrackArtPath(r.Context(), id); err != nil {
		JSONError(w, 500, "db")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type imprintApplyIn struct {
	Confirm bool `json:"confirm"`
	Tracks  []struct {
		TrackID string   `json:"trackId"`
		Fields  []string `json:"fields"`
		// Optional per-field overrides for imprint apply (library metadata is the default).
		Overrides *struct {
			Title       *string `json:"title,omitempty"`
			Artist      *string `json:"artist,omitempty"`
			Album       *string `json:"album,omitempty"`
			AlbumArtist *string `json:"albumArtist,omitempty"`
			Genre       *string `json:"genre,omitempty"`
			Composer    *string `json:"composer,omitempty"`
			Comment     *string `json:"comment,omitempty"`
			Year        *int    `json:"year,omitempty"`
			TrackNo     *int    `json:"trackNo,omitempty"`
			DiscNo      *int    `json:"discNo,omitempty"`
		} `json:"overrides,omitempty"`
	} `json:"tracks"`
}

func (a *App) albumImprintDryRun(w http.ResponseWriter, r *http.Request) {
	albumID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	rows, err := a.DB.GetAlbumTracksForImprint(r.Context(), albumID)
	if err != nil {
		log.Printf("imprint dry-run: GetAlbumTracksForImprint(album=%s): %v", albumID, err)
		JSONError(w, 500, "db")
		return
	}
	var targets []imprint.TrackTarget
	for _, tr := range rows {
		targets = append(targets, imprint.TrackTarget{
			TrackID:      tr.TrackID,
			FilePath:     tr.FilePath,
			Format:       tr.Format,
			Title:        tr.Title,
			Artist:       tr.ArtistName,
			Album:        tr.AlbumTitle,
			AlbumArtist:  tr.AlbumArtist,
			Genre:        tr.Genre,
			Composer:     tr.Composer,
			Comment:      tr.Comment,
			Year:         tr.Year,
			TrackNo:      tr.TrackNo,
			DiscNo:       tr.DiscNo,
			CoverRelPath: tr.CoverRelPath,
		})
	}
	dr, err := imprint.DryRunAlbum(targets, a.DataDir)
	if err != nil {
		JSONError(w, 500, "imprint")
		return
	}
	dr.AlbumID = albumID
	if rel, err := a.DB.GetAlbumCoverPath(r.Context(), albumID); err == nil && strings.TrimSpace(rel) != "" {
		if abs := imprint.AbsDataPath(a.DataDir, rel); abs != "" {
			if st, err := os.Stat(abs); err == nil && st.Size() > 0 {
				dr.AlbumHasStoredCover = true
			}
		}
	}
	JSON(w, 200, dr)
}

func (a *App) albumImprintApply(w http.ResponseWriter, r *http.Request) {
	albumID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	var in imprintApplyIn
	if err := ReadJSON(r, &in); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	if !in.Confirm {
		JSONError(w, 400, "confirm required")
		return
	}
	// Build selection map: trackId -> field -> bool
	sel := map[string]map[imprint.Field]bool{}
	for _, t := range in.Tracks {
		tid := strings.TrimSpace(t.TrackID)
		if tid == "" {
			continue
		}
		m := sel[tid]
		if m == nil {
			m = map[imprint.Field]bool{}
			sel[tid] = m
		}
		for _, f := range t.Fields {
			switch strings.ToLower(strings.TrimSpace(f)) {
			case "title":
				m[imprint.FieldTitle] = true
			case "artist", "artistname":
				m[imprint.FieldArtist] = true
			case "album", "albumtitle":
				m[imprint.FieldAlbum] = true
			case "albumartist", "album_artist":
				m[imprint.FieldAlbumArtist] = true
			case "genre":
				m[imprint.FieldGenre] = true
			case "composer":
				m[imprint.FieldComposer] = true
			case "comment":
				m[imprint.FieldComment] = true
			case "year":
				m[imprint.FieldYear] = true
			case "trackno", "track":
				m[imprint.FieldTrackNo] = true
			case "discno", "disc":
				m[imprint.FieldDiscNo] = true
			case "cover", "art":
				m[imprint.FieldCover] = true
			}
		}
	}

	rows, err := a.DB.GetAlbumTracksForImprint(r.Context(), albumID)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	_ = rows

	jobID := uuid.New()
	payload := map[string]any{
		"albumId": albumID.String(),
		"tracks":  in.Tracks,
	}
	b, _ := json.Marshal(payload)
	if err := a.DB.EnqueueJob(r.Context(), jobID, string(store.JobImprintTags), string(b)); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 202, map[string]any{"jobId": jobID.String()})
}

func (a *App) getJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	st, err := a.DB.GetJobStatus(r.Context(), id)
	if err != nil {
		JSONError(w, 404, "not found")
		return
	}
	out := map[string]any{
		"id":        st.ID.String(),
		"type":      st.Type,
		"status":    st.Status,
		"attempts":  st.Attempts,
		"createdAt": st.CreatedAt,
	}
	if st.LastError != nil {
		out["lastError"] = *st.LastError
	}
	if st.ProgressDone != nil {
		out["progressDone"] = *st.ProgressDone
	}
	if st.ProgressTotal != nil {
		out["progressTotal"] = *st.ProgressTotal
	}
	if st.ProgressMsg != nil {
		out["progressMsg"] = *st.ProgressMsg
	}
	if st.ResultJSON != nil {
		var j any
		_ = json.Unmarshal([]byte(*st.ResultJSON), &j)
		out["result"] = j
	}
	JSON(w, 200, out)
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
	a.scanState = scanState{Running: true, StartedAt: time.Now(), Error: ""}
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

type trackFileCheckIn struct {
	IDs []string `json:"ids"`
}

func (a *App) postTracksFileCheck(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromCtx(r.Context()); !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	var in trackFileCheckIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	const maxIDs = 800
	raw := in.IDs
	if len(raw) > maxIDs {
		raw = raw[:maxIDs]
	}
	seen := make(map[uuid.UUID]struct{})
	var uuids []uuid.UUID
	for _, s := range raw {
		u, err := uuid.Parse(strings.TrimSpace(s))
		if err != nil {
			continue
		}
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		uuids = append(uuids, u)
	}
	if len(uuids) == 0 {
		JSON(w, 200, map[string]any{"missingIds": []string{}})
		return
	}
	list, err := a.DB.ListTracksMissingFiles(r.Context(), a.MusicDir, uuids)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	out := make([]string, len(list))
	for i, u := range list {
		out[i] = u.String()
	}
	JSON(w, 200, map[string]any{"missingIds": out})
}

func (a *App) libraryReconcileFiles(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromCtx(r.Context()); !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	n, err := a.DB.DeleteTracksWithMissingFiles(r.Context(), a.MusicDir)
	if err != nil {
		JSONError(w, 500, "reconcile failed")
		return
	}
	_ = a.DB.AfterLibraryEntityDelete(r.Context())
	JSON(w, 200, map[string]any{"removed": int(n)})
}

func (a *App) deleteLibraryTrackRecord(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromCtx(r.Context()); !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if err := a.DB.DeleteLibraryTrack(r.Context(), id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	_ = a.DB.AfterLibraryEntityDelete(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) deleteLibraryAlbumRecord(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromCtx(r.Context()); !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if err := a.DB.DeleteLibraryAlbum(r.Context(), id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	_ = a.DB.AfterLibraryEntityDelete(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) deleteLibraryArtistRecord(w http.ResponseWriter, r *http.Request) {
	if _, ok := userIDFromCtx(r.Context()); !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		JSONError(w, 400, "id")
		return
	}
	if err := a.DB.DeleteLibraryArtist(r.Context(), id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			JSONError(w, 404, "not found")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	_ = a.DB.AfterLibraryEntityDelete(r.Context())
	w.WriteHeader(http.StatusNoContent)
}
