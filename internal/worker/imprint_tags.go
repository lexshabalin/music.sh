package worker

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"musicsh/internal/imprint"
)

func (h *Worker) imprintTagsJob(ctx context.Context, jobID uuid.UUID, albumID uuid.UUID, tracks []struct {
	TrackID string   `json:"trackId"`
	Fields  []string `json:"fields"`
}) error {
	rows, err := h.DB.GetAlbumTracksForImprint(ctx, albumID)
	if err != nil {
		return err
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

	// selection: trackId -> field -> bool
	sel := map[string]map[imprint.Field]bool{}
	for _, t := range tracks {
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

	// progress counts: number of tracks that have any selected field
	total := 0
	for _, t := range targets {
		if len(sel[t.TrackID.String()]) > 0 {
			total++
		}
	}
	done := 0
	_ = h.DB.UpdateJobProgress(ctx, jobID, &done, &total, strPtr("starting"))

	var results []imprint.ApplyResult
	for _, t := range targets {
		if len(sel[t.TrackID.String()]) == 0 {
			continue
		}
		// ApplySelection works on a slice; call per-track for progress granularity.
		rs := imprint.ApplySelection([]imprint.TrackTarget{t}, h.Cfg.DataDir, sel)
		if len(rs) > 0 {
			results = append(results, rs[0])
		}
		done++
		msg := t.FilePath
		_ = h.DB.UpdateJobProgress(ctx, jobID, &done, &total, &msg)
	}

	b, _ := json.Marshal(map[string]any{
		"albumId":  albumID.String(),
		"results":  results,
	})
	_ = h.DB.SetJobResult(ctx, jobID, string(b))
	return nil
}

func strPtr(s string) *string { return &s }

