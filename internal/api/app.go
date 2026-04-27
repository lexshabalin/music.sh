package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"

	"musicsh/internal/auth"
	"musicsh/internal/config"
	"musicsh/internal/store"
)

// App is the HTTP API surface
type App struct {
	DB   *store.DB
	jwt  string
	Orig []string
	MusicDir, DataDir string
}

func New(c *config.Config, db *store.DB) *App {
	o := c.CORSOrigins
	if len(o) == 0 {
		o = []string{"*"}
	}
	return &App{
		DB:       db,
		jwt:      c.JWTSecret,
		Orig:     o,
		MusicDir: c.MusicDir,
		DataDir:  c.DataDir,
	}
}

func (a *App) Handlers() http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(chimw.RealIP)
	r.Use(chimw.RequestID)
	r.Use(chimw.Logger)
	if len(a.Orig) == 1 && a.Orig[0] == "*" {
		c := cors.New(cors.Options{AllowedOrigins: []string{"*"}, AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"*"}, ExposedHeaders:   []string{"*"}, AllowCredentials: false})
		r.Use(c.Handler)
	} else {
		c := cors.New(cors.Options{AllowedOrigins: a.Orig, AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"*"}, ExposedHeaders:   []string{"*"}, AllowCredentials: true, MaxAge: 86400})
		r.Use(c.Handler)
	}

	r.Get("/api/healthz", a.health)

	r.Post("/api/auth/register", a.register)
	r.Post("/api/auth/login", a.login)
	r.Get("/api/tracks/{id}/stream", a.stream) // may use ?token= for <audio>
	r.Get("/api/albums/{id}/cover", a.albumCover)

	r.Group(func(g chi.Router) {
		g.Use(middlewareUser(a))
		g.Get("/api/me", a.me)
		g.Get("/api/artists", a.listArtists)
		g.Get("/api/albums", a.listAlbums)
		g.Get("/api/albums/{id}", a.getAlbum)
		g.Get("/api/tracks", a.listTracks)
		g.Get("/api/tracks/{id}", a.getTrack)
		g.Get("/api/playlists", a.listPl)
		g.Post("/api/playlists", a.createPl)
		g.Get("/api/playlists/{id}", a.getPl)
		g.Patch("/api/playlists/{id}", a.patchPl)
		g.Delete("/api/playlists/{id}", a.deletePl)
		g.Post("/api/playlists/{id}/tracks", a.addPlTrack)
		g.Delete("/api/playlists/{id}/tracks/{trackId}", a.removePlTrack)
		g.Get("/api/likes", a.listLikes)
		g.Post("/api/likes", a.addLike)
		g.Delete("/api/likes/{trackId}", a.removeLike)
		g.Post("/api/library/scan", a.scan)
	})
	return r
}

func middlewareUser(a *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, err := a.parseUserIDFromRequest(r)
			if err != nil {
				JSONError(w, 401, "unauthorized")
				return
			}
			next.ServeHTTP(w, r.WithContext(withUserID(r.Context(), uid)))
		})
	}
}

// ---

func (a *App) health(w http.ResponseWriter, r *http.Request) { JSON(w, 200, map[string]string{"status": "ok"}) }

type regBody struct {
	Email    string  `json:"email"`
	Password string  `json:"password"`
	Name     *string `json:"displayName"`
}

type loginBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResp struct {
	Token     string     `json:"accessToken"`
	ExpiresAt time.Time  `json:"expiresAt"`
	User      store.User `json:"user"`
}

func (a *App) register(w http.ResponseWriter, r *http.Request) {
	var b regBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	b.Email = strings.TrimSpace(strings.ToLower(b.Email))
	if b.Email == "" || len(b.Password) < 8 {
		JSONError(w, 400, "invalid email or password (min 8 chars)")
		return
	}
	h, err := auth.HashPassword(b.Password)
	if err != nil {
		JSONError(w, 500, "hash")
		return
	}
	id := uuid.New()
	if err := a.DB.CreateUser(r.Context(), id, b.Email, h, b.Name); err != nil {
		if store.IsUniqueViolation(err) {
			JSONError(w, 400, "email in use")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	tok, exp, err := a.makeToken(r.Context(), id, b.Email)
	if err != nil {
		JSONError(w, 500, "token")
		return
	}
	u, _ := a.DB.UserByID(r.Context(), id)
	JSON(w, 201, tokenResp{Token: tok, ExpiresAt: exp, User: u})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var b loginBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	email := strings.TrimSpace(strings.ToLower(b.Email))
	uid, _, _, hash, err := a.DB.UserByEmail(r.Context(), email)
	if err != nil {
		JSONError(w, 401, "invalid credentials")
		return
	}
	if !auth.CheckPassword(hash, b.Password) {
		JSONError(w, 401, "invalid credentials")
		return
	}
	tok, exp, err := a.makeToken(r.Context(), uid, email)
	if err != nil {
		JSONError(w, 500, "token")
		return
	}
	u, _ := a.DB.UserByID(r.Context(), uid)
	JSON(w, 200, tokenResp{Token: tok, ExpiresAt: exp, User: u})
}

func (a *App) makeToken(_ context.Context, id uuid.UUID, email string) (string, time.Time, error) {
	exp := time.Now().Add(config.JWTExpiry)
	t, err := auth.SignToken(a.jwt, id, email, exp)
	if err != nil {
		return "", time.Time{}, err
	}
	return t, exp, nil
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	u, err := a.DB.UserByID(r.Context(), uid)
	if err != nil {
		JSONError(w, 404, "user")
		return
	}
	JSON(w, 200, u)
}
