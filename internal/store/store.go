package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

// CountPendingIdentifyJobForTrack returns how many pending/running identify jobs exist for a track.
func (d *DB) CountPendingIdentifyJobForTrack(ctx context.Context, trackID uuid.UUID) (int, error) {
	var n int
	err := d.Pool.QueryRow(ctx, `
		SELECT count(*) FROM jobs
		WHERE type = 'identify_track'
		  AND status IN ('pending','running')
		  AND payload->>'trackId' = $1
	`, trackID.String()).Scan(&n)
	return n, err
}

// EnsureIdentifyTrackJob enqueues identify_track if not already pending/running.
func (d *DB) EnsureIdentifyTrackJob(ctx context.Context, trackID uuid.UUID) error {
	c, err := d.CountPendingIdentifyJobForTrack(ctx, trackID)
	if err != nil {
		return err
	}
	if c > 0 {
		return nil
	}
	payload := fmt.Sprintf(`{"trackId":"%s"}`, trackID.String())
	return d.EnqueueJob(ctx, uuid.New(), "identify_track", payload)
}

// EnsureFetchAlbumJob enqueues fetch_album for an album if not already pending/running.
func (d *DB) EnsureFetchAlbumJob(ctx context.Context, albumID uuid.UUID) error {
	c, err := d.CountPendingMetaJobForAlbum(ctx, albumID)
	if err != nil {
		return err
	}
	if c > 0 {
		return nil
	}
	payload := fmt.Sprintf(`{"albumId":"%s"}`, albumID.String())
	return d.EnqueueJob(ctx, uuid.New(), "fetch_album", payload)
}

// TrackIdentifyInput returns file path and current metadata for identification.
func (d *DB) TrackIdentifyInput(ctx context.Context, id uuid.UUID) (filePath string, title *string, durationMs *int, artistName string, albumTitle string, mbRecordingID *string, err error) {
	var t sql.NullString
	var dur sql.NullInt32
	var arn sql.NullString
	var alb sql.NullString
	var rec sql.NullString
	err = d.Pool.QueryRow(ctx, `
		SELECT tr.file_path, tr.title, tr.duration_ms, ar.name, al.title, tr.mb_recording_id
		FROM tracks tr
		LEFT JOIN artists ar ON tr.artist_id = ar.id
		LEFT JOIN albums  al ON tr.album_id = al.id
		WHERE tr.id = $1
	`, id).Scan(&filePath, &t, &dur, &arn, &alb, &rec)
	if err != nil {
		return
	}
	if t.Valid && strings.TrimSpace(t.String) != "" {
		s := t.String
		title = &s
	}
	if dur.Valid && dur.Int32 > 0 {
		x := int(dur.Int32)
		durationMs = &x
	}
	if arn.Valid {
		artistName = arn.String
	}
	if alb.Valid {
		albumTitle = alb.String
	}
	if rec.Valid && strings.TrimSpace(rec.String) != "" {
		s := rec.String
		mbRecordingID = &s
	}
	return
}

// ApplyIdentifiedMeta updates a track based on identification results.
// Only overwrites fields that are empty/unknown.
func (d *DB) ApplyIdentifiedMeta(ctx context.Context, trackID uuid.UUID, title, artist, album string, year *int, mbRecordingID string) (albumID uuid.UUID, err error) {
	artist = strings.TrimSpace(artist)
	album = strings.TrimSpace(album)
	title = strings.TrimSpace(title)

	// read current
	var curTitle sql.NullString
	var curArtist sql.NullString
	var curAlbum sql.NullString
	var curYear sql.NullInt32
	err = d.Pool.QueryRow(ctx, `
		SELECT tr.title, ar.name, al.title, tr.year
		FROM tracks tr
		LEFT JOIN artists ar ON tr.artist_id = ar.id
		LEFT JOIN albums  al ON tr.album_id = al.id
		WHERE tr.id = $1
	`, trackID).Scan(&curTitle, &curArtist, &curAlbum, &curYear)
	if err != nil {
		return uuid.Nil, err
	}

	shouldSetTitle := !curTitle.Valid || strings.TrimSpace(curTitle.String) == ""
	shouldSetArtist := !curArtist.Valid || strings.EqualFold(strings.TrimSpace(curArtist.String), "unknown artist") || strings.TrimSpace(curArtist.String) == ""
	shouldSetAlbum := !curAlbum.Valid || strings.EqualFold(strings.TrimSpace(curAlbum.String), "unknown") || strings.TrimSpace(curAlbum.String) == ""
	shouldSetYear := !curYear.Valid

	newTitle := curTitle.String
	if shouldSetTitle && title != "" {
		newTitle = title
	}
	useArtist := curArtist.String
	if shouldSetArtist && artist != "" {
		useArtist = artist
	}
	useAlbum := curAlbum.String
	if shouldSetAlbum && album != "" {
		useAlbum = album
	}
	var useYear *int
	if shouldSetYear && year != nil && *year > 0 {
		useYear = year
	} else if curYear.Valid {
		y := int(curYear.Int32)
		useYear = &y
	}

	if strings.TrimSpace(useArtist) == "" {
		useArtist = "Unknown Artist"
	}
	if strings.TrimSpace(useAlbum) == "" {
		useAlbum = "Unknown"
	}

	artistID, e := d.FindOrCreateArtist(ctx, useArtist)
	if e != nil {
		return uuid.Nil, e
	}
	albID, e := d.FindOrCreateAlbum(ctx, &artistID, useAlbum, useYear)
	if e != nil {
		return uuid.Nil, e
	}
	albumID = albID

	var rec any = nil
	if strings.TrimSpace(mbRecordingID) != "" {
		rec = strings.TrimSpace(mbRecordingID)
	}

	_, err = d.Pool.Exec(ctx, `
		UPDATE tracks
		SET title = $2, artist_id = $3, album_id = $4, year = $5,
		    mb_recording_id = COALESCE($6, mb_recording_id),
		    identified_at = now()
		WHERE id = $1
	`, trackID, newTitle, artistID, albID, useYear, rec)
	return albumID, err
}

