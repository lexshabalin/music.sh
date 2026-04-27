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

func (a *App) parseUserIDFromRequest(r *http.Request) (uuid.UUID, error) {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return a.parseToken(strings.TrimSpace(h[7:]))
	}
	return uuid.UUID{}, errors.New("no token")
}

// parseUserIDFromMediaRequest authenticates stream/cover without leaking tokens in URL.
// Supports:
// - Authorization: Bearer <jwt> (preferred)
// - HttpOnly cookie (set by /api/auth/login and /api/auth/register)
func (a *App) parseUserIDFromMediaRequest(r *http.Request) (uuid.UUID, error) {
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
