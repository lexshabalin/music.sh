package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"musicsh/internal/imprint"
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

type albumMetaJSON struct {
	Title      *string `json:"title"`
	ArtistName *string `json:"artistName"`
	Year       *int    `json:"year"`
	Clear      []string `json:"clear"`
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
	for _, c := range in.Clear {
		switch strings.ToLower(strings.TrimSpace(c)) {
		case "title":
			up.ClearTitle = true
		case "artist", "artistname":
			up.ClearArtist = true
		case "year":
			up.ClearYear = true
		case "art", "cover":
			up.ClearCover = true
		}
	}
	if up.ClearCover {
		if rel, err := a.DB.GetAlbumCoverPath(r.Context(), id); err == nil && strings.TrimSpace(rel) != "" {
			_ = os.Remove(filepath.Join(a.DataDir, rel))
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
	if al.CoverPath != nil && *al.CoverPath != "" {
		ao.CoverURL = a.coverURLFor(al.ID)
	}
	JSON(w, 200, ao)
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

	buf := make([]byte, 512)
	n, readErr := f.Read(buf)
	if readErr != nil && readErr != io.EOF {
		JSONError(w, 400, "read")
		return
	}
	if n == 0 {
		JSONError(w, 400, "empty file")
		return
	}
	ct := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(ct, "image/") {
		JSONError(w, 400, "invalid image")
		return
	}
	var ext string
	switch ct {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	default:
		JSONError(w, 400, "unsupported image type")
		return
	}

	dir := filepath.Join(a.DataDir, "covers")
	_ = os.MkdirAll(dir, 0o755)
	if rel, err := a.DB.GetAlbumCoverPath(r.Context(), id); err == nil && strings.TrimSpace(rel) != "" {
		_ = os.Remove(filepath.Join(a.DataDir, rel))
	}
	rel := filepath.Join("covers", id.String()+ext)
	abs := filepath.Join(a.DataDir, rel)
	tmp := abs + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		JSONError(w, 500, "write")
		return
	}
	if _, err = out.Write(buf[:n]); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if _, err = io.Copy(out, f); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err = out.Close(); err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err = os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err := a.DB.SetAlbumCoverUser(r.Context(), id, rel); err != nil {
		JSONError(w, 500, "db")
		return
	}
	al, err := a.DB.GetAlbum(r.Context(), id)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	ao := albumOut{Album: al}
	if al.CoverPath != nil && *al.CoverPath != "" {
		ao.CoverURL = a.coverURLFor(al.ID)
	}
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
		_ = os.Remove(filepath.Join(a.DataDir, rel))
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

type trackMetaJSON struct {
	Title           *string `json:"title"`
	ArtistName      *string `json:"artistName"`
	AlbumTitle      *string `json:"albumTitle"`
	AlbumArtistName *string `json:"albumArtistName"`
	AlbumID         *string `json:"albumId"`
	Year            *int    `json:"year"`
	TrackNo         *int    `json:"trackNo"`
	DiscNo          *int    `json:"discNo"`
	Clear           []string `json:"clear"`
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
		case "art", "cover":
			up.ClearArt = true
		}
	}
	if up.ClearArt {
		if rel, ok := a.DB.TrackArtRelPath(r.Context(), id); ok {
			_ = os.Remove(filepath.Join(a.DataDir, rel))
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
	t, err := a.DB.GetTrackByID(r.Context(), id)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, t)
}

func (a *App) stream(w http.ResponseWriter, r *http.Request) {
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
	abs, _, err := a.DB.GetTrackForStream(r.Context(), id)
	if err != nil {
		JSONError(tw, 404, "not found")
		return
	}
	// ServeFileWithRange may return nil even if the client cancels mid-stream (seek/buffer),
	// which is expected for <audio>. Only errors before headers are meaningful here.
	if err := stream.ServeFileWithRange(tw, r, abs); err != nil {
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
	abs := filepath.Join(a.DataDir, rel)
	if _, err := os.Stat(abs); err != nil {
		JSONError(w, 404, "file")
		return
	}
	ct := "image/jpeg"
	switch filepath.Ext(abs) {
	case ".png":
		ct = "image/png"
	case ".webp":
		ct = "image/webp"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=3600")
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

	buf := make([]byte, 512)
	n, readErr := f.Read(buf)
	if readErr != nil && readErr != io.EOF {
		JSONError(w, 400, "read")
		return
	}
	if n == 0 {
		JSONError(w, 400, "empty file")
		return
	}
	ct := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(ct, "image/") {
		JSONError(w, 400, "invalid image")
		return
	}
	var ext string
	switch ct {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	default:
		JSONError(w, 400, "unsupported image type")
		return
	}

	dir := filepath.Join(a.DataDir, "covers", "tracks")
	_ = os.MkdirAll(dir, 0o755)
	if rel, ok := a.DB.TrackArtRelPath(r.Context(), id); ok {
		_ = os.Remove(filepath.Join(a.DataDir, rel))
	}
	rel := filepath.Join("covers", "tracks", id.String()+ext)
	abs := filepath.Join(a.DataDir, rel)
	tmp := abs + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		JSONError(w, 500, "write")
		return
	}
	if _, err = out.Write(buf[:n]); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if _, err = io.Copy(out, f); err != nil {
		_ = out.Close()
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err = out.Close(); err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err = os.Rename(tmp, abs); err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	if err := a.DB.SetTrackArtPath(r.Context(), id, rel); err != nil {
		JSONError(w, 500, "db")
		return
	}
	t, err := a.DB.GetTrackByID(r.Context(), id)
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
		_ = os.Remove(filepath.Join(a.DataDir, rel))
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
