package api

import (
	"context"
	"log"
	"net"
	"net/http"
	"regexp"
	"sync/atomic"
	"sync"
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

	scanMu    sync.Mutex
	scanState scanState
}

type scanState struct {
	Running      bool      `json:"running"`
	StartedAt    time.Time `json:"startedAt"`
	FinishedAt   time.Time `json:"finishedAt"`
	ScannedFiles int       `json:"scannedFiles"`
	FoundTracks  int       `json:"foundTracks"`
	Changed      int       `json:"changed"`
	Error        string    `json:"error,omitempty"`
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
	r.Use(accessLogNoQuery())
	r.Use(securityHeaders())

	// CORS is opt-in. Default (no middleware) is safest for same-origin deployments.
	if len(a.Orig) > 0 {
		c := cors.New(cors.Options{
			AllowedOrigins:   a.Orig,
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Content-Type", "Authorization"},
			ExposedHeaders:   []string{},
			AllowCredentials: true,
			MaxAge:           86400,
		})
		r.Use(c.Handler)
	}

	r.Get("/api/healthz", a.health)

	// Rate-limit auth endpoints to reduce brute-force / abuse.
	r.Group(func(g chi.Router) {
		g.Use(rateLimitByIP(10, 5*time.Minute))
		g.Post("/api/auth/register", a.register)
		g.Post("/api/auth/login", a.login)
	})
	r.Get("/api/tracks/{id}/stream", a.stream) // may use ?token= for <audio>
	r.Get("/api/albums/{id}/cover", a.albumCover)
	r.Get("/api/me/background", a.getBackgroundAsset)

	r.Group(func(g chi.Router) {
		g.Use(middlewareUser(a))
		g.Get("/api/me", a.me)
		g.Get("/api/me/avatar", a.getAvatar)
		g.Post("/api/me/avatar", a.uploadAvatar)
		g.Get("/api/me/background/settings", a.getBackgroundSettings)
		g.Post("/api/me/background/settings", a.setBackgroundSettings)
		g.Post("/api/me/background/upload", a.uploadBackground)
		g.Post("/api/me/password", a.changePassword)
		g.Get("/api/me/playback", a.getPlayback)
		g.Put("/api/me/playback", a.putPlayback)
		g.Post("/api/me/playback/takeover", a.takeoverPlayback)
		g.Delete("/api/me/playback", a.deletePlayback)
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
		g.Get("/api/library/scan/status", a.scanStatus)
	})
	return r
}

func accessLogNoQuery() func(http.Handler) http.Handler {
	var seq uint64
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			id := atomic.AddUint64(&seq, 1)
			// Intentionally log only path (no query string) to avoid leaking secrets like ?token=.
			ip := clientIP(r)
			rid := chimw.GetReqID(r.Context())
			log.Printf(
				"req=%d rid=%s method=%s path=%s status=%d bytes=%d dur=%s ip=%s",
				id,
				rid,
				r.Method,
				r.URL.Path,
				ww.Status(),
				ww.BytesWritten(),
				time.Since(start).Truncate(time.Millisecond),
				ip,
			)
		})
	}
}

func securityHeaders() func(http.Handler) http.Handler {
	// Keep this compatible with the current app: no breaking CSP like 'unsafe-inline' removal yet.
	// (The web UI uses static assets built by Vite; add stricter CSP later if you control all inline usage.)
	const csp = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; media-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", csp)
			w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
			next.ServeHTTP(w, r)
		})
	}
}

type ipLimiter struct {
	mu    sync.Mutex
	state map[string]*ipBucket
	// cleanup is best-effort; keep it simple for self-hosted use.
}

type ipBucket struct {
	tokens     int
	lastRefill time.Time
}

