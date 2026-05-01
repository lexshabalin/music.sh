package artistimage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var ErrNotFound = errors.New("artist image not found from provider")

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
