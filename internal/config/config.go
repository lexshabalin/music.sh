package config

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// jwtSecretFile stores the signing key under DataDir across restarts when JWT_SECRET env is unset.
const jwtSecretFile = ".jwt_secret"

const minPersistedJWTSecretLen = 16

type Config struct {
	HTTPAddr      string
	DatabaseURL   string
	JWTSecret     string
	MusicDir      string
	DataDir       string
	CORSOrigins   []string
	MigrationPath string
	AcoustIDKey   string
}

func Load() (*Config, error) {
	var co []string
	if v := os.Getenv("CORS_ORIGIN"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if t := strings.TrimSpace(s); t != "" {
				co = append(co, t)
			}
		}
	}
	c := &Config{
		HTTPAddr:    env("HTTP_ADDR", "0.0.0.0:8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		MusicDir:    env("MUSIC_DIR", "/music"),
		DataDir:     env("DATA_DIR", "/data"),
		CORSOrigins: co,
		AcoustIDKey: os.Getenv("ACOUSTID_KEY"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	envJWT := strings.TrimSpace(c.JWTSecret)
	if envJWT != "" && len(envJWT) < minPersistedJWTSecretLen {
		return nil, fmt.Errorf("JWT_SECRET is too short (need at least %d characters)", minPersistedJWTSecretLen)
	}
	return c, nil
}

// ResolveJWTSecret fills JWTSecret when empty: prefers JWT_SECRET env (already loaded in Load),
// otherwise reads or creates $DataDir/.jwt_secret. Caller must ensure DataDir exists as a directory (e.g. MkdirAll).
func ResolveJWTSecret(c *Config) error {
	sec := strings.TrimSpace(c.JWTSecret)
	if sec != "" {
		c.JWTSecret = sec
		return nil
	}
	path := filepath.Join(c.DataDir, jwtSecretFile)
	b, err := os.ReadFile(path)
	if err == nil {
		got := strings.TrimSpace(string(b))
		if len(got) >= minPersistedJWTSecretLen {
			c.JWTSecret = got
			return nil
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("read jwt secret file: %w", err)
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("jwt secret random: %w", err)
	}
	newSec := base64.RawURLEncoding.EncodeToString(raw)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(newSec+"\n"), 0o600); err != nil {
		return fmt.Errorf("write jwt secret: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("jwt secret rename: %w", err)
	}
	c.JWTSecret = newSec
	return nil
}

const JWTExpiry = 7 * 24 * time.Hour

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
