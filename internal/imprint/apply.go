package imprint

import (
	"os"
	"path/filepath"
	"strings"
)

type ApplyResult struct {
	TrackID  string `json:"trackId"`
	FileName string `json:"fileName"`
	Format   string `json:"format"`
	// AppliedAbsPath is the absolute filesystem path after tag write and optional filesystem rename (for DB sync).
	AppliedAbsPath string   `json:"appliedAbsPath,omitempty"`
	Warnings       []string `json:"warnings,omitempty"`
	Error          *string  `json:"error,omitempty"`
}

// ApplySelection writes selected fields for each track.
// cover bytes are loaded from DATA_DIR + CoverRelPath (if cover is selected).
func ApplySelection(targets []TrackTarget, dataDir string, selection map[string]map[Field]bool) []ApplyResult {
	var out []ApplyResult
	for _, t := range targets {
		sel := selection[t.TrackID.String()]
		if len(sel) == 0 {
			continue
		}
		res := ApplyResult{
			TrackID:  t.TrackID.String(),
			FileName: baseName(t.FilePath),
			Format:   strings.ToLower(strings.TrimSpace(t.Format)),
		}

		coverBytes := []byte(nil)
		coverMime := ""
		if sel[FieldCover] {
			if t.CoverRelPath != nil && strings.TrimSpace(*t.CoverRelPath) != "" {
				abs := absUnderData(dataDir, *t.CoverRelPath)
				if abs == "" {
					res.Warnings = append(res.Warnings, "read cover: invalid path")
				} else {
					b, err := os.ReadFile(abs)
					if err != nil {
						res.Warnings = append(res.Warnings, "read cover: "+err.Error())
					} else {
						coverBytes = b
						coverMime = NormalizeEmbedPictureMIME(coverMIME(abs, b))
						if coverMime == "" {
							res.Warnings = append(res.Warnings, "cover mime unknown; skipping cover")
							sel[FieldCover] = false
						}
					}
				}
			} else {
				// Explicitly clear cover if selected but no source.
				coverBytes = nil
				coverMime = "image/jpeg"
			}
		}

		ext := strings.ToLower(filepath.Ext(t.FilePath))
		if res.Format == "" && ext != "" {
			res.Format = strings.TrimPrefix(ext, ".")
		}

		var warn []string
		var err error
		switch {
		case res.Format == "mp3":
			warn, err = writeMP3Tags(t.FilePath, t, sel, coverBytes, coverMime)
		case res.Format == "flac":
			warn, err = writeFLACTags(t.FilePath, t, sel, coverBytes, coverMime)
		default:
			warn, err = writeFFmpegTags(t.FilePath, t, sel, coverBytes, coverMime)
		}
		res.Warnings = append(res.Warnings, warn...)
		if err != nil {
			s := FormatApplyError(err)
			res.Error = &s
		} else {
			ap, rwarn := RenameTrackAfterImprint(t.FilePath, t)
			res.Warnings = append(res.Warnings, rwarn...)
			ap = filepath.Clean(ap)
			res.AppliedAbsPath = ap
			res.FileName = filepath.Base(ap)
		}
		out = append(out, res)
	}
	return out
}

