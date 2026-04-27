package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"musicsh/internal/api"
	"musicsh/internal/config"
	"musicsh/internal/db"
	"musicsh/internal/mb"
	"musicsh/internal/store"
	"musicsh/internal/worker"
)

//go:embed all:dist
var static embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	_ = os.MkdirAll(cfg.DataDir, 0o755)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal("db: ", err)
	}
	defer pool.Close()

	if err = db.MigrateUp(ctx, pool); err != nil {
		log.Fatal("migrate: ", err)
	}
	st := &store.DB{Pool: pool}
	if err = st.ResetStuckRunningJobs(ctx); err != nil {
		log.Printf("reset jobs: %v", err)
	}
	if os.Getenv("SCAN_ON_START") == "1" {
		_ = st.EnqueueJob(ctx, uuid.New(), "scan", "{}")
	}
	app := api.New(cfg, st)
	h := app.Handlers()
	h = withStatic(h, static)

	wh := &worker.Worker{
		DB: st,
		MB: mb.New(),
		Cfg: worker.Config{MusicDir: cfg.MusicDir, DataDir: cfg.DataDir},
	}
	go wh.Run(ctx)

	s := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           h,
		ReadHeaderTimeout: 20 * time.Second,
		ReadTimeout:       30 * time.Second,
		// Streaming endpoints can legitimately run longer; avoid breaking audio by keeping WriteTimeout disabled.
		WriteTimeout: 0,
		IdleTimeout:  60 * time.Second,
		MaxHeaderBytes: 1 << 20,
	}
	go func() {
		if err = s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	log.Printf("listening on %s", cfg.HTTPAddr)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	_ = s.Shutdown(ctx)
}

func withStatic(h http.Handler, d embed.FS) http.Handler {
	sfs, err := fs.Sub(d, "dist")
	if err != nil {
		return h
	}
	files := http.StripPrefix("/", http.FileServer(http.FS(sfs)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			h.ServeHTTP(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}
