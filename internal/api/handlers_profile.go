package api

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"musicsh/internal/auth"
)

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

