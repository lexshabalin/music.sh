package store

import (
	"slices"
	"testing"
)

func TestArtistCreditParts_commasRussianCollab(t *testing.T) {
	got := ArtistCreditParts("OG Buda, Слава КПСС")
	want := []string{"OG Buda", "Слава КПСС"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestArtistCreditParts_featAmpersand(t *testing.T) {
	got := ArtistCreditParts(`Baby Keem feat. Kendrick Lamar`)
	want := []string{"Baby Keem", "Kendrick Lamar"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestArtistCreditParts_xSlashDedupe(t *testing.T) {
	got := ArtistCreditParts(`Someone x Other, Someone`)
	want := []string{"Someone", "Other"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestArtistCreditParts_ACDCSlash(t *testing.T) {
	got := ArtistCreditParts("AC/DC")
	want := []string{"AC/DC"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestArtistCreditParts_tripleComma(t *testing.T) {
	got := ArtistCreditParts("Booker, CMH, Mzlff, Слава КПСС")
	want := []string{"Booker", "CMH", "Mzlff", "Слава КПСС"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
