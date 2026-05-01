package store

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"musicsh/internal/genres"
)

func (d *DB) findOrCreateGenre(ctx context.Context, label string) (uuid.UUID, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return uuid.Nil, pgx.ErrNoRows
	}
	key := strings.ToLower(label)
	var id uuid.UUID
	err := d.Pool.QueryRow(ctx, `SELECT id FROM library_genres WHERE normalized = $1`, key).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	id = uuid.New()
	_, err = d.Pool.Exec(ctx, `
		INSERT INTO library_genres (id, label, normalized) VALUES ($1, $2, $3)`, id, label, key)
	return id, err
}

// ReplaceAlbumGenres resets album tags from labels (normalized + ordered).
func (d *DB) ReplaceAlbumGenres(ctx context.Context, albumID uuid.UUID, labels []string) error {
	labs := genres.DedupePreserveOrder(labels)
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM album_genres WHERE album_id = $1`, albumID); err != nil {
		return err
	}
	for i, lab := range labs {
		gid, err := d.findOrCreateGenreTx(ctx, tx, lab)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO album_genres (album_id, genre_id, position) VALUES ($1, $2, $3)`,
			albumID, gid, i); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (d *DB) findOrCreateGenreTx(ctx context.Context, tx pgx.Tx, label string) (uuid.UUID, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return uuid.Nil, pgx.ErrNoRows
	}
	key := strings.ToLower(label)
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM library_genres WHERE normalized = $1`, key).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	id = uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO library_genres (id, label, normalized) VALUES ($1, $2, $3)`, id, label, key)
	return id, err
}

// RolloutAlbumGenresToTracks copies album_genres junction to each track & clears manual flag.
func (d *DB) RolloutAlbumGenresToTracks(ctx context.Context, albumID uuid.UUID) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM track_genres WHERE track_id IN (SELECT id FROM tracks WHERE album_id = $1)`, albumID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO track_genres (track_id, genre_id, position)
		SELECT t.id, ag.genre_id, ag.position
		FROM tracks t
		JOIN album_genres ag ON ag.album_id = t.album_id
		WHERE t.album_id = $1`,
		albumID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE tracks SET genres_manual = false WHERE album_id = $1`, albumID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ReplaceTrackGenres replaces track junction; markManual preserves scan-vs-user semantics.
func (d *DB) ReplaceTrackGenres(ctx context.Context, trackID uuid.UUID, labels []string, markManual bool) error {
	labs := genres.DedupePreserveOrder(labels)
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM track_genres WHERE track_id = $1`, trackID); err != nil {
		return err
	}
	for i, lab := range labs {
		gid, err := d.findOrCreateGenreTx(ctx, tx, lab)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO track_genres (track_id, genre_id, position) VALUES ($1, $2, $3)`,
			trackID, gid, i); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE tracks SET genres_manual = $2 WHERE id = $1`, trackID, markManual); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (d *DB) inheritTrackGenresFromAlbum(ctx context.Context, trackID uuid.UUID) error {
	if _, err := d.Pool.Exec(ctx, `DELETE FROM track_genres WHERE track_id = $1`, trackID); err != nil {
		return err
	}
	if _, err := d.Pool.Exec(ctx, `
		INSERT INTO track_genres (track_id, genre_id, position)
		SELECT $1::uuid, ag.genre_id, ag.position
		FROM tracks t
		JOIN album_genres ag ON ag.album_id = t.album_id
		WHERE t.id = $1::uuid`,
		trackID); err != nil {
		return err
	}
	_, err := d.Pool.Exec(ctx, `UPDATE tracks SET genres_manual = false WHERE id = $1`, trackID)
	return err
}

// ListGenreSuggestions returns alphabetically sorted labels seen in library.
func (d *DB) ListGenreSuggestions(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT label FROM library_genres ORDER BY lower(label), label LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// sqlGenreTrackMembership is true when genre_id matches displayed track genres
// (track_genres wins over album_genres — same COALESCE semantics as listing).
const sqlGenreTrackMembership = `(EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id AND tg.genre_id = lg.id)
  OR (NOT EXISTS (SELECT 1 FROM track_genres tg2 WHERE tg2.track_id = t.id)
    AND EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = t.album_id AND ag.genre_id = lg.id)))`

// ListGenresCatalog returns genres that appear on at least one track, sorted by label.
func (d *DB) ListGenresCatalog(ctx context.Context, limit int) ([]GenreCatalogEntry, error) {
	if limit <= 0 {
		limit = 500
	}
	q := `
		SELECT lg.id, lg.label, COUNT(DISTINCT t.id)::int AS track_count
		FROM library_genres lg
		INNER JOIN tracks t ON ` + sqlGenreTrackMembership + `
		GROUP BY lg.id, lg.label
		ORDER BY lower(lg.label), lg.label
		LIMIT $1`
	rows, err := d.Pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GenreCatalogEntry
	for rows.Next() {
		var e GenreCatalogEntry
		if err := rows.Scan(&e.ID, &e.Label, &e.TrackCount); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LibraryGenreLabel resolves a canonical genre row by id for UI titles.
func (d *DB) LibraryGenreLabel(ctx context.Context, id uuid.UUID) (string, error) {
	var lab string
	err := d.Pool.QueryRow(ctx, `SELECT label FROM library_genres WHERE id = $1`, id).Scan(&lab)
	return lab, err
}

func (d *DB) albumHasGenreTags(ctx context.Context, albumID uuid.UUID) bool {
	var ok bool
	_ = d.Pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM album_genres WHERE album_id = $1)`, albumID).Scan(&ok)
	return ok
}

// RecordGenreLabelsFromTaggedText inserts distinct labels into library_genres without attaching them to tracks.
// Used so autocomplete sees vocabulary from scanned file tags even when mergeTrackGenresFromScan skips junction updates.
func (d *DB) RecordGenreLabelsFromTaggedText(ctx context.Context, genreFromTag string) {
	genreFromTag = strings.TrimSpace(genreFromTag)
	if genreFromTag == "" {
		return
	}
	for _, lab := range genres.Split(genreFromTag) {
		_, _ = d.findOrCreateGenre(ctx, lab)
	}
}

func (d *DB) mergeTrackGenresFromScan(ctx context.Context, trackID uuid.UUID, albumID uuid.UUID, genreFromTag string) error {
	genreFromTag = strings.TrimSpace(genreFromTag)
	if genreFromTag == "" {
		return nil
	}
	d.RecordGenreLabelsFromTaggedText(ctx, genreFromTag)
	var manual bool
	if err := d.Pool.QueryRow(ctx, `SELECT genres_manual FROM tracks WHERE id = $1`, trackID).Scan(&manual); err != nil {
		return err
	}
	if manual || d.albumHasGenreTags(ctx, albumID) {
		return nil
	}
	parts := genres.Split(genreFromTag)
	var nextPos int
	if err := d.Pool.QueryRow(ctx,
		`SELECT COALESCE(MAX(position), -1) + 1 FROM track_genres WHERE track_id = $1`, trackID).Scan(&nextPos); err != nil {
		nextPos = 0
	}
	for _, lab := range parts {
		gid, err := d.findOrCreateGenre(ctx, lab)
		if err != nil || gid == uuid.Nil {
			continue
		}
		res, err := d.Pool.Exec(ctx, `
			INSERT INTO track_genres (track_id, genre_id, position) VALUES ($1, $2, $3)
			ON CONFLICT (track_id, genre_id) DO NOTHING`,
			trackID, gid, nextPos)
		if err != nil {
			return err
		}
		if res.RowsAffected() > 0 {
			nextPos++
		}
	}
	return nil
}