// UserAuthByEmail returns auth fields needed for login.
func (d *DB) UserAuthByEmail(ctx context.Context, email string) (id uuid.UUID, emailOut string, username *string, displayName *string, hash string, err error) {
	var uname sql.NullString
	var name sql.NullString
	err = d.Pool.QueryRow(ctx,
		`SELECT id, email, username, display_name, password_hash FROM users WHERE email = $1`,
		strings.ToLower(strings.TrimSpace(email)),
	).Scan(&id, &emailOut, &uname, &name, &hash)
	if err != nil {
		return uuid.Nil, "", nil, nil, "", err
	}
	if uname.Valid && strings.TrimSpace(uname.String) != "" {
		s := uname.String
		username = &s
	}
	if name.Valid && strings.TrimSpace(name.String) != "" {
		s := name.String
		displayName = &s
	}
	return id, emailOut, username, displayName, hash, nil
}

// UserAuthByUsername returns auth fields needed for login.
func (d *DB) UserAuthByUsername(ctx context.Context, username string) (id uuid.UUID, emailOut string, usernameOut *string, displayName *string, hash string, err error) {
	var uname sql.NullString
	var name sql.NullString
	err = d.Pool.QueryRow(ctx,
		`SELECT id, email, username, display_name, password_hash FROM users WHERE username = $1`,
		strings.TrimSpace(username),
	).Scan(&id, &emailOut, &uname, &name, &hash)
	if err != nil {
		return uuid.Nil, "", nil, nil, "", err
	}
	if uname.Valid && strings.TrimSpace(uname.String) != "" {
		s := uname.String
		usernameOut = &s
	}
	if name.Valid && strings.TrimSpace(name.String) != "" {
		s := name.String
		displayName = &s
	}
	return id, emailOut, usernameOut, displayName, hash, nil
}

func (d *DB) CreateUser(ctx context.Context, id uuid.UUID, username *string, email, hash string, name *string) error {
	_, err := d.Pool.Exec(ctx,
		`INSERT INTO users (id, username, email, password_hash, display_name) VALUES ($1, $2, $3, $4, $5)`,
		id, username, strings.ToLower(strings.TrimSpace(email)), hash, name,
	)
	return err
}

