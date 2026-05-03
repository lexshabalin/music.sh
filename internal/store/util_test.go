package store

import "testing"

func TestIsAudioFilename(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"song.flac", true},
		{"song.FLAC", true},
		{"  track.flac  ", true},
		{"artist\uFF0Etrack.flac", true}, // fullwidth dot before basename still ends with .flac
		{"album.flac", true},
		{"x.mp3", true},
		{"readme.txt", false},
		{"noext", false},
		{"archive.flac.zip", false},
	}
	for _, tc := range cases {
		if got := IsAudioFilename(tc.name); got != tc.want {
			t.Errorf("IsAudioFilename(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}
