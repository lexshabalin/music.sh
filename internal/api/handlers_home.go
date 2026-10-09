package api

import (
	"net/http"
	"strings"
	"time"
)

type homeGenreJSON struct {
	Label    string `json:"label"`
	ListenMs int64  `json:"listenMs"`
}

type homeOut struct {
	ListenMsTotalMs  int64           `json:"listenMsTotal"`
	LibraryAlbums    int64           `json:"libraryAlbums"`
	LibraryArtists   int64           `json:"libraryArtists"`
	LibraryTracks    int64           `json:"libraryTracks"`
	ListeningByGenre []homeGenreJSON `json:"listeningByGenre"`
	RecentlyPlayed   []albumOut      `json:"recentlyPlayedAlbums"`
	Period           string          `json:"period,omitempty"`
	From             string          `json:"from,omitempty"`
	To               string          `json:"to,omitempty"`
}

func parseHomeDay(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func (a *App) homeDashboard(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	ctx := r.Context()

	period := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("period")))
	fromStr := strings.TrimSpace(r.URL.Query().Get("from"))
	toStr := strings.TrimSpace(r.URL.Query().Get("to"))

	var fromDay, toDay *time.Time
	if fromStr != "" || toStr != "" || period == "day" || period == "week" || period == "month" || period == "custom" {
		if fromStr == "" || toStr == "" {
			JSONError(w, 400, "from and to required")
			return
		}
		f, ok1 := parseHomeDay(fromStr)
		t, ok2 := parseHomeDay(toStr)
		if !ok1 || !ok2 {
			JSONError(w, 400, "invalid from/to")
			return
		}
		if t.Before(f) {
			JSONError(w, 400, "to before from")
			return
		}
		// Cap custom ranges so a bad client cannot scan forever.
		if t.Sub(f) > 366*24*time.Hour {
			JSONError(w, 400, "range too large")
			return
		}
		fromDay, toDay = &f, &t
	}

	totalMs, genres, albumIDs, err := a.DB.GetHomeListeningStats(ctx, uid, fromDay, toDay)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	nAlb, nArt, nTr, err := a.DB.LibraryTotals(ctx)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	var gOut []homeGenreJSON
	for _, g := range genres {
		gOut = append(gOut, homeGenreJSON{Label: g.Label, ListenMs: g.ListenMs})
	}
	var recent []albumOut
	for _, aid := range albumIDs {
		alb, err := a.DB.GetAlbum(ctx, aid)
		if err != nil {
			continue
		}
		ao := albumOut{Album: alb}
		ao.CoverURL = a.albumCoverURLForAPI(alb)
		recent = append(recent, ao)
	}
	out := homeOut{
		ListenMsTotalMs:  totalMs,
		LibraryAlbums:    nAlb,
		LibraryArtists:   nArt,
		LibraryTracks:    nTr,
		ListeningByGenre: gOut,
		RecentlyPlayed:   recent,
	}
	if fromDay != nil && toDay != nil {
		out.Period = period
		out.From = fromDay.Format("2006-01-02")
		out.To = toDay.Format("2006-01-02")
	}
	JSON(w, 200, out)
}
