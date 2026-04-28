package acoustid

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client queries AcoustID lookup API.
type Client struct {
	HTTP *http.Client
	Key  string
}

func New(key string) *Client {
	return &Client{
		HTTP: &http.Client{Timeout: 30 * time.Second},
		Key:  strings.TrimSpace(key),
	}
}

type LookupResult struct {
	RecordingID string
	Title       string
	Artist      string
	Album       string
	Year        *int
	Score       float64
}

type lookupResponse struct {
	Status  string `json:"status"`
	Results []struct {
		Score float64 `json:"score"`
		// AcoustID id omitted
		Recordings []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Artists []struct {
				Name string `json:"name"`
			} `json:"artists"`
			Releases []struct {
				Title string          `json:"title"`
				Date  json.RawMessage `json:"date"`
			} `json:"releases"`
		} `json:"recordings"`
	} `json:"results"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Lookup tries to identify a track by chromaprint fingerprint.
// durationSec should be integer seconds.
func (c *Client) Lookup(durationSec int, fingerprint string) (*LookupResult, error) {
	if c == nil || c.HTTP == nil {
		return nil, fmt.Errorf("acoustid: no client")
	}
	if strings.TrimSpace(c.Key) == "" {
		return nil, fmt.Errorf("acoustid: ACOUSTID_KEY not set")
	}
	fp := strings.TrimSpace(fingerprint)
	if fp == "" || durationSec <= 0 {
		return nil, fmt.Errorf("acoustid: bad input")
	}

	form := url.Values{}
	form.Set("client", c.Key)
	form.Set("meta", "recordings+releases")
	form.Set("duration", strconv.Itoa(durationSec))
	form.Set("fingerprint", fp)

	req, _ := http.NewRequest(http.MethodPost, "https://api.acoustid.org/v2/lookup", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "MusicSH/0.1 (acoustid)")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return nil, fmt.Errorf("acoustid http %d: %s", resp.StatusCode, string(b))
	}
	var out lookupResponse
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Status != "ok" {
		msg := strings.TrimSpace(out.Error.Message)
		if msg == "" {
			msg = "lookup failed"
		}
		return nil, fmt.Errorf("acoustid: %s", msg)
	}
	var best *LookupResult
	for _, r := range out.Results {
		for _, rec := range r.Recordings {
			cand := &LookupResult{
				RecordingID: rec.ID,
				Title:       strings.TrimSpace(rec.Title),
				Score:       r.Score,
			}
			if len(rec.Artists) > 0 {
				cand.Artist = strings.TrimSpace(rec.Artists[0].Name)
			}
			if len(rec.Releases) > 0 {
				cand.Album = strings.TrimSpace(rec.Releases[0].Title)
				// date is often "YYYY" or "YYYY-MM-DD"
				var ds string
				_ = json.Unmarshal(rec.Releases[0].Date, &ds)
				if len(ds) >= 4 {
					if y, e := strconv.Atoi(ds[:4]); e == nil && y > 0 && y < 3000 {
						cand.Year = &y
					}
				}
			}
			if cand.RecordingID == "" {
				continue
			}
			if best == nil || cand.Score > best.Score {
				best = cand
			}
		}
	}
	if best == nil {
		return nil, nil
	}
	return best, nil
}

