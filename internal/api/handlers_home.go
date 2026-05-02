package api

import (
	"net/http"
)

type homeGenreJSON struct {
	Label    string `json:"label"`
	ListenMs int64  `json:"listenMs"`
}

type homeOut struct {
	ListenMsTotalMs  int64            `json:"listenMsTotal"`
	LibraryAlbums    int64            `json:"libraryAlbums"`
	LibraryArtists   int64            `json:"libraryArtists"`
	LibraryTracks    int64            `json:"libraryTracks"`
	ListeningByGenre []homeGenreJSON  `json:"listeningByGenre"`
	RecentlyPlayed   []albumOut       `json:"recentlyPlayedAlbums"`
}

func (a *App) homeDashboard(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	ctx := r.Context()

	totalMs, genres, albumIDs, err := a.DB.GetHomeListeningStats(ctx, uid)
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
	JSON(w, 200, homeOut{
		ListenMsTotalMs: totalMs,
		LibraryAlbums:   nAlb,
		LibraryArtists: nArt,
		LibraryTracks:   nTr,
		ListeningByGenre: gOut,
		RecentlyPlayed: recent,
	})
}
