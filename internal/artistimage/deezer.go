package artistimage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// ErrNotFound is returned when Deezer has no usable match (artist portrait or album cover).
var ErrNotFound = errors.New("deezer: not found")

const userAgent = "MusicSH/0.1 ( self-hosted artist art )"

// DeezerPictureURL resolves a portrait URL for a human-readable artist name using Deezer's public API.
func DeezerPictureURL(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%w", ErrNotFound)
	}
	api := "https://api.deezer.com/search/artist?q=" + url.QueryEscape(name) + "&limit=5"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)

	client := &http.Client{Timeout: 25 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("deezer search: http %d", res.StatusCode)
	}
	var envelope struct {
		Data []struct {
			Name       string `json:"name"`
			PictureXL  string `json:"picture_xl"`
			PictureBig string `json:"picture_big"`
			Picture    string `json:"picture"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return "", err
	}
	if envelope.Error != nil && strings.TrimSpace(envelope.Error.Message) != "" {
		return "", fmt.Errorf("deezer: %s", envelope.Error.Message)
	}
	if len(envelope.Data) == 0 {
		return "", ErrNotFound
	}
	want := normalizeNameKey(name)
	var best string
	for _, row := range envelope.Data {
		pick := strings.TrimSpace(row.PictureXL)
		if pick == "" {
			pick = strings.TrimSpace(row.PictureBig)
		}
		if pick == "" {
			pick = strings.TrimSpace(row.Picture)
		}
		if pick == "" {
			continue
		}
		if best == "" {
			best = pick
		}
		if normalizeNameKey(row.Name) == want {
			return pick, nil
		}
	}
	if best != "" {
		return best, nil
	}
	return "", ErrNotFound
}

func normalizeNameKey(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// DeezerAlbumCoverURL resolves cover art URL (prefer cover_xl) for artist + album title.
func DeezerAlbumCoverURL(ctx context.Context, artistName, albumTitle string, releaseYear *int) (string, error) {
	albumTitle = strings.TrimSpace(albumTitle)
	if albumTitle == "" {
		return "", ErrNotFound
	}
	artistName = strings.TrimSpace(artistName)
	q := albumTitle
	if artistName != "" {
		q = artistName + " " + albumTitle
	}
	if releaseYear != nil && *releaseYear > 0 {
		q += " " + strconv.Itoa(*releaseYear)
	}

	api := "https://api.deezer.com/search/album?q=" + url.QueryEscape(q) + "&limit=12"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)

	client := &http.Client{Timeout: 25 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("deezer album search: http %d", res.StatusCode)
	}
	var envelope struct {
		Data []struct {
			Title  string `json:"title"`
			Cover  string `json:"cover_xl"`
			CoverM string `json:"cover_medium"`
			CoverB string `json:"cover_big"`
			Artist struct {
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return "", err
	}
	if envelope.Error != nil && strings.TrimSpace(envelope.Error.Message) != "" {
		return "", fmt.Errorf("deezer: %s", envelope.Error.Message)
	}
	if len(envelope.Data) == 0 {
		return "", ErrNotFound
	}

	wantAlb := normalizeNameKey(albumTitle)
	wantArt := normalizeNameKey(artistName)

	pickCover := func(coverXL, coverBig, coverMed string) string {
		s := strings.TrimSpace(coverXL)
		if s == "" {
			s = strings.TrimSpace(coverBig)
		}
		if s == "" {
			s = strings.TrimSpace(coverMed)
		}
		return s
	}

	var fallback string
	for _, row := range envelope.Data {
		url := pickCover(row.Cover, row.CoverB, row.CoverM)
		if url == "" {
			continue
		}
		if fallback == "" {
			fallback = url
		}
		albKey := normalizeNameKey(row.Title)
		artKey := normalizeNameKey(row.Artist.Name)
		if wantArt != "" {
			if albKey == wantAlb && artKey == wantArt {
				return url, nil
			}
		} else if albKey == wantAlb {
			return url, nil
		}
	}
	if fallback != "" {
		return fallback, nil
	}
	return "", ErrNotFound
}
