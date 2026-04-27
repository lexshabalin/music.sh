package db

import (
	"context"
	"embed"
	"fmt"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// MigrateUp applies embedded SQL files (001_name.sql, 002_...) in order, once.
func MigrateUp(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version     INT PRIMARY KEY,
		applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return err
	}

	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		ver, ok := parseVersion(name)
		if !ok {
			continue
		}
		var dummy int
		err = pool.QueryRow(ctx, `SELECT 1 FROM schema_migrations WHERE version = $1`, ver).Scan(&dummy)
		if err == nil {
			continue
		}
		if err != pgx.ErrNoRows {
			return err
		}

		p := path.Join("migrations", name)
		sqlBytes, err := migrationFS.ReadFile(p)
		if err != nil {
			return err
		}
		_, err = pool.Exec(ctx, string(sqlBytes))
		if err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`, ver)
		if err != nil {
			return err
		}
	}
	return nil
}

func parseVersion(name string) (int, bool) {
	i := strings.IndexByte(name, '_')
	if i <= 0 {
		return 0, false
	}
	n, err := strconv.Atoi(name[:i])
	if err != nil {
		return 0, false
	}
	return n, true
}
