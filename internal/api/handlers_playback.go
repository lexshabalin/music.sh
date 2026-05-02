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
	OwnerEpoch       int64    `json:"ownerEpoch"`
	SourcePlaylistID *string  `json:"sourcePlaylistId,omitempty"`
	UpdatedAt        string   `json:"updatedAt"`
}

type playbackIn struct {
	TrackIDs         []string `json:"trackIds"`
	CurrentIndex     int      `json:"currentIndex"`
	PositionMs       int      `json:"positionMs"`
	IsPlaying        bool     `json:"isPlaying"`
	ClientID         *string  `json:"clientId,omitempty"`
	OwnerEpoch       int64    `json:"ownerEpoch"`
	ForceTakeover    bool     `json:"forceTakeover,omitempty"`
	SourcePlaylistID *string  `json:"sourcePlaylistId,omitempty"`
}

type playbackTakeoverOut struct {
	OwnerEpoch int64 `json:"ownerEpoch"`
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
		OwnerEpoch:   st.OwnerEpoch,
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
	if in.OwnerEpoch < 0 {
		JSONError(w, 400, "invalid owner epoch")
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
	if in.OwnerEpoch != cur.OwnerEpoch && !in.ForceTakeover {
		JSONError(w, 409, "stale playback owner epoch")
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

	newEpoch := cur.OwnerEpoch
	if in.ForceTakeover && in.IsPlaying && cid != "" && cur.PlaybackClientID != "" && cur.PlaybackClientID != cid {
		newEpoch = cur.OwnerEpoch + 1
	}
	ok, err = a.DB.UpsertUserPlayback(r.Context(), uid, ids, idx, in.PositionMs, in.IsPlaying, srcPl, cid, stoppedAt, cur.OwnerEpoch, newEpoch)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	if !ok {
		JSONError(w, 409, "stale playback owner epoch")
		return
	}
	_ = a.DB.AccumulateListeningFromPlayback(r.Context(), uid, cur, time.Now().UTC())
	w.WriteHeader(http.StatusNoContent)
}

// takeoverPlayback performs explicit user-initiated ownership transfer.
// Unlike passive heartbeat PUTs, this endpoint always allows takeover.
func (a *App) takeoverPlayback(w http.ResponseWriter, r *http.Request) {
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
	if len(ids) == 0 {
		JSONError(w, 400, "empty queue")
		return
	}
	idx := in.CurrentIndex
	if idx < 0 || idx >= len(ids) {
		JSONError(w, 400, "invalid index")
		return
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
	newEpoch := cur.OwnerEpoch + 1
	// Explicit takeover always marks playback as active under this client.
	ok, err = a.DB.UpsertUserPlayback(r.Context(), uid, ids, idx, in.PositionMs, true, srcPl, cid, nil, cur.OwnerEpoch, newEpoch)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	if !ok {
		JSONError(w, 409, "stale playback owner epoch")
		return
	}
	_ = a.DB.AccumulateListeningFromPlayback(r.Context(), uid, cur, time.Now().UTC())
	JSON(w, 200, playbackTakeoverOut{OwnerEpoch: newEpoch})
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