func (d *DB) UserByID(ctx context.Context, id uuid.UUID) (User, error) {
	var u User
	var uname sql.NullString
	var name sql.NullString
	err := d.Pool.QueryRow(ctx,
		`SELECT id, username, email, display_name, created_at FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &uname, &u.Email, &name, &u.CreatedAt)
	if err != nil {
		return u, err
	}
	if uname.Valid && strings.TrimSpace(uname.String) != "" {
		s := uname.String
		u.Username = &s
	}
	if name.Valid {
		s := name.String
		u.DisplayName = &s
	}
	return u, nil
}

func (d *DB) PasswordHashByUserID(ctx context.Context, id uuid.UUID) (string, error) {
	var h string
	err := d.Pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, id).Scan(&h)
	return h, err
}

func (d *DB) UpdatePasswordHash(ctx context.Context, id uuid.UUID, newHash string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, id, newHash)
	return err
}

// FindOrCreateArtist returns an artist by exact name (case-insensitive first look).
func (d *DB) FindOrCreateArtist(ctx context.Context, name string) (uuid.UUID, error) {
	if strings.TrimSpace(name) == "" {
		name = "Unknown"
	}
	var id uuid.UUID
	err := d.Pool.QueryRow(ctx, `SELECT id FROM artists WHERE lower(name) = lower($1) LIMIT 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return uuid.UUID{}, err
	}
	aid := uuid.New()
	_, err = d.Pool.Exec(ctx,
		`INSERT INTO artists (id, name, name_search) VALUES ($1, $2, $3)`,
		aid, name, normalizeSearch(name),
	)
	if err != nil {
		return uuid.UUID{}, err
	}
	return aid, nil
}

func (d *DB) FindOrCreateAlbum(ctx context.Context, artistID *uuid.UUID, title string, year *int) (uuid.UUID, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		t = "Unknown"
	}
	ts := normalizeSearch(t)
	// find existing: same title + same artist
	if artistID != nil {
		var id uuid.UUID
		err := d.Pool.QueryRow(ctx, `
			SELECT id FROM albums
			WHERE artist_id = $1 AND title_search = $2
			LIMIT 1
		`, *artistID, ts).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err != pgx.ErrNoRows {
			return uuid.UUID{}, err
		}
	} else {
		var id uuid.UUID
		err := d.Pool.QueryRow(ctx, `
			SELECT id FROM albums WHERE artist_id IS NULL AND title_search = $1 LIMIT 1
		`, ts).Scan(&id)
		if err == nil {
			return id, nil
		}
		if err != pgx.ErrNoRows {
			return uuid.UUID{}, err
		}
	}
	aid := uuid.New()
	_, err := d.Pool.Exec(ctx, `
		INSERT INTO albums (id, artist_id, title, title_search, year) VALUES ($1, $2, $3, $4, $5)
	`, aid, artistID, t, ts, year)
	if err != nil {
		return uuid.UUID{}, err
	}
	return aid, nil
}

// UpsertTrack reads metadata from the scanner and inserts or updates a file row.
func (d *DB) UpsertTrack(
	ctx context.Context,
	filePath string,
	fileSize, mtimeNs int64,
	artistName, albumArtistName, albumTitle, title string,
	trackNo, discNo, year *int,
	durationMS *int,
	format *string,
	bitrateKbps *int,
) (trackID, albumID uuid.UUID, isNewOrChanged bool, err error) {
	artistID, err := d.FindOrCreateArtist(ctx, artistName)
	if err != nil {
		return
	}
	albumArtistID := artistID
	if strings.TrimSpace(albumArtistName) != "" && !strings.EqualFold(strings.TrimSpace(albumArtistName), strings.TrimSpace(artistName)) {
		if aaid, e := d.FindOrCreateArtist(ctx, albumArtistName); e == nil {
			albumArtistID = aaid
		}
	}
	albID, err := d.FindOrCreateAlbum(ctx, &albumArtistID, albumTitle, year)
	if err != nil {
		return
	}
	albumID = albID

	trackTitle := strings.TrimSpace(title)
	if trackTitle == "" {
		trackTitle = baseNameNoExt(filePath)
	}

	var id uuid.UUID
	var oldMtime int64
	var curAlbumID, curArtistID sql.NullString
	err2 := d.Pool.QueryRow(ctx, `SELECT id, file_mtime_ns, album_id::text, artist_id::text FROM tracks WHERE file_path = $1`, filePath).
		Scan(&id, &oldMtime, &curAlbumID, &curArtistID)
	if err2 == nil {
		trackID = id
		// Even if mtime didn't change, the desired album mapping can change (e.g. album-artist normalization).
		sameAlbum := curAlbumID.Valid && curAlbumID.String != "" && curAlbumID.String == albumID.String()
		sameArtist := curArtistID.Valid && curArtistID.String != "" && curArtistID.String == artistID.String()
		if oldMtime == mtimeNs && sameAlbum && sameArtist {
			return trackID, albumID, false, nil
		}
		_, e := d.Pool.Exec(ctx, `
			UPDATE tracks SET
				file_size = $2, file_mtime_ns = $3, duration_ms = $4, title = $5,
				format = $6, bitrate_kbps = $7,
				track_no = $8, disc_no = $9, year = $10, album_id = $11, artist_id = $12
			WHERE id = $1
		`, id, fileSize, mtimeNs, durationMS, trackTitle, format, bitrateKbps, trackNo, discNo, year, albumID, artistID)
		if e != nil {
			err = e
			return
		}
		return trackID, albumID, true, nil
	}
	if err2 != pgx.ErrNoRows {
		return uuid.UUID{}, albumID, false, err2
	}

	trackID = uuid.New()
	isNewOrChanged = true
	_, err = d.Pool.Exec(ctx, `
		INSERT INTO tracks (
			id, file_path, file_size, file_mtime_ns, duration_ms, title, format, bitrate_kbps,
			track_no, disc_no, year, album_id, artist_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, trackID, filePath, fileSize, mtimeNs, durationMS, trackTitle, format, bitrateKbps, trackNo, discNo, year, albumID, artistID)
	if err != nil {
		return
	}
	return
}

// BaseName is filename without extension
func BaseName(p string) string { return baseNameNoExt(p) }

func baseNameNoExt(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		p = p[i+1:]
	}
	if d := strings.LastIndex(p, "."); d > 0 {
		p = p[:d]
	}
	return p
}

func (d *DB) SetAlbumCoverPath(ctx context.Context, albumID uuid.UUID, relPath string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE albums SET cover_path = $2 WHERE id = $1`, albumID, relPath)
	return err
}

