package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"musicsh/internal/auth"
	"musicsh/internal/store"
)

type patchProfileBody struct {
	Username    *string `json:"username"`
	DisplayName *string `json:"displayName"`
}

func (a *App) patchProfile(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b patchProfileBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	if b.Username == nil && b.DisplayName == nil {
		JSONError(w, 400, "nothing to update")
		return
	}
	var usernamePtr *string
	if b.Username != nil {
		u := strings.ToLower(strings.TrimSpace(*b.Username))
		if !isValidUsername(u) {
			JSONError(w, 400, "invalid username (2-32 chars: a-z, 0-9, _, -, .)")
			return
		}
		usernamePtr = &u
	}
	if err := a.DB.UpdateUserProfile(r.Context(), uid, usernamePtr, b.DisplayName); err != nil {
		if store.IsUniqueViolation(err) {
			JSONError(w, 400, "username in use")
			return
		}
		JSONError(w, 500, "db")
		return
	}
	u, err := a.DB.UserByID(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, u)
}

type uiLangBody struct {
	Lang string `json:"lang"`
}

func (a *App) setUILang(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b uiLangBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	lang := strings.ToLower(strings.TrimSpace(b.Lang))
	if lang != "ru" && lang != "en" {
		JSONError(w, 400, "invalid lang")
		return
	}
	if err := a.DB.SetUserUILang(r.Context(), uid, lang); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"ok": true, "uiLang": lang})
}

type changePasswordBody struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b changePasswordBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	if len(b.NewPassword) < 8 {
		JSONError(w, 400, "password too short (min 8 chars)")
		return
	}
	hash, err := a.DB.PasswordHashByUserID(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	if !auth.CheckPassword(hash, b.CurrentPassword) {
		JSONError(w, 401, "invalid credentials")
		return
	}
	newHash, err := auth.HashPassword(b.NewPassword)
	if err != nil {
		JSONError(w, 500, "hash")
		return
	}
	if err := a.DB.UpdatePasswordHash(r.Context(), uid, newHash); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"ok": true})
}

func (a *App) avatarPathFor(uid string) string {
	return filepath.Join(a.DataDir, "avatars", uid+".png")
}

func (a *App) getAvatar(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	p := a.avatarPathFor(uid.String())
	if _, err := os.Stat(p); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, p)
}

func (a *App) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	// limit memory usage; actual max is controlled by server + reverse proxy too
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		JSONError(w, 400, "bad multipart")
		return
	}
	f, _, err := r.FormFile("avatar")
	if err != nil {
		JSONError(w, 400, "avatar required")
		return
	}
	defer f.Close()

	// Basic validation by sniffing content-type
	buf := make([]byte, 512)
	n, _ := io.ReadFull(f, buf)
	ct := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(ct, "image/") {
		JSONError(w, 400, "invalid image")
		return
	}
	// Only accept png/jpg/webp; we store as png for simplicity.
	if ct != "image/png" && ct != "image/jpeg" && ct != "image/webp" {
		JSONError(w, 400, "unsupported image type")
		return
	}

	dir := filepath.Join(a.DataDir, "avatars")
	_ = os.MkdirAll(dir, 0o755)
	dst := a.avatarPathFor(uid.String())
	tmp := dst + ".tmp"

	out, err := os.Create(tmp)
	if err != nil {
		JSONError(w, 500, "write")
		return
	}
	_, _ = out.Write(buf[:n])
	_, err = io.Copy(out, f)
	_ = out.Close()
	if err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	_ = os.Rename(tmp, dst)
	JSON(w, 200, map[string]any{"ok": true})
}

// --- Backgrounds ---

type bgSettingsBody struct {
	Type   string `json:"type"`   // preset|custom|none
	Preset string `json:"preset"` // preset id
}

