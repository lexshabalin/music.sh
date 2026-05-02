package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DeleteLibraryTrack removes one track row (playlists/likes cascades DB-side).
func (d *DB) DeleteLibraryTrack(ctx context.Context, id uuid.UUID) error {
	tag, err := d.Pool.Exec(ctx, `DELETE FROM tracks WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// DeleteLibraryAlbum removes all tracks on the album then the album shell.
func (d *DB) DeleteLibraryAlbum(ctx context.Context, albumID uuid.UUID) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM tracks WHERE album_id = $1`, albumID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM albums WHERE id = $1`, albumID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

// DeleteLibraryArtist removes tracks under this artist/album linkage, then albums, then the artist row.
func (d *DB) DeleteLibraryArtist(ctx context.Context, artistID uuid.UUID) error {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `
		DELETE FROM tracks
		WHERE artist_id = $1 OR album_id IN (SELECT id FROM albums WHERE artist_id = $1)
	`, artistID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM albums WHERE artist_id = $1`, artistID); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM artists WHERE id = $1`, artistID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

// AfterLibraryEntityDelete runs shared cleanup hooks.
func (d *DB) AfterLibraryEntityDelete(ctx context.Context) error {
	_ = d.PrunePlaybackQueuesRemovedTracks(ctx)
	return d.CleanupOrphanAlbums(ctx)
}
