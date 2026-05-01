package imprint

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const imprintStemMaxRunes = 200

func normalizedAudioExt(absPath string, formatFallback string) string {
	extLower := strings.ToLower(strings.TrimSpace(filepath.Ext(absPath)))
	if extLower != "" {
		return extLower
	}
	f := strings.Trim(strings.ToLower(strings.TrimSpace(formatFallback)), ".")
	if f == "" {
		return ""
	}
	return "." + f
}

func sanitizeImprintSegment(s string) string {
	s = strings.TrimSpace(html.UnescapeString(s))
	if s == "" {
		return ""
	}
	var b strings.Builder
	prevSep := false
	for _, r := range s {
		switch {
		case r == '/' || r == '\\' || unicode.IsControl(r):
			if b.Len() > 0 && !prevSep {
				b.WriteRune('-')
				prevSep = true
			}
		case r == '<' || r == '>' || r == ':' || r == '"' ||
			r == '|' || r == '?' || r == '*' || r == 0:
			if b.Len() > 0 && !prevSep {
				b.WriteRune('-')
				prevSep = true
			}
		default:
			b.WriteRune(r)
			prevSep = false
		}
	}
	out := strings.TrimSpace(strings.TrimRight(b.String(), " .-_"))
	out = strings.Join(strings.Fields(out), " ")
	return out
}

func imprintStemFromTarget(desired TrackTarget) string {
	a := sanitizeImprintSegment(desired.Artist)
	ti := sanitizeImprintSegment(desired.Title)
	if a == "" {
		a = "Unknown Artist"
	}
	if ti == "" {
		ti = "Untitled"
	}
	stem := a + " - " + ti
	rs := []rune(stem)
	if len(rs) <= imprintStemMaxRunes {
		return stem
	}
	return string(rs[:imprintStemMaxRunes-1]) + "…"
}

// ProposedImprintBasename returns the basename the file would get after imprint ($ARTIST - $TITLE.$ext).
func ProposedImprintBasename(absPath string, desired TrackTarget, formatForExt string) string {
	ext := normalizedAudioExt(absPath, formatForExt)
	if ext == "" {
		return ""
	}
	return imprintStemFromTarget(desired) + ext
}

func isSameUnderlyingFile(pathA, pathB string) bool {
	fiA, errA := os.Stat(pathA)
	fiB, errB := os.Stat(pathB)
	if errA != nil || errB != nil {
		return false
	}
	return os.SameFile(fiA, fiB)
}

func renameViaTemp(dir, oldAbs, destAbs string) error {
	raw := make([]byte, 10)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("rand: %w", err)
	}
	tmp := filepath.Join(dir, ".musicsh-rename-"+hex.EncodeToString(raw)+filepath.Ext(oldAbs))
	if err := os.Rename(oldAbs, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, destAbs); err != nil {
		_ = os.Rename(tmp, oldAbs)
		return err
	}
	return nil
}

// pickUniqueRenameTarget returns desired path; if basename is occupied by another inode, picks "stem (N).ext".
func pickUniqueRenameTarget(dir, stem, ext, oldAbs string) (string, error) {
	want := filepath.Join(dir, stem+ext)

	if _, err := os.Stat(want); err == nil {
		if isSameUnderlyingFile(oldAbs, want) && filepath.Base(oldAbs) == filepath.Base(want) {
			return filepath.Clean(oldAbs), nil
		}
		if isSameUnderlyingFile(oldAbs, want) && filepath.Base(oldAbs) != filepath.Base(want) {
			return filepath.Clean(want), nil
		}
		// Different file occupies "want".
		for n := 2; n <= 99; n++ {
			next := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, n, ext))
			_, er := os.Stat(next)
			if os.IsNotExist(er) {
				return filepath.Clean(next), nil
			}
			if er != nil {
				return "", er
			}
			if isSameUnderlyingFile(oldAbs, next) {
				return filepath.Clean(oldAbs), nil
			}
		}
		return "", fmt.Errorf("could not allocate a free filename beside %s", stem+ext)
	}
	if !os.IsNotExist(err) {
		return "", err
	}
	return filepath.Clean(want), nil
}

// RenameTrackAfterImprint moves the tagged file to "Artist - Title.ext" in the same directory.
func RenameTrackAfterImprint(oldAbsPath string, desired TrackTarget) (finalAbsPath string, warnings []string) {
	oldAbsPath = filepath.Clean(oldAbsPath)
	dir := filepath.Dir(oldAbsPath)

	ext := normalizedAudioExt(oldAbsPath, desired.Format)
	if ext == "" {
		warnings = append(warnings, "rename skipped: no file extension")
		return oldAbsPath, warnings
	}

	dest, err := pickUniqueRenameTarget(dir, imprintStemFromTarget(desired), ext, oldAbsPath)
	if err != nil {
		warnings = append(warnings, "rename skipped: "+err.Error())
		return oldAbsPath, warnings
	}

	if dest == filepath.Clean(oldAbsPath) {
		return oldAbsPath, warnings
	}

	// Pure case rename on case-insensitive volume
	if strings.EqualFold(dest, oldAbsPath) && dest != oldAbsPath {
		if err := renameViaTemp(dir, oldAbsPath, dest); err != nil {
			warnings = append(warnings, "rename failed (case-only): "+err.Error())
			return oldAbsPath, warnings
		}
		return filepath.Clean(dest), warnings
	}

	if err := os.Rename(oldAbsPath, dest); err != nil {
		if strings.EqualFold(dest, oldAbsPath) && dest != oldAbsPath {
			if err2 := renameViaTemp(dir, oldAbsPath, dest); err2 != nil {
				warnings = append(warnings, "rename failed: "+err.Error())
				return oldAbsPath, warnings
			}
			return filepath.Clean(dest), warnings
		}
		warnings = append(warnings, "rename failed: "+err.Error())
		return oldAbsPath, warnings
	}
	return filepath.Clean(dest), warnings
}