func rateLimitByIP(burst int, refillEvery time.Duration) func(http.Handler) http.Handler {
	l := &ipLimiter{state: map[string]*ipBucket{}}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			now := time.Now()
			l.mu.Lock()
			b, ok := l.state[ip]
			if !ok {
				b = &ipBucket{tokens: burst, lastRefill: now}
				l.state[ip] = b
			}
			// refill 1 token per interval
			elapsed := now.Sub(b.lastRefill)
			if elapsed >= refillEvery {
				add := int(elapsed / refillEvery)
				if add > 0 {
					b.tokens += add
					if b.tokens > burst {
						b.tokens = burst
					}
					b.lastRefill = b.lastRefill.Add(time.Duration(add) * refillEvery)
				}
			}
			if b.tokens <= 0 {
				l.mu.Unlock()
				JSONError(w, 429, "too many requests")
				return
			}
			b.tokens--
			l.mu.Unlock()
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	// If RemoteAddr has no port (or is malformed), fall back as-is.
	if strings.TrimSpace(r.RemoteAddr) != "" {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return "unknown"
}

func middlewareUser(a *App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, err := a.parseUserIDFromRequest(r)
			if err != nil {
				JSONError(w, 401, "unauthorized")
				return
			}
			// Token can be valid while the user row is gone (e.g. DB reset).
			// Treat that as unauthorized so the UI can re-login.
			if _, err := a.DB.UserByID(r.Context(), uid); err != nil {
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
	Username string  `json:"username"`
	Email    string  `json:"email"`
	Password string  `json:"password"`
	Name     *string `json:"displayName"`
}

type loginBody struct {
	Login    string `json:"login"`
	Username string `json:"username"`
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
	b.Username = strings.TrimSpace(b.Username)
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

	username := strings.ToLower(strings.TrimSpace(b.Username))
	if username == "" {
		// keep existing installs ergonomic: default to email local-part (sanitized)
		username = sanitizeUsername(strings.TrimSpace(strings.SplitN(b.Email, "@", 2)[0]))
	}
	if !isValidUsername(username) {
		// last-resort fallback (should be rare)
		username = "user" + strings.ReplaceAll(id.String()[:8], "-", "")
	}
	if !isValidUsername(username) {
		JSONError(w, 400, "invalid username (3-32 chars: a-z, 0-9, _, -, .)")
		return
	}

	if err := a.DB.CreateUser(r.Context(), id, &username, b.Email, h, b.Name); err != nil {
		if store.IsUniqueViolation(err) {
			JSONError(w, 400, "username or email in use")
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
	setAuthCookie(w, r, tok, exp)
	u, _ := a.DB.UserByID(r.Context(), id)
	JSON(w, 201, tokenResp{Token: tok, ExpiresAt: exp, User: u})
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var b loginBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	login := strings.TrimSpace(b.Login)
	if login == "" {
		login = strings.TrimSpace(b.Username)
	}
	if login == "" {
		login = strings.TrimSpace(b.Email)
	}
	loginLower := strings.ToLower(login)

	var uid uuid.UUID
	var email string
	var hash string
	var err error

	// If input resembles an email, keep email semantics (case-insensitive).
	if strings.Contains(loginLower, "@") {
		uid, email, _, _, hash, err = a.DB.UserAuthByEmail(r.Context(), loginLower)
	} else {
		uid, email, _, _, hash, err = a.DB.UserAuthByUsername(r.Context(), loginLower)
		if err != nil {
			// Backward compatibility: old clients still send email in "email" field,
			// but some users will type their email into a "username" box.
			uid, email, _, _, hash, err = a.DB.UserAuthByEmail(r.Context(), loginLower)
		}
	}
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
	setAuthCookie(w, r, tok, exp)
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

var reUsername = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$`)

func isValidUsername(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	if len(s) < 3 || len(s) > 32 {
		return false
	}
	// must start/end with alnum; allow . _ - inside
	return reUsername.MatchString(s)
}

func sanitizeUsername(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	// map unsupported chars to underscore
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '_' || r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	// trim to alnum at ends (to satisfy isValidUsername)
	out = strings.Trim(out, "._-")
	return out
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	u, err := a.DB.UserByID(r.Context(), uid)
	if err != nil {
		JSONError(w, 404, "user")
		return
	}
	// Attach backgroundUrl if user has a custom background file.
	if u.BackgroundType != nil && *u.BackgroundType == "custom" {
		_, _, rel, mime, _ := a.DB.GetUserBackground(r.Context(), uid)
		if rel != nil && *rel != "" {
			s := "/api/me/background"
			u.BackgroundURL = &s
			if mime != nil && *mime != "" {
				u.BackgroundMime = mime
			}
		}
	}
	JSON(w, 200, u)
}
