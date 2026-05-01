package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"musicsh/internal/auth"
)

type ctxKey int

const keyUserID ctxKey = 1

func withUserID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, keyUserID, id)
}

func userIDFromCtx(ctx context.Context) (uuid.UUID, bool) {
	v := ctx.Value(keyUserID)
	if v == nil {
		return uuid.UUID{}, false
	}
	id, ok := v.(uuid.UUID)
	return id, ok
}

// parseUserIDFromAuth resolves the JWT for JSON API routes: same cookie as login as for media endpoints.
func (a *App) parseUserIDFromAuth(r *http.Request) (uuid.UUID, error) {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return a.parseToken(strings.TrimSpace(h[7:]))
	}
	c, err := r.Cookie(authCookieName)
	if err == nil && strings.TrimSpace(c.Value) != "" {
		return a.parseToken(c.Value)
	}
	return uuid.UUID{}, errors.New("no token")
}

func (a *App) parseUserIDFromRequest(r *http.Request) (uuid.UUID, error) {
	return a.parseUserIDFromAuth(r)
}

// parseUserIDFromMediaRequest authenticates stream/cover/background URLs that cannot rely on Bearer headers alone.
// Order: Authorization Bearer, HttpOnly cookie (musicsh_at), then ?token= for <audio>/<img>-style requests (same caveat as URLs).
func (a *App) parseUserIDFromMediaRequest(r *http.Request) (uuid.UUID, error) {
	id, err := a.parseUserIDFromAuth(r)
	if err == nil {
		return id, nil
	}
	if t := strings.TrimSpace(r.URL.Query().Get("token")); t != "" {
		return a.parseToken(t)
	}
	return uuid.UUID{}, errors.New("no token")
}

func (a *App) parseToken(s string) (uuid.UUID, error) {
	claims, err := auth.ParseToken(a.jwt, s)
	if err != nil {
		return uuid.UUID{}, err
	}
	return claims.UserID, nil
}

const authCookieName = "musicsh_at"

func setAuthCookie(w http.ResponseWriter, r *http.Request, token string, exp time.Time) {
	secure := r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		Expires:  exp,
		MaxAge:   int(time.Until(exp).Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}
