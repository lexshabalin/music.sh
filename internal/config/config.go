package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr      string
	DatabaseURL   string
	JWTSecret     string
	MusicDir      string
	DataDir       string
	CORSOrigins   []string
	MigrationPath string
}

func Load() (*Config, error) {
	var co []string
	if v := os.Getenv("CORS_ORIGIN"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if t := strings.TrimSpace(s); t != "" {
				co = append(co, t)
			}
		}
	} else {
		co = []string{"*"} // self-hosted: allow any origin; override for production
	}
	if len(co) == 0 {
		co = []string{"*"}
	}
	c := &Config{
		HTTPAddr:    env("HTTP_ADDR", "0.0.0.0:8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   os.Getenv("JWT_SECRET"),
		MusicDir:    env("MUSIC_DIR", "/music"),
		DataDir:     env("DATA_DIR", "/data"),
		CORSOrigins: co,
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	return c, nil
}

const JWTExpiry = 7 * 24 * time.Hour

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
