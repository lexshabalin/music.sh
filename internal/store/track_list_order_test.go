package store

import (
	"strings"
	"testing"
)

func TestTrackListOrderBy(t *testing.T) {
	title := trackListOrderBy("title", "asc")
	if !strings.Contains(title, "meta_user_title") || !strings.Contains(title, "ASC NULLS LAST") {
		t.Fatalf("title asc: %q", title)
	}
	desc := trackListOrderBy("title", "desc")
	if !strings.Contains(desc, "DESC NULLS LAST") {
		t.Fatalf("title desc: %q", desc)
	}
	// Injection / unknown keys must fall back to default performer grouping, not echo input.
	bad := trackListOrderBy("title;drop table tracks", "asc")
	if strings.Contains(bad, "drop table") || !strings.Contains(bad, "track_no") {
		t.Fatalf("bad sort fallback: %q", bad)
	}
	art := trackListOrderBy("artist", "asc")
	if !strings.Contains(art, "meta_user_artist") {
		t.Fatalf("artist: %q", art)
	}
}