func (d *DB) SetMBReleaseID(ctx context.Context, albumID uuid.UUID, mbID string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE albums SET musicbrainz_release_id = $2 WHERE id = $1`, albumID, mbID)
	return err
}

// --- Library queries ---

func (d *DB) ListArtists(ctx context.Context, q string) ([]Artist, error) {
	qn := "%" + normalizeSearch(q) + "%"
	rows, err := d.Pool.Query(ctx, `
		SELECT id, name, musicbrainz_id FROM artists
		WHERE $1 = '' OR name ILIKE $2
		ORDER BY name
	`, strings.TrimSpace(q), qn)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Artist
	for rows.Next() {
		var a Artist
		var mb sql.NullString
		if err = rows.Scan(&a.ID, &a.Name, &mb); err != nil {
			return nil, err
		}
		if mb.Valid {
			s := mb.String
			a.MusicBrainzID = &s
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAlbum returns one album row for the API
func (d *DB) GetAlbum(ctx context.Context, id uuid.UUID) (Album, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT a.id, a.title, a.year, a.artist_id::text, ar.name, a.musicbrainz_release_id, a.cover_path
		FROM albums a
		LEFT JOIN artists ar ON a.artist_id = ar.id
		WHERE a.id = $1
	`, id)
	if err != nil {
		return Album{}, err
	}
	defer rows.Close()
	list, err := scanAlbums(rows)
	if err != nil {
		return Album{}, err
	}
	if len(list) == 0 {
		return Album{}, pgx.ErrNoRows
	}
	return list[0], nil
}

