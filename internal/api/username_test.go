package api

import "testing"

func TestIsValidUsername(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"rh", true},
		{"RH", true},
		{"a", false},
		{"ab", true},
		{"user_name", true},
		{"-bad", false},
		{"bad-", false},
		{"", false},
		{"has space", false},
	}
	for _, tc := range cases {
		if got := isValidUsername(tc.in); got != tc.want {
			t.Fatalf("isValidUsername(%q)=%v want %v", tc.in, got, tc.want)
		}
	}
}
