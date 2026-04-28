package scanner

import (
	"regexp"
	"strings"
)

var reCollabCut = regexp.MustCompile(`(?i)(?:\s+|\(|,|;)(?:feat\.?|ft\.?|featuring|w\/|vs\.?|x|при\s+уч\.|под\s+уч\.|совместно\s+с)\b.*$`)

// primaryArtistForAlbumGrouping strips common "featured/collab" suffixes from display artist strings.
// This is intentionally conservative: it only removes trailing collaboration segments.
func primaryArtistForAlbumGrouping(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	// Remove nested parentheses tails first (cheap heuristic).
	for strings.Contains(s, "(") && strings.Contains(s, ")") {
		if i := strings.LastIndex(s, "("); i >= 0 {
			if j := strings.LastIndex(s, ")"); j > i {
				s = strings.TrimSpace(s[:i] + s[j+1:])
				continue
			}
		}
		break
	}
	s = strings.TrimSpace(reCollabCut.ReplaceAllString(s, ""))
	s = strings.Trim(s, " ,;-")
	return strings.TrimSpace(s)
}