func (a *App) getBackgroundSettings(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	t, p, rel, mime, err := a.DB.GetUserBackground(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	out := map[string]any{
		"type":   "none",
		"preset": "",
		"url":    "",
		"mime":   "",
	}
	if t != nil {
		out["type"] = *t
	}
	if p != nil {
		out["preset"] = *p
	}
	if rel != nil && *rel != "" {
		out["url"] = "/api/me/background"
	}
	if mime != nil {
		out["mime"] = *mime
	}
	JSON(w, 200, out)
}

func (a *App) setBackgroundSettings(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	var b bgSettingsBody
	if err := ReadJSON(r, &b); err != nil {
		JSONError(w, 400, "bad json")
		return
	}
	switch strings.TrimSpace(b.Type) {
	case "", "none":
		if err := a.DB.SetUserBackgroundPreset(r.Context(), uid, ""); err != nil {
			JSONError(w, 500, "db")
			return
		}
		JSON(w, 200, map[string]any{"ok": true})
		return
	case "preset":
		p := strings.TrimSpace(b.Preset)
		if p == "" {
			JSONError(w, 400, "preset required")
			return
		}
		if err := a.DB.SetUserBackgroundPreset(r.Context(), uid, p); err != nil {
			JSONError(w, 500, "db")
			return
		}
		JSON(w, 200, map[string]any{"ok": true})
		return
	case "custom":
		// Custom is set via upload endpoint.
		JSON(w, 200, map[string]any{"ok": true})
		return
	default:
		JSONError(w, 400, "invalid type")
		return
	}
}

func (a *App) bgPathFor(uid string, ext string) (abs string, rel string) {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == "" {
		ext = ".bin"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	rel = filepath.Join("backgrounds", uid+ext)
	abs = filepath.Join(a.DataDir, rel)
	return
}

func (a *App) uploadBackground(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r.Context())
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		JSONError(w, 400, "bad multipart")
		return
	}
	f, hdr, err := r.FormFile("background")
	if err != nil {
		JSONError(w, 400, "background required")
		return
	}
	defer f.Close()

	buf := make([]byte, 512)
	n, _ := io.ReadFull(f, buf)
	ct := http.DetectContentType(buf[:n])

	ok := ct == "image/png" || ct == "image/jpeg" || ct == "image/webp" || ct == "image/gif"
	if !ok {
		JSONError(w, 400, "unsupported background type")
		return
	}

	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if ext == "" {
		// best-effort mapping
		switch ct {
		case "image/png":
			ext = ".png"
		case "image/jpeg":
			ext = ".jpg"
		case "image/webp":
			ext = ".webp"
		case "image/gif":
			ext = ".gif"
		default:
			ext = ".bin"
		}
	}

	abs, rel := a.bgPathFor(uid.String(), ext)
	_ = os.MkdirAll(filepath.Dir(abs), 0o755)
	tmp := abs + ".tmp"
	out, err := os.Create(tmp)
	if err != nil {
		JSONError(w, 500, "write")
		return
	}
	_, _ = out.Write(buf[:n])
	_, err = io.Copy(out, f)
	_ = out.Close()
	if err != nil {
		_ = os.Remove(tmp)
		JSONError(w, 500, "write")
		return
	}
	_ = os.Rename(tmp, abs)
	if err := a.DB.SetUserBackgroundFile(r.Context(), uid, rel, ct); err != nil {
		JSONError(w, 500, "db")
		return
	}
	JSON(w, 200, map[string]any{"ok": true, "url": "/api/me/background", "mime": ct})
}

func (a *App) getBackgroundAsset(w http.ResponseWriter, r *http.Request) {
	uid, err := a.parseUserIDFromMediaRequest(r)
	if err != nil {
		JSONError(w, 401, "unauthorized")
		return
	}
	t, _, rel, mime, err := a.DB.GetUserBackground(r.Context(), uid)
	if err != nil {
		JSONError(w, 500, "db")
		return
	}
	if t == nil || *t != "custom" || rel == nil || *rel == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	abs := filepath.Join(a.DataDir, *rel)
	if _, err := os.Stat(abs); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if mime != nil && *mime != "" {
		w.Header().Set("Content-Type", *mime)
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, abs)
}

