package imprint

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type currentTags struct {
	title, artist, album string
	year, trackNo, discNo string
	coverHash string
}

func DryRunAlbum(targets []TrackTarget, dataDir string) (AlbumDryRun, error) {
	out := AlbumDryRun{
		// AlbumID is set by caller.
		AvailableFields: []Field{FieldTitle, FieldArtist, FieldAlbum, FieldYear, FieldTrackNo, FieldDiscNo, FieldCover},
	}

	for _, t := range targets {
		tr := TrackDryRun{
			TrackID:  t.TrackID,
			FileName: baseName(t.FilePath),
			Format:   strings.ToLower(strings.TrimSpace(t.Format)),
		}

		ext := strings.ToLower(filepath.Ext(t.FilePath))
		if tr.Format == "" && ext != "" {
			tr.Format = strings.TrimPrefix(ext, ".")
		}
		ct, warn, err := readCurrent(t.FilePath, tr.Format)
		if err != nil {
			tr.Warnings = append(tr.Warnings, "read tags: "+err.Error())
			tr.Diff = unsupportedAll(out.AvailableFields, "cannot read tags")
			out.Tracks = append(out.Tracks, tr)
			continue
		}
		tr.Warnings = append(tr.Warnings, warn...)

		desiredCoverHash := ""
		desiredCoverNote := (*string)(nil)
		var coverBytes []byte
		var coverMime string
		if t.CoverRelPath != nil && strings.TrimSpace(*t.CoverRelPath) != "" {
			abs := filepath.Join(dataDir, *t.CoverRelPath)
			b, e := os.ReadFile(abs)
			if e != nil {
				tr.Warnings = append(tr.Warnings, "read cover: "+e.Error())
				desiredCoverNote = ptr("cover source missing")
			} else if len(b) > 0 {
				coverBytes = b
				desiredCoverHash = hashBytes(b)
				coverMime = mimeByExt(abs)
			}
		}

		tr.Diff = []FieldDiff{
			diffText(FieldTitle, ct.title, t.Title),
			diffText(FieldArtist, ct.artist, t.Artist),
			diffText(FieldAlbum, ct.album, t.Album),
			diffText(FieldYear, ct.year, yearStr(t.Year)),
			diffText(FieldTrackNo, ct.trackNo, intStr(t.TrackNo)),
			diffText(FieldDiscNo, ct.discNo, intStr(t.DiscNo)),
			diffCover(ct.coverHash, desiredCoverHash, desiredCoverNote),
		}

		// stash cover mime in warnings if unknown (mp3/flac writers need it)
		if desiredCoverHash != "" && coverMime == "" {
			tr.Warnings = append(tr.Warnings, "cover mime unknown; will skip cover on apply")
		}
		_ = coverBytes
		_ = coverMime

		out.Tracks = append(out.Tracks, tr)
	}
	return out, nil
}

func readCurrent(path, format string) (currentTags, []string, error) {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "mp3":
		t, warn, err := readMP3Tags(path)
		if err != nil {
			return currentTags{}, warn, err
		}
		return currentTags{
			title: t.Title, artist: t.Artist, album: t.Album, year: t.Year,
			trackNo: t.TrackNo, discNo: t.DiscNo, coverHash: t.CoverHash,
		}, warn, nil
	case "flac":
		t, warn, err := readFLACTags(path)
		if err != nil {
			return currentTags{}, warn, err
		}
		return currentTags{
			title: t.Title, artist: t.Artist, album: t.Album, year: t.Year,
			trackNo: t.TrackNo, discNo: t.DiscNo, coverHash: t.CoverHash,
		}, warn, nil
	default:
		return currentTags{}, nil, fmt.Errorf("unsupported format: %s", format)
	}
}

func unsupportedAll(fields []Field, why string) []FieldDiff {
	out := make([]FieldDiff, 0, len(fields))
	for _, f := range fields {
		out = append(out, FieldDiff{Field: f, Supported: false, Changed: false, Warning: &why})
	}
	return out
}

func diffText(field Field, before, after string) FieldDiff {
	b := strings.TrimSpace(before)
	a := strings.TrimSpace(after)
	var bp, ap *string
	if b != "" {
		bp = &b
	}
	if a != "" {
		ap = &a
	}
	return FieldDiff{Field: field, Supported: true, Changed: b != a, Before: bp, After: ap}
}

func diffCover(beforeHash, afterHash string, note *string) FieldDiff {
	var b, a *string
	if strings.TrimSpace(beforeHash) != "" {
		s := "sha256:" + beforeHash
		b = &s
	}
	if strings.TrimSpace(afterHash) != "" {
		s := "sha256:" + afterHash
		a = &s
	}
	d := FieldDiff{Field: FieldCover, Supported: true, Changed: (beforeHash != afterHash), Before: b, After: a}
	if note != nil {
		d.Warning = note
	}
	return d
}

func intStr(v *int) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%d", *v)
}

func yearStr(v *int) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%d", *v)
}

func ptr(s string) *string { return &s }

func mimeByExt(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}

