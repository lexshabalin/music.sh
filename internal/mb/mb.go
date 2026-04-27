package mb

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const userAgent = "MusicSH/0.1 ( self-hosted; https://github.com/local )"

// Client is rate-limited (MusicBrainz requires ~1 req/s).
type Client struct {
	HTTP     *http.Client
	last     time.Time
	minGap   time.Duration
	releases string
}

func New() *Client {
	return &Client{
		HTTP:   &http.Client{Timeout: 30 * time.Second},
		minGap: 1100 * time.Millisecond,
	}
}

type releaseResponse struct {
	Releases []struct {
		ID    string          `json:"id"`
		Title string          `json:"title"`
		Date  json.RawMessage `json:"date"`
	} `json:"releases"`
	ReleaseCount int `json:"release-count"`
	Count        int `json:"count"`
}

func (c *Client) throttle() {
	elapsed := time.Since(c.last)
	if d := c.minGap - elapsed; d > 0 {
		time.Sleep(d)
	}
	c.last = time.Now()
}

// SearchRelease returns the best-matching release MBID, or "" if not found.
func (c *Client) SearchRelease(artist, album string) (releaseID, releaseTitle, releaseDate string, err error) {
	if artist == "" {
		artist = "Unknown"
	}
	if album == "" {
		album = "Unknown"
	}
	artist = normalizePerson(artist)
	album = normalizeTitle(album)

	artistAlts := uniqNonEmpty([]string{artist, normalizeCyr(artist), stripFeat(artist)})
	albumAlts := uniqNonEmpty([]string{album, normalizeCyr(album), stripParens(album)})

	for _, a := range artistAlts {
		for _, al := range albumAlts {
			id, title, date, e := c.searchReleaseFields(a, al)
			if e != nil {
				err = e
				continue
			}
			if id != "" {
				return id, title, date, nil
			}
		}
	}
	// fallback fuzzy (free text)
	return c.searchReleaseFuzzy(artist, album)
}

func (c *Client) searchReleaseFields(artist, album string) (releaseID, releaseTitle, releaseDate string, err error) {
	c.throttle()
	q := fmt.Sprintf(`release:"%s" AND artist:"%s"`, quoteMB(album), quoteMB(artist))
	u := "https://musicbrainz.org/ws/2/release/?query=" + url.QueryEscape(q) + "&fmt=json&limit=3"
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return "", "", "", fmt.Errorf("musicbrainz http %d: %s", resp.StatusCode, string(b))
	}
	var out releaseResponse
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", "", err
	}
	if len(out.Releases) == 0 {
		return "", "", "", nil
	}
	r0 := out.Releases[0]
	_ = json.Unmarshal(r0.Date, &releaseDate)
	return r0.ID, r0.Title, releaseDate, nil
}

func quoteMB(s string) string {
	if s == "" {
		return s
	}
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}

func normalizeCyr(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "ё", "е")
	return s
}

func stripParens(s string) string {
	if i := strings.IndexAny(s, "(["); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

func stripFeat(s string) string {
	ls := strings.ToLower(s)
	for _, k := range []string{" feat.", " ft.", " featuring "} {
		if i := strings.Index(ls, k); i >= 0 {
			return strings.TrimSpace(s[:i])
		}
	}
	return s
}

func normalizePerson(s string) string { return strings.TrimSpace(s) }
func normalizeTitle(s string) string  { return strings.TrimSpace(s) }

func uniqNonEmpty(in []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		k := strings.ToLower(s)
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, s)
	}
	return out
}

func (c *Client) searchReleaseFuzzy(artist, album string) (releaseID, releaseTitle, releaseDate string, err error) {
	c.throttle()
	q := strings.TrimSpace(artist + " " + album)
	if q == "" {
		return "", "", "", nil
	}
	u := "https://musicbrainz.org/ws/2/release/?query=" + url.QueryEscape(q) + "&fmt=json&limit=3"
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return "", "", "", e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return "", "", "", fmt.Errorf("musicbrainz fuzzy: %d %s", resp.StatusCode, string(b))
	}
	var out releaseResponse
	if e = json.NewDecoder(resp.Body).Decode(&out); e != nil {
		return "", "", "", e
	}
	if len(out.Releases) == 0 {
		return "", "", "", nil
	}
	r0 := out.Releases[0]
	_ = json.Unmarshal(r0.Date, &releaseDate)
	return r0.ID, r0.Title, releaseDate, nil
}

// Artist credits search fallback if release search empty
func (c *Client) SearchByFreeText(query string) (releaseID, releaseTitle string, err error) {
	c.throttle()
	u := "https://musicbrainz.org/ws/2/release/?query=" + url.QueryEscape(query) + "&fmt=json&limit=1"
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("musicbrainz %d", resp.StatusCode)
	}
	var out releaseResponse
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", err
	}
	if len(out.Releases) == 0 {
		return "", "", nil
	}
	return out.Releases[0].ID, out.Releases[0].Title, nil
}