func (d *DB) ListAlbums(ctx context.Context, q string, artistID *uuid.UUID) ([]Album, error) {
	qs := strings.TrimSpace(q)
	like := "%" + qs + "%"
	// Collapse "shell duplicates" that share the same normalized album title/year but were created with
	// different featured-artist strings on the album row.
	//
	// - Library view: artistID is NULL → dedupe across all albums.
	// - Artist view: artistID is set → include albums where the artist appears on tracks OR is the album artist,
	//   then dedupe within that artist's discography slice.
	rows, err := d.Pool.Query(ctx, `
		WITH cand AS (
			SELECT a.*
			FROM albums a
			WHERE ($3::uuid IS NULL OR a.artist_id = $3 OR EXISTS (
				SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.artist_id = $3
			))
		),
		base AS (
			SELECT
				c.*,
					lower(trim(both ' ,;-' FROM regexp_replace(
						regexp_replace(
							COALESCE(ar.name, ''),
							'(?i)[[:space:]]+(feat\\.?|ft\\.?|featuring|w/|vs\\.?|при[[:space:]]+уч\\.|под[[:space:]]+уч\\.|совместно[[:space:]]+с)\\b.*$',
							'',
							'g'
						),
						'(?i)[[:space:]]+(/|&|\\+|×|x|with|w/)[[:space:]]+.*$',
						'',
						'g'
					))) AS artist_key
			FROM cand c
			LEFT JOIN artists ar ON c.artist_id = ar.id
			WHERE ($1 = '' OR c.title ILIKE $2 OR ar.name ILIKE $2)
		),
		ranked AS (
			SELECT
				b.*,
				row_number() OVER (
					PARTITION BY b.title_search, COALESCE(b.year, -1), b.artist_key
					ORDER BY
						(b.cover_path IS NOT NULL AND btrim(b.cover_path) <> '') DESC,
						(SELECT COUNT(*)::int FROM tracks t WHERE t.album_id = b.id) DESC,
						b.created_at ASC,
						b.id ASC
				) AS rn
			FROM base b
		)
		SELECT a.id, a.title, a.year, a.artist_id::text, ar.name, a.musicbrainz_release_id, a.cover_path
		FROM ranked a
		LEFT JOIN artists ar ON a.artist_id = ar.id
		WHERE a.rn = 1
		ORDER BY ar.name NULLS LAST, a.title
	`, qs, like, artistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAlbums(rows)
}

func scanAlbums(rows pgx.Rows) ([]Album, error) {
	var out []Album
	for rows.Next() {
		var a Album
		var y sql.NullInt64
		var aid sql.NullString
		var an sql.NullString
		var mb, cp sql.NullString
		if err := rows.Scan(&a.ID, &a.Title, &y, &aid, &an, &mb, &cp); err != nil {
			return nil, err
		}
		if y.Valid {
			yy := int(y.Int64)
			a.Year = &yy
		}
		if aid.Valid && aid.String != "" {
			uid, err := uuid.Parse(aid.String)
			if err == nil {
				a.ArtistID = &uid
			}
		}
		if an.Valid {
			s := an.String
			a.ArtistName = &s
		}
		if cp.Valid {
			s := cp.String
			a.CoverPath = &s
		}
		if mb.Valid {
			s := mb.String
			a.MusicBrainzRelease = &s
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (d *DB) ListTracks(ctx context.Context, query string, albumID, artistID *uuid.UUID) ([]Track, error) {
	qs := strings.TrimSpace(query)
	like := "%" + qs + "%"
	rows, err := d.Pool.Query(ctx, `
		SELECT
			t.id, t.title, t.duration_ms, t.format, t.bitrate_kbps, t.track_no, t.disc_no, t.year,
			t.album_id::text, al.title,
			t.artist_id::text, ar.name
		FROM tracks t
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		WHERE ($1 = '' OR
			(t.title ILIKE $2) OR
			(al.title ILIKE $2) OR
			(ar.name ILIKE $2) OR
			(t.file_path ILIKE $2))
		AND ($3::uuid IS NULL OR t.album_id = $3)
		AND ($4::uuid IS NULL OR t.artist_id = $4)
		ORDER BY ar.name NULLS LAST, al.title NULLS LAST, t.disc_no NULLS FIRST, t.track_no NULLS FIRST, t.title NULLS FIRST
	`, qs, like, albumID, artistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTrackRows(rows)
}

func scanTrackRows(rows pgx.Rows) ([]Track, error) {
	var out []Track
	for rows.Next() {
		var t Track
		var title sql.NullString
		var dms sql.NullInt32
		var fmtS sql.NullString
		var br sql.NullInt32
		var tno, dno, yr sql.NullInt32
		var aID, alID sql.NullString
		var alT, arN sql.NullString
		if err := rows.Scan(&t.ID, &title, &dms, &fmtS, &br, &tno, &dno, &yr, &aID, &alT, &alID, &arN); err != nil {
			return nil, err
		}
		if title.Valid {
			s := title.String
			t.Title = &s
		}
		if dms.Valid {
			x := int(dms.Int32)
			t.DurationMs = &x
		}
		if fmtS.Valid {
			s := fmtS.String
			t.Format = &s
		}
		if br.Valid {
			x := int(br.Int32)
			t.BitrateKbps = &x
		}
		if tno.Valid {
			x := int(tno.Int32)
			t.TrackNo = &x
		}
		if dno.Valid {
			x := int(dno.Int32)
			t.DiscNo = &x
		}
		if yr.Valid {
			x := int(yr.Int32)
			t.Year = &x
		}
		if aID.Valid && aID.String != "" {
			uid, err := uuid.Parse(aID.String)
			if err == nil {
				tt := ""
				if alT.Valid {
					tt = alT.String
				}
				t.Album = &TrackAlbum{ID: uid, Title: tt}
			}
		}
		if alID.Valid && alID.String != "" {
			uid, err := uuid.Parse(alID.String)
			if err == nil {
				nn := ""
				if arN.Valid {
					nn = arN.String
				}
				t.Artist = &TrackArtist{ID: uid, Name: nn}
			}
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetTrackForStream returns file path, title for logging
func (d *DB) GetTrackForStream(ctx context.Context, id uuid.UUID) (string, *string, error) {
	var path string
	var t sql.NullString
	err := d.Pool.QueryRow(ctx, `SELECT file_path, title FROM tracks WHERE id = $1`, id).Scan(&path, &t)
	if err != nil {
		return "", nil, err
	}
	if t.Valid {
		return path, &t.String, nil
	}
	return path, nil, nil
}

func (d *DB) GetAnyTrackPathForAlbum(ctx context.Context, albumID uuid.UUID) (string, error) {
	var path string
	if err := d.Pool.QueryRow(ctx, `SELECT file_path FROM tracks WHERE album_id = $1 ORDER BY file_path LIMIT 1`, albumID).Scan(&path); err != nil {
		return "", err
	}
	return path, nil
}

// Cover path for album (relative to data dir)
func (d *DB) GetAlbumCoverPath(ctx context.Context, albumID uuid.UUID) (string, error) {
	var cp sql.NullString
	err := d.Pool.QueryRow(ctx, `SELECT cover_path FROM albums WHERE id = $1`, albumID).Scan(&cp)
	if err != nil {
		return "", err
	}
	if !cp.Valid {
		return "", pgx.ErrNoRows
	}
	return cp.String, nil
}

// --- Likes ---

func (d *DB) SetLike(ctx context.Context, userID, trackID uuid.UUID, on bool) error {
	if on {
		_, err := d.Pool.Exec(ctx, `
			INSERT INTO track_likes (user_id, track_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, userID, trackID)
		return err
	}
	_, err := d.Pool.Exec(ctx, `DELETE FROM track_likes WHERE user_id = $1 AND track_id = $2`, userID, trackID)
	return err
}

func (d *DB) ListLikes(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := d.Pool.Query(ctx, `SELECT track_id FROM track_likes WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (d *DB) IsLiked(ctx context.Context, userID, trackID uuid.UUID) (bool, error) {
	var n int
	err := d.Pool.QueryRow(ctx, `SELECT 1 FROM track_likes WHERE user_id = $1 AND track_id = $2`, userID, trackID).Scan(&n)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// --- Playlists ---

func (d *DB) CreatePlaylist(ctx context.Context, id, userID uuid.UUID, name string, description *string) (Playlist, error) {
	now := time.Now()
	_, err := d.Pool.Exec(ctx, `INSERT INTO playlists (id, user_id, name, description, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		id, userID, name, description, now, now)
	if err != nil {
		return Playlist{}, err
	}
	return Playlist{ID: id, Name: name, Description: description, CreatedAt: now, UpdatedAt: now}, nil
}

func (d *DB) UpdatePlaylist(ctx context.Context, userID, plID uuid.UUID, name *string, description *string) error {
	if name == nil && description == nil {
		return nil
	}
	res, err := d.Pool.Exec(ctx, `
		UPDATE playlists
		SET
			name = COALESCE($3, name),
			description = COALESCE($4, description),
			updated_at = now()
		WHERE id = $1 AND user_id = $2
	`, plID, userID, name, description)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (d *DB) DeletePlaylist(ctx context.Context, userID, plID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM playlists WHERE id = $1 AND user_id = $2`, plID, userID)
	return err
}

func (d *DB) ListPlaylists(ctx context.Context, userID uuid.UUID, query string) ([]Playlist, error) {
	qs := strings.TrimSpace(query)
	like := "%" + qs + "%"
	rows, err := d.Pool.Query(ctx, `
		SELECT id, name, description, created_at, updated_at
		FROM playlists
		WHERE user_id = $1
		  AND (
		    $2 = '' OR
		    name ILIKE $3 OR
		    COALESCE(description, '') ILIKE $3
		  )
		ORDER BY name
	`, userID, qs, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Playlist
	for rows.Next() {
		var p Playlist
		var desc sql.NullString
		if err = rows.Scan(&p.ID, &p.Name, &desc, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		if desc.Valid {
			s := desc.String
			p.Description = &s
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (d *DB) GetPlaylist(ctx context.Context, userID, plID uuid.UUID) (Playlist, []Track, error) {
	var p Playlist
	var desc sql.NullString
	err := d.Pool.QueryRow(ctx, `SELECT id, name, description, created_at, updated_at FROM playlists WHERE id = $1 AND user_id = $2`, plID, userID).Scan(
		&p.ID, &p.Name, &desc, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return p, nil, err
	}
	if desc.Valid {
		s := desc.String
		p.Description = &s
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT
			t.id, t.title, t.duration_ms, t.format, t.bitrate_kbps, t.track_no, t.disc_no, t.year,
			t.album_id::text, al.title, t.artist_id::text, ar.name, pt.position
		FROM playlist_tracks pt
		JOIN tracks t ON pt.track_id = t.id
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		WHERE pt.playlist_id = $1
		ORDER BY pt.position
	`, plID)
	if err != nil {
		return p, nil, err
	}
	defer rows.Close()
	var tr []Track
	for rows.Next() {
		var t Track
		var title sql.NullString
		var dms sql.NullInt32
		var fmtS sql.NullString
		var br sql.NullInt32
		var tno, dno, yr sql.NullInt32
		var aID, alID sql.NullString
		var alT, arN sql.NullString
		var pos int
		if err = rows.Scan(&t.ID, &title, &dms, &fmtS, &br, &tno, &dno, &yr, &aID, &alT, &alID, &arN, &pos); err != nil {
			return p, nil, err
		}
		if title.Valid {
			s := title.String
			t.Title = &s
		}
		if dms.Valid {
			x := int(dms.Int32)
			t.DurationMs = &x
		}
		if fmtS.Valid {
			s := fmtS.String
			t.Format = &s
		}
		if br.Valid {
			x := int(br.Int32)
			t.BitrateKbps = &x
		}
		if tno.Valid {
			x := int(tno.Int32)
			t.TrackNo = &x
		}
		if dno.Valid {
			x := int(dno.Int32)
			t.DiscNo = &x
		}
		if yr.Valid {
			x := int(yr.Int32)
			t.Year = &x
		}
		if aID.Valid && aID.String != "" {
			uid, errU := uuid.Parse(aID.String)
			if errU == nil {
				tt := ""
				if alT.Valid {
					tt = alT.String
				}
				t.Album = &TrackAlbum{ID: uid, Title: tt}
			}
		}
		if alID.Valid && alID.String != "" {
			uid, errU := uuid.Parse(alID.String)
			if errU == nil {
				nn := ""
				if arN.Valid {
					nn = arN.String
				}
				t.Artist = &TrackArtist{ID: uid, Name: nn}
			}
		}
		tr = append(tr, t)
	}
	return p, tr, rows.Err()
}

// AddToPlaylist appends a track at the end, or no-op if already in playlist.
func (d *DB) AddToPlaylist(ctx context.Context, userID, plID, trackID uuid.UUID) error {
	var ok int
	if err := d.Pool.QueryRow(ctx, `SELECT 1 FROM playlists WHERE id = $1 AND user_id = $2`, plID, userID).Scan(&ok); err != nil {
		return err
	}
	var pos int
	if err := d.Pool.QueryRow(ctx, `SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = $1`, plID).Scan(&pos); err != nil {
		return err
	}
	_, err := d.Pool.Exec(ctx, `INSERT INTO playlist_tracks (id, playlist_id, track_id, position) VALUES ($1, $2, $3, $4)
		ON CONFLICT (playlist_id, track_id) DO NOTHING`,
		uuid.New(), plID, trackID, pos)
	return err
}

// RemoveFromPlaylist drops a track from a playlist.
func (d *DB) RemoveFromPlaylist(ctx context.Context, userID, plID, trackID uuid.UUID) error {
	res, err := d.Pool.Exec(ctx, `DELETE FROM playlist_tracks pt
		USING playlists p
		WHERE p.id = pt.playlist_id AND p.user_id = $1 AND p.id = $2 AND pt.track_id = $3`,
		userID, plID, trackID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

// --- Jobs ---

func (d *DB) EnqueueJob(ctx context.Context, id uuid.UUID, jtype string, payload string) error {
	_, err := d.Pool.Exec(ctx, `INSERT INTO jobs (id, type, payload) VALUES ($1, $2, $3::jsonb)`, id, jtype, payload)
	return err
}

// ClaimNextJob marks one pending job as running and returns it.
func (d *DB) ClaimNextJob(ctx context.Context) (id uuid.UUID, jtype, payload string, err error) {
	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	err = tx.QueryRow(ctx, `
		WITH cte AS (
			SELECT id FROM jobs
			WHERE status = 'pending' AND run_after <= now()
			ORDER BY created_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE jobs j SET status = 'running' FROM cte
		WHERE j.id = cte.id
		RETURNING j.id, j.type, j.payload::text
	`).Scan(&id, &jtype, &payload)
	if err == pgx.ErrNoRows {
		return uuid.UUID{}, "", "", nil
	}
	if err != nil {
		return
	}
	if err = tx.Commit(ctx); err != nil {
		return
	}
	committed = true
	return
}

func (d *DB) CompleteJob(ctx context.Context, id uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `UPDATE jobs SET status = 'done' WHERE id = $1`, id)
	return err
}

func (d *DB) FailJob(ctx context.Context, id uuid.UUID, msg string) error {
	// Requeue with backoff instead of permanent failure (covers/metadata often fail transiently).
	_, err := d.Pool.Exec(ctx, `
		UPDATE jobs
		SET
			status = 'pending',
			last_error = $2,
			attempts = attempts + 1,
			run_after = now() + (interval '5 seconds' * GREATEST(1, LEAST(12, attempts + 1)))
		WHERE id = $1
	`, id, msg)
	return err
}

// GetAlbumByID for metadata worker
func (d *DB) GetAlbumByID(ctx context.Context, id uuid.UUID) (title string, year *int, artistName string, err error) {
	var y sql.NullInt32
	var arn sql.NullString
	err = d.Pool.QueryRow(ctx, `
		SELECT a.title, a.year, ar.name
		FROM albums a
		LEFT JOIN artists ar ON a.artist_id = ar.id
		WHERE a.id = $1
	`, id).Scan(&title, &y, &arn)
	if y.Valid {
		v := int(y.Int32)
		year = &v
	}
	if arn.Valid {
		artistName = arn.String
	}
	return
}

// AlbumNeedsCover: true if no local cover
func (d *DB) AlbumHasCover(ctx context.Context, id uuid.UUID) (bool, error) {
	var cp sql.NullString
	if err := d.Pool.QueryRow(ctx, `SELECT cover_path FROM albums WHERE id = $1`, id).Scan(&cp); err != nil {
		return false, err
	}
	return cp.Valid && strings.TrimSpace(cp.String) != "", nil
}

// GetAlbumMbid returns stored MusicBrainz release id (if any).
func (d *DB) GetAlbumMbid(ctx context.Context, id uuid.UUID) (string, error) {
	var mb sql.NullString
	err := d.Pool.QueryRow(ctx, `SELECT musicbrainz_release_id FROM albums WHERE id = $1`, id).Scan(&mb)
	if err != nil {
		return "", err
	}
	if !mb.Valid {
		return "", nil
	}
	return mb.String, nil
}

// GetTrackByID for API single track
func (d *DB) GetTrackByID(ctx context.Context, id uuid.UUID) (Track, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT
			t.id, t.title, t.duration_ms, t.format, t.bitrate_kbps, t.track_no, t.disc_no, t.year,
			t.album_id::text, al.title, t.artist_id::text, ar.name
		FROM tracks t
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		WHERE t.id = $1
	`, id)
	if err != nil {
		return Track{}, err
	}
	defer rows.Close()
	list, err := scanTrackRows(rows)
	if err != nil {
		return Track{}, err
	}
	if len(list) == 0 {
		return Track{}, pgx.ErrNoRows
	}
	return list[0], nil
}

// ListTracksByIds preserves order
func (d *DB) ListTracksByIds(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]Track, error) {
	if len(ids) == 0 {
		return map[uuid.UUID]Track{}, nil
	}
	rows, err := d.Pool.Query(ctx, `
		SELECT
			t.id, t.title, t.duration_ms, t.format, t.bitrate_kbps, t.track_no, t.disc_no, t.year,
			t.album_id::text, al.title, t.artist_id::text, ar.name
		FROM tracks t
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		WHERE t.id = ANY($1::uuid[])
	`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list, err := scanTrackRows(rows)
	if err != nil {
		return nil, err
	}
	m := make(map[uuid.UUID]Track, len(list))
	for i := range list {
		m[list[i].ID] = list[i]
	}
	return m, nil
}

// ResetStuckRunningJobs requeues running jobs (e.g. after crash)
func (d *DB) ResetStuckRunningJobs(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, `UPDATE jobs SET status = 'pending' WHERE status = 'running'`)
	return err
}

// CleanupOrphanAlbums deletes albums with no tracks referencing them.
// Useful after scans that may move tracks between albums.
func (d *DB) CleanupOrphanAlbums(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, `
		DELETE FROM albums a
		WHERE NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = a.id)
	`)
	return err
}

// CountPendingMetaJobForAlbum returns if a fetch_album job already exists
func (d *DB) CountPendingMetaJobForAlbum(ctx context.Context, albumID uuid.UUID) (int, error) {
	var c int
	err := d.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM jobs
		WHERE type = 'fetch_album' AND status IN ('pending', 'running') AND (payload->>'albumId')::uuid = $1
	`, albumID).Scan(&c)
	return c, err
}