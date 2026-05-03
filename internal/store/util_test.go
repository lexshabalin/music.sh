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
		{"song.m4a ", true},
		{"x.mp3", true},
		{"take.aiff", true},
		{"take.AIF", true},
		{"radio.weba", true},
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

func TestAudioContentTypeForPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"/music/song.flac", "audio/flac"},
		{"/a/b/take.aiff", "audio/aiff"},
		{"/a/b/take.aif", "audio/aiff"},
		{"/x.y/radio.weba", "audio/webm"},
		{"/v/opus.opus", "audio/ogg; codecs=opus"},
	}
	for _, tc := range cases {
		if got := AudioContentTypeForPath(tc.path); got != tc.want {
			t.Errorf("AudioContentTypeForPath(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}
