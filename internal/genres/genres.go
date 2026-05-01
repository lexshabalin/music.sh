package genres

import (
	"sort"
	"strings"
)

// Split parses multiple genres from UI / stored joined text (prefer ";" between tags).
func Split(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var raw []string
	for _, piece := range strings.Split(s, ";") {
		for _, piece2 := range strings.Split(piece, "|") {
			t := strings.TrimSpace(piece2)
			if t != "" {
				raw = append(raw, t)
			}
		}
	}
	return DedupePreserveOrder(raw)
}

// Join merges labels for imprint / ffmpeg single fields.
func Join(labels []string) string {
	l := DedupePreserveOrder(labels)
	if len(l) == 0 {
		return ""
	}
	return strings.Join(l, "; ")
}

// DedupePreserveOrder trims, drops empties and case-insensitive dupes (keeps first casing).
func DedupePreserveOrder(labels []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, l := range labels {
		x := strings.TrimSpace(l)
		if x == "" {
			continue
		}
		k := strings.ToLower(x)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, x)
	}
	return out
}

// CanonicalComparable sorts case-insensitively for comparing two genre sets.
func CanonicalComparable(parts []string) string {
	l := DedupePreserveOrder(parts)
	ll := make([]string, len(l))
	for i := range l {
		ll[i] = strings.ToLower(l[i])
	}
	sort.Strings(ll)
	return strings.Join(ll, ";")
}
