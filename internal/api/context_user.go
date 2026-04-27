package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

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
	if t := r.URL.Query().Get("token"); t != "" {
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
