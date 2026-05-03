package store

import (
	"html"
	"regexp"
	"strings"
)

var (
	reCreditFeat      = regexp.MustCompile(`(?i)\s+(?:feat(?:\.|uring)?|ft\.?)\s+`)
	reCreditSlash     = regexp.MustCompile(`\s+/\s+`)
	reCreditX         = regexp.MustCompile(`(?i)\s+[x×]\s+`)
	reCreditAmpPlus   = regexp.MustCompile(`\s+&+\s+|\s+\++\s+`)
	reCreditAmpSimple = regexp.MustCompile(`\s+[&]+\s+`)
)

// subdivideCreditsToken splits one performer segment using feat/x/&/slash-style markers (no commas).
func subdivideCreditsToken(s string, acc *[]string) {
	s = strings.TrimSpace(s)
	if s == "" {
		return
	}
	chunks := reCreditFeat.Split(s, -1)
	if len(chunks) > 1 {
		for _, c := range chunks {
			subdivideCreditsToken(c, acc)
		}
		return
	}
	chunks = reCreditSlash.Split(s, -1)
	if len(chunks) > 1 {
		for _, c := range chunks {
			subdivideCreditsToken(c, acc)
		}
		return
	}
	chunks = reCreditX.Split(s, -1)
	if len(chunks) > 1 {
		for _, c := range chunks {
			subdivideCreditsToken(c, acc)
		}
		return
	}
	chunks = reCreditAmpPlus.Split(s, -1)
	if len(chunks) <= 1 {
		chunks = reCreditAmpSimple.Split(s, -1)
	}
	if len(chunks) > 1 {
		for _, c := range chunks {
			subdivideCreditsToken(c, acc)
		}
		return
	}
	s = strings.TrimSpace(s)
	s = strings.Trim(s, ",;")
	s = strings.TrimSpace(s)
	if s != "" {
		*acc = append(*acc, s)
	}
}

func splitCommaSemiTop(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		return r == ',' || r == ';'
	})
}

func dedupeCreditNamesPreserveOrder(names []string) []string {
	seen := make(map[string]struct{}, len(names))
	out := names[:0]
	for _, raw := range names {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		key := normalizeSearch(raw)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, raw)
	}
	return out
}

// ArtistCreditParts parses a PERFORMER / ARTIST tag line into credited names suitable for indexing.
func ArtistCreditParts(raw string) []string {
	raw = strings.TrimSpace(html.UnescapeString(strings.TrimSpace(raw)))
	if raw == "" {
		return nil
	}
	chunksTop := splitCommaSemiTop(raw)
	var acc []string
	for _, ch := range chunksTop {
		subdivideCreditsToken(ch, &acc)
	}
	return dedupeCreditNamesPreserveOrder(acc)
}
