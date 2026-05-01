package coverproc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxCoverURLBytes = 18 << 20

var (
	ErrCoverURL       = errors.New("bad cover url")
	ErrCoverHost      = errors.New("cover url host not allowed")
	ErrCoverFetch     = errors.New("cover fetch failed")
)

func hostFetchSafe(ctx context.Context, host string) error {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == "" {
		return ErrCoverHost
	}
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return ErrCoverHost
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, h)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrCoverHost, err)
	}
	if len(addrs) == 0 {
		return ErrCoverHost
	}
	for _, a := range addrs {
		ip := a.IP
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return ErrCoverHost
		}
		if ip4 := ip.To4(); ip4 != nil {
			// cloud metadata and similar
			if ip4[0] == 169 && ip4[1] == 254 {
				return ErrCoverHost
			}
		}
	}
	return nil
}

func coverURLSafe(ctx context.Context, raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, ErrCoverURL
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, ErrCoverURL
	}
	host := u.Hostname()
	if host == "" {
		return nil, ErrCoverURL
	}
	if err := hostFetchSafe(ctx, host); err != nil {
		return nil, err
	}
	return u, nil
}

// FetchImageURL downloads an image from an http(s) URL after basic SSRF checks.
func FetchImageURL(ctx context.Context, raw string) ([]byte, error) {
	u, err := coverURLSafe(ctx, raw)
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 45 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return errors.New("too many redirects")
			}
			if req.URL != nil && req.URL.Hostname() != "" {
				return hostFetchSafe(req.Context(), req.URL.Hostname())
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "musicsh-cover-fetch/1.0")

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCoverFetch, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status %d", ErrCoverFetch, res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxCoverURLBytes))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCoverFetch, err)
	}
	return body, nil
}
