package api

import (
	"net/http"
	"strings"
	"time"
)

type statsArtistJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ListenMs int64  `json:"listenMs"`
}

type statsOut struct {
	ListenMsTotalMs   int64             `json:"listenMsTotal"`
	ListeningByGenre  []homeGenreJSON   `json:"listeningByGenre"`
	ListeningByArtist []statsArtistJSON `json:"listeningByArtist"`
	Period            string            `json:"period"`
	From              string            `json:"from"`
	To                string            `json:"to"`
}

func (a *App) statsDashboard(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	ctx := r.Context()

	period := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("period")))
	fromStr := strings.TrimSpace(r.URL.Query().Get("from"))
	toStr := strings.TrimSpace(r.URL.Query().Get("to"))
	if period == "" {
		period = "week"
	}
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
	if t.Sub(f) > 366*24*time.Hour {
		JSONError(w, 400, "range too large")
		return
	}

	totalMs, genres, artists, err := a.DB.GetStatsListening(ctx, uid, f, t)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	gOut := make([]homeGenreJSON, 0, len(genres))
	for _, g := range genres {
		gOut = append(gOut, homeGenreJSON{Label: g.Label, ListenMs: g.ListenMs})
	}
	aOut := make([]statsArtistJSON, 0, len(artists))
	for _, ar := range artists {
		aOut = append(aOut, statsArtistJSON{ID: ar.ID.String(), Name: ar.Name, ListenMs: ar.ListenMs})
	}
	JSON(w, 200, statsOut{
		ListenMsTotalMs:   totalMs,
		ListeningByGenre:  gOut,
		ListeningByArtist: aOut,
		Period:            period,
		From:              f.Format("2006-01-02"),
		To:                t.Format("2006-01-02"),
	})
}
