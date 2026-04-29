package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

)

const maxPlaybackQueueTracks = 5000

type playbackOut struct {
	TrackIDs         []string `json:"trackIds"`
	CurrentIndex     int      `json:"currentIndex"`
	PositionMs       int      `json:"positionMs"`
	IsPlaying        bool     `json:"isPlaying"`
	ClientID         string   `json:"clientId,omitempty"`
	SourcePlaylistID *string  `json:"sourcePlaylistId,omitempty"`
	UpdatedAt        string   `json:"updatedAt"`
}

type playbackIn struct {
	TrackIDs         []string `json:"trackIds"`
	CurrentIndex     int      `json:"currentIndex"`
	PositionMs       int      `json:"positionMs"`
	IsPlaying        bool     `json:"isPlaying"`
	ClientID         *string  `json:"clientId,omitempty"`
	ForceTakeover    bool     `json:"forceTakeover,omitempty"`
	SourcePlaylistID *string  `json:"sourcePlaylistId,omitempty"`
}

func (a *App) getPlayback(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	st, err := a.DB.GetUserPlayback(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	out := playbackOut{
		CurrentIndex: st.CurrentIndex,
		PositionMs:   st.PositionMs,
		IsPlaying:    st.IsPlaying,
		ClientID:     st.PlaybackClientID,
		UpdatedAt:    st.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	for _, id := range st.TrackIDs {
		out.TrackIDs = append(out.TrackIDs, id.String())
	}
	if st.SourcePlaylistID != nil {
		s := st.SourcePlaylistID.String()
		out.SourcePlaylistID = &s
	}
	JSON(w, 200, out)
}

func (a *App) putPlayback(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	var in playbackIn
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	if len(in.TrackIDs) > maxPlaybackQueueTracks {
		JSONError(w, 400, "queue too large")
		return
	}
	var ids []uuid.UUID
	for _, s := range in.TrackIDs {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		u, err := uuid.Parse(s)
		if err != nil {
			JSONError(w, 400, "invalid track id")
			return
		}
		ids = append(ids, u)
	}
	idx := in.CurrentIndex
	if len(ids) == 0 {
		idx = 0
	} else {
		if idx < 0 || idx >= len(ids) {
			JSONError(w, 400, "invalid index")
			return
		}
	}
	if in.PositionMs < 0 {
		JSONError(w, 400, "invalid position")
		return
	}
	var srcPl *uuid.UUID
	if in.SourcePlaylistID != nil && strings.TrimSpace(*in.SourcePlaylistID) != "" {
		u, err := uuid.Parse(strings.TrimSpace(*in.SourcePlaylistID))
		if err != nil {
			JSONError(w, 400, "invalid playlist id")
			return
		}
		srcPl = &u
	}
	cid := ""
	if in.ClientID != nil {
		cid = strings.TrimSpace(*in.ClientID)
	}
	if len(cid) > 128 {
		JSONError(w, 400, "client id too long")
		return
	}

	cur, err := a.DB.GetUserPlayback(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	// Another device/session owns active playback. Allow explicit user takeover,
	// but keep rejecting passive stale heartbeats.
	if in.IsPlaying && cid != "" && cur.IsPlaying && cur.PlaybackClientID != "" && cur.PlaybackClientID != cid && !in.ForceTakeover {
		JSONError(w, 409, "playback busy elsewhere")
		return
	}

	var stoppedAt *time.Time
	if in.IsPlaying {
		stoppedAt = nil
	} else {
		switch {
		case cur.IsPlaying:
			t := time.Now().UTC()
			stoppedAt = &t
		case cur.StoppedAt != nil:
			stoppedAt = cur.StoppedAt
		default:
			t := time.Now().UTC()
			stoppedAt = &t
		}
	}

	if err := a.DB.UpsertUserPlayback(r.Context(), uid, ids, idx, in.PositionMs, in.IsPlaying, srcPl, cid, stoppedAt); err != nil {
		JSONError(w, 500, "db")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) deletePlayback(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r.Context())
	if !ok {
		JSONError(w, 401, "unauthorized")
		return
	}
	if err := a.DB.ClearUserPlayback(r.Context(), uid); err != nil {
		JSONError(w, 500, "db")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
