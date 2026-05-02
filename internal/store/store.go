package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"html"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

// ErrAlbumNotForArtist is returned when PATCH sets albumId that is not associated with the resolved track artist.
var ErrAlbumNotForArtist = errors.New("album not in artist context")

// Track-level genre aggregation for JSON: prefers track_genres; falls back to album_genres. Labels joined with ||| for scan split.
const sqlDispTrackGenres = `COALESCE(
  (SELECT NULLIF(trim(both FROM string_agg(lg.label, '|||' ORDER BY tg.position ASC, lg.normalized ASC)), '')
     FROM track_genres tg INNER JOIN library_genres lg ON lg.id = tg.genre_id WHERE tg.track_id = t.id),
  (SELECT NULLIF(trim(both FROM string_agg(lg.label, '|||' ORDER BY ag.position ASC, lg.normalized ASC)), '')
     FROM album_genres ag INNER JOIN library_genres lg ON lg.id = ag.genre_id WHERE ag.album_id = t.album_id)
) AS disp_genres`

// sqlDispImprintGenreExpr is the genre column expression (no alias). Wrapped in COALESCE(...,'') in the query
// so pgx can scan into Go strings (NULL would otherwise fail rows.Scan).
const sqlDispImprintGenreExpr = `COALESCE(
  (SELECT NULLIF(trim(both FROM string_agg(lg.label, '; ' ORDER BY tg.position ASC, lg.normalized ASC)), '')
     FROM track_genres tg INNER JOIN library_genres lg ON lg.id = tg.genre_id WHERE tg.track_id = t.id),
  (SELECT NULLIF(trim(both FROM string_agg(lg.label, '; ' ORDER BY ag.position ASC, lg.normalized ASC)), '')
     FROM album_genres ag INNER JOIN library_genres lg ON lg.id = ag.genre_id WHERE ag.album_id = t.album_id)
)`

// sqlDispImprintGenreLegacyExpr when migration 018 junction tables are absent.
const sqlDispImprintGenreLegacyExpr = `COALESCE(
  NULLIF(BTRIM(CASE WHEN al.meta_user_genre IS NOT NULL AND BTRIM(COALESCE(al.meta_user_genre::text, '')) <> ''
    THEN al.meta_user_genre::text ELSE NULL END), ''),
  NULLIF(BTRIM(COALESCE(t.tag_genre, '')), ''),
  NULLIF(BTRIM(COALESCE(al.genre::text, '')), '')
)`

func imprintGenreQueryShouldRetry(err error) bool {
	var pe *pgconn.PgError
	if !errors.As(err, &pe) {
		return false
	}
	switch pe.Code {
	case "42P01", "42703", "42883": // undefined_table, undefined_column, undefined_function
		return true
	default:
		return false
	}
}

func splitDispGenresAgg(ns sql.NullString) []string {
	if !ns.Valid || strings.TrimSpace(ns.String) == "" {
		return nil
	}
	var gs []string
	for _, x := range strings.Split(ns.String, "|||") {
		if z := strings.TrimSpace(x); z != "" {
			gs = append(gs, z)
		}
	}
	return gs
}

// AlbumBelongsToArtistContext matches ListAlbums(artistId): album artist or a track on the album has this artist.
func (d *DB) AlbumBelongsToArtistContext(ctx context.Context, albumID, artistID uuid.UUID) (bool, error) {
	var ok bool
	err := d.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM albums a
			WHERE a.id = $1 AND (
				a.artist_id = $2 OR EXISTS (
					SELECT 1 FROM tracks t WHERE t.album_id = a.id AND t.artist_id = $2
				)
			)
		)`, albumID, artistID).Scan(&ok)
	return ok, err
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
		SELECT tr.file_path,
			COALESCE(NULLIF(BTRIM(tr.meta_user_title), ''), tr.title),
			tr.duration_ms,
			COALESCE(NULLIF(BTRIM(tr.meta_user_artist), ''), ar.name),
			COALESCE(NULLIF(BTRIM(tr.meta_user_album), ''), al.title),
			tr.mb_recording_id
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
	artist = html.UnescapeString(artist)
	album = html.UnescapeString(album)
	title = html.UnescapeString(title)

	// read current + user pin columns
	var curTitle sql.NullString
	var curArtist sql.NullString
	var curAlbum sql.NullString
	var curYear sql.NullInt32
	var curArtistIDStr, curAlbumIDStr sql.NullString
	var muTitle, muArtist, muAlbum sql.NullString
	var muYear sql.NullInt32
	err = d.Pool.QueryRow(ctx, `
		SELECT tr.title, ar.name, al.title, tr.year,
			tr.artist_id::text, tr.album_id::text,
			tr.meta_user_title, tr.meta_user_artist, tr.meta_user_album, tr.meta_user_year
		FROM tracks tr
		LEFT JOIN artists ar ON tr.artist_id = ar.id
		LEFT JOIN albums  al ON tr.album_id = al.id
		WHERE tr.id = $1
	`, trackID).Scan(&curTitle, &curArtist, &curAlbum, &curYear, &curArtistIDStr, &curAlbumIDStr, &muTitle, &muArtist, &muAlbum, &muYear)
	if err != nil {
		return uuid.Nil, err
	}

	pinTitle := metaPinString(muTitle)
	pinArtist := metaPinString(muArtist)
	pinAlbum := metaPinString(muAlbum)
	pinYear := muYear.Valid

	shouldSetTitle := !pinTitle && (!curTitle.Valid || strings.TrimSpace(curTitle.String) == "")
	shouldSetArtist := !pinArtist && (!curArtist.Valid || strings.EqualFold(strings.TrimSpace(curArtist.String), "unknown artist") || strings.TrimSpace(curArtist.String) == "")
	shouldSetAlbum := !pinAlbum && (!curAlbum.Valid || strings.EqualFold(strings.TrimSpace(curAlbum.String), "unknown") || strings.TrimSpace(curAlbum.String) == "")
	shouldSetYear := !pinYear && !curYear.Valid

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

	if pinArtist && curArtistIDStr.Valid && curArtistIDStr.String != "" {
		if u, e := uuid.Parse(curArtistIDStr.String); e == nil {
			artistID = u
		}
	}
	if pinAlbum && curAlbumIDStr.Valid && curAlbumIDStr.String != "" {
		if u, e := uuid.Parse(curAlbumIDStr.String); e == nil {
			albID = u
		}
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

func metaPinString(ns sql.NullString) bool {
	return ns.Valid && strings.TrimSpace(ns.String) != ""
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
		`INSERT INTO users (id, username, email, password_hash, display_name, ui_lang) VALUES ($1, $2, $3, $4, $5, 'ru')`,
		id, username, strings.ToLower(strings.TrimSpace(email)), hash, name,
	)
	return err
}

func (d *DB) UserByID(ctx context.Context, id uuid.UUID) (User, error) {
	var u User
	var uname sql.NullString
	var name sql.NullString
	var bgt sql.NullString
	var bgp sql.NullString
	var bgpath sql.NullString
	var bgmime sql.NullString
	var uiLang sql.NullString
	err := d.Pool.QueryRow(ctx,
		`SELECT id, username, email, display_name, created_at, background_type, background_preset, background_path, background_mime, ui_lang
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &uname, &u.Email, &name, &u.CreatedAt, &bgt, &bgp, &bgpath, &bgmime, &uiLang)
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
	if bgt.Valid && strings.TrimSpace(bgt.String) != "" {
		s := bgt.String
		u.BackgroundType = &s
	}
	if bgp.Valid && strings.TrimSpace(bgp.String) != "" {
		s := bgp.String
		u.BackgroundPreset = &s
	}
	if bgmime.Valid && strings.TrimSpace(bgmime.String) != "" {
		s := bgmime.String
		u.BackgroundMime = &s
	}
	if uiLang.Valid && strings.TrimSpace(uiLang.String) != "" {
		u.UILang = strings.TrimSpace(uiLang.String)
	} else {
		u.UILang = "ru"
	}
	// BackgroundURL is set by API layer (needs absolute route).
	return u, nil
}

// --- UI language (profile) ---

func (d *DB) SetUserUILang(ctx context.Context, userID uuid.UUID, lang string) error {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang != "ru" && lang != "en" {
		lang = "ru"
	}
	_, err := d.Pool.Exec(ctx, `UPDATE users SET ui_lang = $2 WHERE id = $1`, userID, lang)
	return err
}

// --- Backgrounds (profile) ---

func (d *DB) GetUserBackground(ctx context.Context, userID uuid.UUID) (bgType, preset, relPath, mime *string, err error) {
	var t sql.NullString
	var p sql.NullString
	var rp sql.NullString
	var m sql.NullString
	err = d.Pool.QueryRow(ctx, `
		SELECT background_type, background_preset, background_path, background_mime
		FROM users WHERE id = $1
	`, userID).Scan(&t, &p, &rp, &m)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	if t.Valid && strings.TrimSpace(t.String) != "" {
		s := t.String
		bgType = &s
	}
	if p.Valid && strings.TrimSpace(p.String) != "" {
		s := p.String
		preset = &s
	}
	if rp.Valid && strings.TrimSpace(rp.String) != "" {
		s := rp.String
		relPath = &s
	}
	if m.Valid && strings.TrimSpace(m.String) != "" {
		s := m.String
		mime = &s
	}
	return
}

func (d *DB) SetUserBackgroundPreset(ctx context.Context, userID uuid.UUID, preset string) error {
	preset = strings.TrimSpace(preset)
	if preset == "" {
		_, err := d.Pool.Exec(ctx, `UPDATE users SET background_type = NULL, background_preset = NULL WHERE id = $1`, userID)
		return err
	}
	_, err := d.Pool.Exec(ctx, `
		UPDATE users
		SET background_type = 'preset', background_preset = $2
		WHERE id = $1
	`, userID, preset)
	return err
}

func (d *DB) SetUserBackgroundFile(ctx context.Context, userID uuid.UUID, relPath string, mime string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE users
		SET background_type = 'custom', background_path = $2, background_mime = $3
		WHERE id = $1
	`, userID, relPath, strings.TrimSpace(mime))
	return err
}

func (d *DB) ClearUserBackgroundFile(ctx context.Context, userID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE users
		SET background_path = NULL, background_mime = NULL
		WHERE id = $1
	`, userID)
	return err
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

// albumHasUserMeta is true if the user edited this album — rescan should not move tracks away from it.
func (d *DB) albumHasUserMeta(ctx context.Context, albumID uuid.UUID) (bool, error) {
	var ok bool
	err := d.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM albums WHERE id = $1 AND (
				(meta_user_title IS NOT NULL AND BTRIM(COALESCE(meta_user_title, '')) <> '') OR
				(meta_user_artist IS NOT NULL AND BTRIM(COALESCE(meta_user_artist, '')) <> '') OR
				meta_user_year IS NOT NULL OR
				meta_cover_locked OR EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = albums.id)
			)
		)`, albumID).Scan(&ok)
	return ok, err
}

func sqlNullTrim(s string) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return s
}

// TrackUnchangedFingerprint reports whether the DB already has this path with the same
// size and mtime (typical unchanged file). The scanner skips tag reads and ffprobe in that case.
func (d *DB) TrackUnchangedFingerprint(ctx context.Context, filePath string, fileSize, mtimeNs int64) (albumID uuid.UUID, unchanged bool, err error) {
	var aid sql.NullString
	e := d.Pool.QueryRow(ctx, `
		SELECT album_id::text FROM tracks
		WHERE file_path = $1 AND file_size = $2 AND file_mtime_ns = $3
		LIMIT 1
	`, filePath, fileSize, mtimeNs).Scan(&aid)
	if e == pgx.ErrNoRows {
		return uuid.Nil, false, nil
	}
	if e != nil {
		return uuid.Nil, false, e
	}
	if !aid.Valid || aid.String == "" {
		return uuid.Nil, false, nil
	}
	albumID, e = uuid.Parse(aid.String)
	if e != nil {
		return uuid.Nil, false, nil
	}
	return albumID, true, nil
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
	tagAlbumArtist, tagGenreScan, tagComposer, tagComment string,
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
	var oldMtime, oldSize int64
	var curAlbumID, curArtistID sql.NullString
	var curTitle sql.NullString
	var muTitle, muArtist, muAlbum sql.NullString
	var muYear, muTrackNo, muDiscNo sql.NullInt32
	err2 := d.Pool.QueryRow(ctx, `
		SELECT id, file_mtime_ns, file_size, album_id::text, artist_id::text, title,
			meta_user_title, meta_user_artist, meta_user_album,
			meta_user_year, meta_user_track_no, meta_user_disc_no
		FROM tracks WHERE file_path = $1`, filePath).
		Scan(&id, &oldMtime, &oldSize, &curAlbumID, &curArtistID, &curTitle,
			&muTitle, &muArtist, &muAlbum, &muYear, &muTrackNo, &muDiscNo)
	if err2 == nil {
		trackID = id
		pinTitle := metaPinString(muTitle)
		pinArtist := metaPinString(muArtist)
		pinAlbum := metaPinString(muAlbum)
		pinYear := muYear.Valid
		pinTrackNo := muTrackNo.Valid
		pinDiscNo := muDiscNo.Valid

		tagDerivedAlbID := albumID
		effectiveTagAlbID := tagDerivedAlbID
		if curAlbumID.Valid && curAlbumID.String != "" && !pinAlbum {
			curAUUID, errP := uuid.Parse(curAlbumID.String)
			if errP == nil {
				if has, e := d.albumHasUserMeta(ctx, curAUUID); e == nil && has {
					effectiveTagAlbID = curAUUID
				}
			}
		}
		sameAlbum := curAlbumID.Valid && curAlbumID.String != "" && curAlbumID.String == effectiveTagAlbID.String()
		sameArtist := curArtistID.Valid && curArtistID.String != "" && curArtistID.String == artistID.String()
		if oldMtime == mtimeNs && oldSize == fileSize {
			effSameAlbum := sameAlbum || pinAlbum
			effSameArtist := sameArtist || pinArtist
			if effSameAlbum && effSameArtist {
				var retAlb uuid.UUID
				if curAlbumID.Valid && curAlbumID.String != "" {
					retAlb, _ = uuid.Parse(curAlbumID.String)
				}
				return trackID, retAlb, false, nil
			}
		}

		finalTitle := trackTitle
		if pinTitle && curTitle.Valid {
			finalTitle = curTitle.String
		}
		finalArtistID := artistID
		if pinArtist && curArtistID.Valid && curArtistID.String != "" {
			if u, e := uuid.Parse(curArtistID.String); e == nil {
				finalArtistID = u
			}
		}
		finalAlbumID := effectiveTagAlbID
		if pinAlbum && curAlbumID.Valid && curAlbumID.String != "" {
			if u, e := uuid.Parse(curAlbumID.String); e == nil {
				finalAlbumID = u
			}
		}
		finalYear := year
		if pinYear && muYear.Valid {
			y := int(muYear.Int32)
			finalYear = &y
		}
		var finalTrackNo *int
		if pinTrackNo && muTrackNo.Valid {
			v := int(muTrackNo.Int32)
			finalTrackNo = &v
		} else {
			finalTrackNo = trackNo
		}
		var finalDiscNo *int
		if pinDiscNo && muDiscNo.Valid {
			v := int(muDiscNo.Int32)
			finalDiscNo = &v
		} else {
			finalDiscNo = discNo
		}

		_, e := d.Pool.Exec(ctx, `
			UPDATE tracks SET
				file_size = $2, file_mtime_ns = $3, duration_ms = $4, title = $5,
				format = $6, bitrate_kbps = $7,
				track_no = $8, disc_no = $9, year = $10, album_id = $11, artist_id = $12,
				tag_album_artist = $13, tag_composer = $14, tag_comment = $15
			WHERE id = $1
		`, id, fileSize, mtimeNs, durationMS, finalTitle, format, bitrateKbps, finalTrackNo, finalDiscNo, finalYear, finalAlbumID, finalArtistID,
			sqlNullTrim(tagAlbumArtist), sqlNullTrim(tagComposer), sqlNullTrim(tagComment))
		if e != nil {
			err = e
			return
		}
		_ = d.mergeTrackGenresFromScan(ctx, id, finalAlbumID, tagGenreScan)
		return trackID, finalAlbumID, true, nil
	}
	if err2 != pgx.ErrNoRows {
		return uuid.UUID{}, albumID, false, err2
	}

	trackID = uuid.New()
	isNewOrChanged = true
	_, err = d.Pool.Exec(ctx, `
		INSERT INTO tracks (
			id, file_path, file_size, file_mtime_ns, duration_ms, title, format, bitrate_kbps,
			track_no, disc_no, year, album_id, artist_id,
			tag_album_artist, tag_composer, tag_comment
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`, trackID, filePath, fileSize, mtimeNs, durationMS, trackTitle, format, bitrateKbps, trackNo, discNo, year, albumID, artistID,
		sqlNullTrim(tagAlbumArtist), sqlNullTrim(tagComposer), sqlNullTrim(tagComment))
	if err != nil {
		return
	}
	_ = d.mergeTrackGenresFromScan(ctx, trackID, albumID, tagGenreScan)
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

// UpdateTrackFilePath updates the stored path when a file was renamed on disk (e.g. trailing space before extension).
func (d *DB) UpdateTrackFilePath(ctx context.Context, oldPath, newPath string) error {
	if oldPath == newPath {
		return nil
	}
	_, err := d.Pool.Exec(ctx, `UPDATE tracks SET file_path = $2 WHERE file_path = $1`, oldPath, newPath)
	return err
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

// GetArtist returns one library artist row by primary key.
func (d *DB) GetArtist(ctx context.Context, id uuid.UUID) (Artist, error) {
	var a Artist
	var mb sql.NullString
	err := d.Pool.QueryRow(ctx, `
		SELECT id, name, musicbrainz_id FROM artists WHERE id = $1
	`, id).Scan(&a.ID, &a.Name, &mb)
	if err != nil {
		return Artist{}, err
	}
	if mb.Valid {
		s := mb.String
		a.MusicBrainzID = &s
	}
	return a, nil
}

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
		SELECT
			a.id,
			COALESCE(NULLIF(BTRIM(a.meta_user_title), ''), a.title) AS disp_title,
			CASE WHEN a.meta_user_year IS NOT NULL THEN a.meta_user_year ELSE a.year END AS disp_year,
			a.artist_id::text,
			COALESCE(NULLIF(BTRIM(a.meta_user_artist), ''), ar.name) AS disp_an,
			a.musicbrainz_release_id,
			a.cover_path,
			(a.meta_user_title IS NOT NULL AND BTRIM(COALESCE(a.meta_user_title, '')) <> '') AS pin_t,
			(a.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(a.meta_user_artist, '')) <> '') AS pin_ar,
			(a.meta_user_year IS NOT NULL) AS pin_y,
			(
				SELECT NULLIF(trim(both FROM string_agg(lg.label, '|||' ORDER BY ag.position ASC, lg.normalized ASC)), '')
				FROM album_genres ag
				JOIN library_genres lg ON lg.id = ag.genre_id
				WHERE ag.album_id = a.id
			) AS disp_genres,
			EXISTS (SELECT 1 FROM album_genres ag2 WHERE ag2.album_id = a.id) AS pin_genres,
			a.meta_cover_locked AS pin_cov
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
			WHERE ($1 = '' OR COALESCE(NULLIF(BTRIM(c.meta_user_title), ''), c.title) ILIKE $2
				OR COALESCE(NULLIF(BTRIM(c.meta_user_artist), ''), ar.name) ILIKE $2)
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
		SELECT
			a.id,
			COALESCE(NULLIF(BTRIM(a.meta_user_title), ''), a.title) AS disp_title,
			CASE WHEN a.meta_user_year IS NOT NULL THEN a.meta_user_year ELSE a.year END AS disp_year,
			a.artist_id::text,
			COALESCE(NULLIF(BTRIM(a.meta_user_artist), ''), ar.name) AS disp_an,
			a.musicbrainz_release_id,
			a.cover_path,
			(a.meta_user_title IS NOT NULL AND BTRIM(COALESCE(a.meta_user_title, '')) <> '') AS pin_t,
			(a.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(a.meta_user_artist, '')) <> '') AS pin_ar,
			(a.meta_user_year IS NOT NULL) AS pin_y,
			(
				SELECT NULLIF(trim(both FROM string_agg(lg.label, '|||' ORDER BY ag.position ASC, lg.normalized ASC)), '')
				FROM album_genres ag
				JOIN library_genres lg ON lg.id = ag.genre_id
				WHERE ag.album_id = a.id
			) AS disp_genres,
			EXISTS (SELECT 1 FROM album_genres ag2 WHERE ag2.album_id = a.id) AS pin_genres,
			a.meta_cover_locked AS pin_cov
		FROM ranked a
		LEFT JOIN artists ar ON a.artist_id = ar.id
		WHERE a.rn = 1
		ORDER BY
			COALESCE(NULLIF(BTRIM(a.meta_user_artist), ''), ar.name) NULLS LAST,
			COALESCE(NULLIF(BTRIM(a.meta_user_title), ''), a.title)
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
		var dispTitle string
		var dispY sql.NullInt64
		var aid sql.NullString
		var dispAn sql.NullString
		var mb, cp sql.NullString
		var dispGenres sql.NullString
		var pinT, pinAr, pinY, pinGenres, pinCov bool
		if err := rows.Scan(&a.ID, &dispTitle, &dispY, &aid, &dispAn, &mb, &cp, &pinT, &pinAr, &pinY, &dispGenres, &pinGenres, &pinCov); err != nil {
			return nil, err
		}
		a.Title = dispTitle
		if dispGenres.Valid && strings.TrimSpace(dispGenres.String) != "" {
			for _, x := range strings.Split(dispGenres.String, "|||") {
				if t := strings.TrimSpace(x); t != "" {
					a.Genres = append(a.Genres, t)
				}
			}
		}
		if dispY.Valid {
			yy := int(dispY.Int64)
			a.Year = &yy
		}
		if aid.Valid && aid.String != "" {
			uid, err := uuid.Parse(aid.String)
			if err == nil {
				a.ArtistID = &uid
			}
		}
		if dispAn.Valid {
			s := dispAn.String
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
		if pinT || pinAr || pinY || pinGenres || pinCov {
			a.Meta = &AlbumMetaPins{Title: pinT, Artist: pinAr, Year: pinY, Genre: pinGenres, Cover: pinCov}
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (d *DB) ListTracks(ctx context.Context, query string, albumID, artistID, genreID *uuid.UUID) ([]Track, error) {
	qs := strings.TrimSpace(query)
	like := "%" + qs + "%"
	rows, err := d.Pool.Query(ctx, `
		SELECT
			t.id,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) AS disp_title,
			t.duration_ms, t.format, t.bitrate_kbps,
			COALESCE(t.meta_user_track_no, t.track_no) AS disp_track_no,
			COALESCE(t.meta_user_disc_no, t.disc_no) AS disp_disc_no,
			CASE WHEN t.meta_user_year IS NOT NULL THEN t.meta_user_year
			ELSE COALESCE(CASE WHEN al.meta_user_year IS NOT NULL THEN al.meta_user_year ELSE al.year END, t.year) END AS disp_year,
			t.album_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) AS disp_album_title,
			t.artist_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) AS disp_artist_name,
			t.art_path,
			`+sqlDispTrackGenres+`,
			t.genres_manual AS pin_genres,
			(t.meta_user_title IS NOT NULL AND BTRIM(COALESCE(t.meta_user_title, '')) <> '') AS pin_title,
			(t.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(t.meta_user_artist, '')) <> '') AS pin_artist,
			(t.meta_user_album IS NOT NULL AND BTRIM(COALESCE(t.meta_user_album, '')) <> '') AS pin_album,
			(t.meta_user_year IS NOT NULL) AS pin_year,
			(t.meta_user_track_no IS NOT NULL) AS pin_track_no,
			(t.meta_user_disc_no IS NOT NULL) AS pin_disc_no
		FROM tracks t
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		WHERE ($1 = '' OR
			(COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) ILIKE $2) OR
			(COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) ILIKE $2) OR
			(COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) ILIKE $2) OR
			(t.file_path ILIKE $2))
		AND ($3::uuid IS NULL OR t.album_id = $3)
		AND ($4::uuid IS NULL OR t.artist_id = $4)
		AND ($5::uuid IS NULL OR (
			EXISTS (SELECT 1 FROM track_genres tg WHERE tg.track_id = t.id AND tg.genre_id = $5)
			OR (
				NOT EXISTS (SELECT 1 FROM track_genres tg2 WHERE tg2.track_id = t.id)
				AND EXISTS (SELECT 1 FROM album_genres ag WHERE ag.album_id = t.album_id AND ag.genre_id = $5)
			)
		))
		ORDER BY
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) NULLS LAST,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) NULLS LAST,
			COALESCE(t.meta_user_disc_no, t.disc_no) NULLS FIRST,
			COALESCE(t.meta_user_track_no, t.track_no) NULLS FIRST,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) NULLS FIRST
	`, qs, like, albumID, artistID, genreID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTrackRows(rows)
}

// ImprintTrackRow is a minimal row for imprint preview/apply.
type ImprintTrackRow struct {
	TrackID uuid.UUID
	FilePath string
	Format   string

	Title       string
	ArtistName  string
	AlbumTitle  string
	AlbumArtist string
	Genre       string
	Composer    string
	Comment     string
	Year       *int
	TrackNo    *int
	DiscNo     *int

	// CoverRelPath is relative to DATA_DIR.
	CoverRelPath *string
}

// GetAlbumTracksForImprint returns effective metadata (as in UI) for all tracks in the album.
func (d *DB) GetAlbumTracksForImprint(ctx context.Context, albumID uuid.UUID) ([]ImprintTrackRow, error) {
	out, err := d.queryAlbumTracksForImprint(ctx, albumID, sqlDispImprintGenreExpr)
	if err != nil && imprintGenreQueryShouldRetry(err) {
		out, err = d.queryAlbumTracksForImprint(ctx, albumID, sqlDispImprintGenreLegacyExpr)
	}
	return out, err
}

func (d *DB) queryAlbumTracksForImprint(ctx context.Context, albumID uuid.UUID, genreExpr string) ([]ImprintTrackRow, error) {
	q := fmt.Sprintf(`
		SELECT
			t.id,
			t.file_path,
			COALESCE(t.format, '') AS fmt,
			COALESCE(COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title), '') AS disp_title,
			COALESCE(COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name), '') AS disp_artist_name,
			COALESCE(COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title), '') AS disp_album_title,
			COALESCE(COALESCE(
				NULLIF(BTRIM(t.meta_user_album_artist), ''),
				NULLIF(BTRIM(t.tag_album_artist), ''),
				BTRIM(COALESCE(aal.name, ''))
			), '') AS disp_aa,
			COALESCE(%s, '') AS disp_genre,
			BTRIM(COALESCE(t.tag_composer, '')) AS disp_composer,
			BTRIM(COALESCE(t.tag_comment, '')) AS disp_comment,
			CASE WHEN t.meta_user_year IS NOT NULL THEN t.meta_user_year
			ELSE COALESCE(CASE WHEN al.meta_user_year IS NOT NULL THEN al.meta_user_year ELSE al.year END, t.year) END AS disp_year,
			COALESCE(t.meta_user_track_no, t.track_no) AS disp_track_no,
			COALESCE(t.meta_user_disc_no, t.disc_no) AS disp_disc_no,
			CASE
				WHEN al.cover_path IS NOT NULL AND BTRIM(al.cover_path) <> '' THEN al.cover_path
				WHEN t.art_path IS NOT NULL AND BTRIM(t.art_path) <> '' THEN t.art_path
				ELSE NULL
			END AS disp_cover_rel
		FROM tracks t
		LEFT JOIN albums al ON t.album_id = al.id
		LEFT JOIN artists ar ON t.artist_id = ar.id
		LEFT JOIN artists aal ON al.artist_id = aal.id
		WHERE t.album_id = $1
		ORDER BY
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) NULLS LAST,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) NULLS LAST,
			COALESCE(t.meta_user_disc_no, t.disc_no) NULLS FIRST,
			COALESCE(t.meta_user_track_no, t.track_no) NULLS FIRST,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) NULLS FIRST
	`, genreExpr)
	rows, err := d.Pool.Query(ctx, q, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ImprintTrackRow
	for rows.Next() {
		var r ImprintTrackRow
		var fmtS sql.NullString
		var y sql.NullInt64
		var tno, dno sql.NullInt32
		var cover sql.NullString
		if err := rows.Scan(
			&r.TrackID,
			&r.FilePath,
			&fmtS,
			&r.Title,
			&r.ArtistName,
			&r.AlbumTitle,
			&r.AlbumArtist,
			&r.Genre,
			&r.Composer,
			&r.Comment,
			&y,
			&tno,
			&dno,
			&cover,
		); err != nil {
			return nil, err
		}
		if fmtS.Valid {
			r.Format = fmtS.String
		}
		if y.Valid {
			v := int(y.Int64)
			r.Year = &v
		}
		if tno.Valid {
			v := int(tno.Int32)
			r.TrackNo = &v
		}
		if dno.Valid {
			v := int(dno.Int32)
			r.DiscNo = &v
		}
		if cover.Valid && strings.TrimSpace(cover.String) != "" {
			s := cover.String
			r.CoverRelPath = &s
		}
		r.Title = html.UnescapeString(r.Title)
		r.ArtistName = html.UnescapeString(r.ArtistName)
		r.AlbumTitle = html.UnescapeString(r.AlbumTitle)
		r.AlbumArtist = html.UnescapeString(r.AlbumArtist)
		r.Genre = html.UnescapeString(r.Genre)
		r.Composer = html.UnescapeString(r.Composer)
		r.Comment = html.UnescapeString(r.Comment)
		out = append(out, r)
	}
	return out, rows.Err()
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
		var artPath sql.NullString
		var dispGenres sql.NullString
		var pinTitle, pinArtist, pinAlbum, pinYear, pinTn, pinDisc, pinGenres bool
		if err := rows.Scan(&t.ID, &title, &dms, &fmtS, &br, &tno, &dno, &yr, &aID, &alT, &alID, &arN, &artPath,
			&dispGenres,
			&pinGenres,
			&pinTitle, &pinArtist, &pinAlbum, &pinYear, &pinTn, &pinDisc); err != nil {
			return nil, err
		}
		t.Genres = splitDispGenresAgg(dispGenres)
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
				aid := uid
				t.AlbumID = &aid
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
		artHas := artPath.Valid && strings.TrimSpace(artPath.String) != ""
		if artHas {
			s := "/api/tracks/" + t.ID.String() + "/cover"
			t.CoverURL = &s
		}
		if pinTitle || pinArtist || pinAlbum || pinYear || pinTn || pinDisc || pinGenres || artHas {
			t.Meta = &TrackMetaPins{
				Title: pinTitle, Artist: pinArtist, Album: pinAlbum,
				Year: pinYear, TrackNo: pinTn, DiscNo: pinDisc,
				Genres: pinGenres, Art: artHas,
			}
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListAlbumTrackIDsWithoutStoredArt lists tracks on the album that have no persisted per-track cover yet.
func (d *DB) ListAlbumTrackIDsWithoutStoredArt(ctx context.Context, albumID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := d.Pool.Query(ctx, `
		SELECT id FROM tracks
		WHERE album_id = $1 AND (art_path IS NULL OR BTRIM(art_path) = '')
		ORDER BY file_path
	`, albumID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// TrackArtRelPath returns stored relative art path if present.
func (d *DB) TrackArtRelPath(ctx context.Context, id uuid.UUID) (rel string, ok bool) {
	var p sql.NullString
	err := d.Pool.QueryRow(ctx, `SELECT art_path FROM tracks WHERE id = $1`, id).Scan(&p)
	if err != nil || !p.Valid || strings.TrimSpace(p.String) == "" {
		return "", false
	}
	return strings.TrimSpace(p.String), true
}

// SetTrackArtPath stores relative path to custom cover under DataDir.
func (d *DB) SetTrackArtPath(ctx context.Context, id uuid.UUID, rel string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE tracks SET art_path = $2 WHERE id = $1`, id, rel)
	return err
}

// GetTrackForStream returns file path, title for logging
func (d *DB) GetTrackForStream(ctx context.Context, id uuid.UUID) (string, *string, error) {
	var path string
	var t sql.NullString
	err := d.Pool.QueryRow(ctx, `
		SELECT file_path, COALESCE(NULLIF(BTRIM(meta_user_title), ''), title)
		FROM tracks WHERE id = $1`, id).Scan(&path, &t)
	if err != nil {
		return "", nil, err
	}
	if t.Valid {
		return path, &t.String, nil
	}
	return path, nil, nil
}

// UpdateTrackMeta applies user edits; pinned fields are stored in meta_user_* and honored by UpsertTrack.
func (d *DB) UpdateTrackMeta(ctx context.Context, trackID uuid.UUID, u TrackMetaUpdate) error {
	var curTitle sql.NullString
	var curYear sql.NullInt32
	var curTno, curDno sql.NullInt32
	var curAlbID, curArtID sql.NullString
	var muT, muA, muAlb, muAlbArt sql.NullString
	var muY, muTn, muDn sql.NullInt32

	err := d.Pool.QueryRow(ctx, `
		SELECT t.title, t.year, t.track_no, t.disc_no, t.album_id::text, t.artist_id::text,
			t.meta_user_title, t.meta_user_artist, t.meta_user_album, t.meta_user_album_artist,
			t.meta_user_year, t.meta_user_track_no, t.meta_user_disc_no
		FROM tracks t WHERE t.id = $1`, trackID).Scan(
		&curTitle, &curYear, &curTno, &curDno, &curAlbID, &curArtID,
		&muT, &muA, &muAlb, &muAlbArt, &muY, &muTn, &muDn,
	)
	if err != nil {
		return err
	}

	applyClear := func() {
		if u.ClearTitle {
			muT = sql.NullString{}
		}
		if u.ClearArtist {
			muA = sql.NullString{}
		}
		if u.ClearAlbum {
			muAlb = sql.NullString{}
			muAlbArt = sql.NullString{}
		}
		if u.ClearYear {
			muY = sql.NullInt32{}
		}
		if u.ClearTrackNo {
			muTn = sql.NullInt32{}
		}
		if u.ClearDiscNo {
			muDn = sql.NullInt32{}
		}
	}
	applyClear()

	if u.Title != nil {
		s := strings.TrimSpace(*u.Title)
		if s == "" {
			muT = sql.NullString{}
		} else {
			muT = sql.NullString{String: s, Valid: true}
		}
	}
	if u.ArtistName != nil {
		s := strings.TrimSpace(*u.ArtistName)
		if s == "" {
			muA = sql.NullString{}
		} else {
			muA = sql.NullString{String: s, Valid: true}
		}
	}
	if u.AlbumTitle != nil {
		s := strings.TrimSpace(*u.AlbumTitle)
		if s == "" {
			muAlb = sql.NullString{}
			muAlbArt = sql.NullString{}
		} else {
			muAlb = sql.NullString{String: s, Valid: true}
		}
	}
	if u.AlbumArtistName != nil {
		s := strings.TrimSpace(*u.AlbumArtistName)
		if s == "" {
			muAlbArt = sql.NullString{}
		} else {
			muAlbArt = sql.NullString{String: s, Valid: true}
		}
	}
	if u.Year != nil {
		muY = sql.NullInt32{Int32: int32(*u.Year), Valid: true}
	}
	if u.TrackNo != nil {
		muTn = sql.NullInt32{Int32: int32(*u.TrackNo), Valid: true}
	}
	if u.DiscNo != nil {
		muDn = sql.NullInt32{Int32: int32(*u.DiscNo), Valid: true}
	}

	// Resolve artist_id
	var artistID uuid.UUID
	if metaPinString(muA) {
		aid, e := d.FindOrCreateArtist(ctx, muA.String)
		if e != nil {
			return e
		}
		artistID = aid
	} else if curArtID.Valid && curArtID.String != "" {
		artistID, _ = uuid.Parse(curArtID.String)
	} else {
		artistID, err = d.FindOrCreateArtist(ctx, "Unknown Artist")
		if err != nil {
			return err
		}
	}

	// Resolve album_id
	var albumID uuid.UUID
	if u.AlbumID != nil && *u.AlbumID != uuid.Nil {
		ok, verr := d.AlbumBelongsToArtistContext(ctx, *u.AlbumID, artistID)
		if verr != nil {
			return verr
		}
		if !ok {
			return ErrAlbumNotForArtist
		}
		albumID = *u.AlbumID
		// Drop album string pins so API/list views inherit title, album artist, and year from the album row.
		muAlb = sql.NullString{}
		muAlbArt = sql.NullString{}
		if u.Year == nil {
			muY = sql.NullInt32{}
		}
	} else if metaPinString(muAlb) {
		albTitle := strings.TrimSpace(muAlb.String)
		var albumArtistID uuid.UUID
		if metaPinString(muAlbArt) {
			albumArtistID, err = d.FindOrCreateArtist(ctx, muAlbArt.String)
			if err != nil {
				return err
			}
		} else {
			albumArtistID = artistID
		}
		var yPtr *int
		if muY.Valid {
			yy := int(muY.Int32)
			yPtr = &yy
		} else if curYear.Valid {
			yy := int(curYear.Int32)
			yPtr = &yy
		}
		albID, e := d.FindOrCreateAlbum(ctx, &albumArtistID, albTitle, yPtr)
		if e != nil {
			return e
		}
		albumID = albID
	} else if curAlbID.Valid && curAlbID.String != "" {
		albumID, _ = uuid.Parse(curAlbID.String)
	} else {
		albID, e := d.FindOrCreateAlbum(ctx, &artistID, "Unknown", nil)
		if e != nil {
			return e
		}
		albumID = albID
	}

	// Title column: keep user override text or existing
	titleOut := ""
	if metaPinString(muT) {
		titleOut = muT.String
	} else if curTitle.Valid {
		titleOut = curTitle.String
	}

	var yearOut sql.NullInt32
	if muY.Valid {
		yearOut = muY
	} else {
		yearOut = curYear
	}

	var tnoOut sql.NullInt32
	if muTn.Valid {
		tnoOut = muTn
	} else {
		tnoOut = curTno
	}

	var dnoOut sql.NullInt32
	if muDn.Valid {
		dnoOut = muDn
	} else {
		dnoOut = curDno
	}

	tag, err := d.Pool.Exec(ctx, `
		UPDATE tracks SET
			title = $2,
			year = $3,
			track_no = $4,
			disc_no = $5,
			artist_id = $6,
			album_id = $7,
			meta_user_title = $8,
			meta_user_artist = $9,
			meta_user_album = $10,
			meta_user_album_artist = $11,
			meta_user_year = $12,
			meta_user_track_no = $13,
			meta_user_disc_no = $14
		WHERE id = $1
	`, trackID, titleOut, yearOut, tnoOut, dnoOut, artistID, albumID,
		muT, muA, muAlb, muAlbArt, muY, muTn, muDn)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if u.ClearArt {
		if _, e := d.Pool.Exec(ctx, `UPDATE tracks SET art_path = NULL WHERE id = $1`, trackID); e != nil {
			return e
		}
	}
	if u.Genres != nil {
		if err := d.ReplaceTrackGenres(ctx, trackID, *u.Genres, true); err != nil {
			return err
		}
	} else if u.ClearGenres {
		if err := d.inheritTrackGenresFromAlbum(ctx, trackID); err != nil {
			return err
		}
	}
	_ = d.CleanupOrphanAlbums(ctx)
	return nil
}

// UpdateAlbumMeta applies user edits; display uses meta_user_* over base columns.
func (d *DB) UpdateAlbumMeta(ctx context.Context, albumID uuid.UUID, u AlbumMetaUpdate) error {
	var curTitle string
	var curArtID sql.NullString
	var muT, muAr sql.NullString
	var muY sql.NullInt32

	err := d.Pool.QueryRow(ctx, `
		SELECT a.title, a.artist_id::text,
			a.meta_user_title, a.meta_user_artist, a.meta_user_year
		FROM albums a WHERE a.id = $1`,
		albumID,
	).Scan(&curTitle, &curArtID, &muT, &muAr, &muY)
	if err != nil {
		return err
	}

	if u.ClearTitle {
		muT = sql.NullString{}
	}
	if u.ClearArtist {
		muAr = sql.NullString{}
	}
	if u.ClearYear {
		muY = sql.NullInt32{}
	}

	if u.Title != nil {
		s := strings.TrimSpace(*u.Title)
		if s == "" {
			muT = sql.NullString{}
		} else {
			muT = sql.NullString{String: s, Valid: true}
		}
	}
	if u.ArtistName != nil {
		s := strings.TrimSpace(*u.ArtistName)
		if s == "" {
			muAr = sql.NullString{}
		} else {
			muAr = sql.NullString{String: s, Valid: true}
		}
	}
	if u.Year != nil {
		muY = sql.NullInt32{Int32: int32(*u.Year), Valid: true}
	}

	var artArg interface{}
	if metaPinString(muAr) {
		aid, e := d.FindOrCreateArtist(ctx, muAr.String)
		if e != nil {
			return e
		}
		artArg = aid
	} else if curArtID.Valid && strings.TrimSpace(curArtID.String) != "" {
		aid, e := uuid.Parse(curArtID.String)
		if e != nil {
			return e
		}
		artArg = aid
	} else {
		artArg = nil
	}

	effTitle := curTitle
	if metaPinString(muT) {
		effTitle = muT.String
	}
	ts := normalizeSearch(effTitle)

	tag, err := d.Pool.Exec(ctx, `
		UPDATE albums SET
			meta_user_title = $2,
			meta_user_artist = $3,
			meta_user_year = $4,
			artist_id = $5,
			title_search = $6,
			cover_path = CASE WHEN $7 THEN NULL ELSE cover_path END,
			meta_cover_locked = CASE WHEN $7 THEN false ELSE meta_cover_locked END
		WHERE id = $1
	`, albumID, muT, muAr, muY, artArg, ts, u.ClearCover)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	if u.Genres != nil {
		if err := d.ReplaceAlbumGenres(ctx, albumID, *u.Genres); err != nil {
			return err
		}
		if err := d.RolloutAlbumGenresToTracks(ctx, albumID); err != nil {
			return err
		}
	} else if u.ClearGenres {
		if err := d.ReplaceAlbumGenres(ctx, albumID, nil); err != nil {
			return err
		}
		if err := d.RolloutAlbumGenresToTracks(ctx, albumID); err != nil {
			return err
		}
	}
	return nil
}

// SetAlbumCoverUser stores a user-provided cover and locks it against automatic replacement.
func (d *DB) SetAlbumCoverUser(ctx context.Context, albumID uuid.UUID, relPath string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE albums SET cover_path = $2, meta_cover_locked = true WHERE id = $1
	`, albumID, relPath)
	return err
}

// ClearAlbumCover removes cover path and unlocks automatic fetches (caller removes file on disk).
func (d *DB) ClearAlbumCover(ctx context.Context, albumID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE albums SET cover_path = NULL, meta_cover_locked = false WHERE id = $1
	`, albumID)
	return err
}

// AlbumCoverLocked is true when the user locked the cover (worker must not replace it).
func (d *DB) AlbumCoverLocked(ctx context.Context, albumID uuid.UUID) (bool, error) {
	var b bool
	err := d.Pool.QueryRow(ctx, `SELECT meta_cover_locked FROM albums WHERE id = $1`, albumID).Scan(&b)
	if err != nil {
		return false, err
	}
	return b, nil
}

// ClearTrackArtPath removes custom cover path (file delete is caller's responsibility).
func (d *DB) ClearTrackArtPath(ctx context.Context, id uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `UPDATE tracks SET art_path = NULL WHERE id = $1`, id)
	return err
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
	out := make([]Playlist, 0)
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
			t.id,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) AS disp_title,
			t.duration_ms, t.format, t.bitrate_kbps,
			COALESCE(t.meta_user_track_no, t.track_no) AS disp_track_no,
			COALESCE(t.meta_user_disc_no, t.disc_no) AS disp_disc_no,
			CASE WHEN t.meta_user_year IS NOT NULL THEN t.meta_user_year
			ELSE COALESCE(CASE WHEN al.meta_user_year IS NOT NULL THEN al.meta_user_year ELSE al.year END, t.year) END AS disp_year,
			t.album_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) AS disp_album_title,
			t.artist_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) AS disp_artist_name,
			t.art_path,
			`+sqlDispTrackGenres+`,
			t.genres_manual AS pin_genres,
			(t.meta_user_title IS NOT NULL AND BTRIM(COALESCE(t.meta_user_title, '')) <> '') AS pin_title,
			(t.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(t.meta_user_artist, '')) <> '') AS pin_artist,
			(t.meta_user_album IS NOT NULL AND BTRIM(COALESCE(t.meta_user_album, '')) <> '') AS pin_album,
			(t.meta_user_year IS NOT NULL) AS pin_year,
			(t.meta_user_track_no IS NOT NULL) AS pin_track_no,
			(t.meta_user_disc_no IS NOT NULL) AS pin_disc_no,
			pt.position
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
		var artPath sql.NullString
		var dispGenres sql.NullString
		var pinTitle, pinArtist, pinAlbum, pinYear, pinTn, pinDisc, pinGenres bool
		var pos int
		if err = rows.Scan(&t.ID, &title, &dms, &fmtS, &br, &tno, &dno, &yr, &aID, &alT, &alID, &arN, &artPath,
			&dispGenres,
			&pinGenres,
			&pinTitle, &pinArtist, &pinAlbum, &pinYear, &pinTn, &pinDisc, &pos); err != nil {
			return p, nil, err
		}
		t.Genres = splitDispGenresAgg(dispGenres)
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
				aid := uid
				t.AlbumID = &aid
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
		artHas := artPath.Valid && strings.TrimSpace(artPath.String) != ""
		if artHas {
			s := "/api/tracks/" + t.ID.String() + "/cover"
			t.CoverURL = &s
		}
		if pinTitle || pinArtist || pinAlbum || pinYear || pinTn || pinDisc || pinGenres || artHas {
			t.Meta = &TrackMetaPins{
				Title: pinTitle, Artist: pinArtist, Album: pinAlbum,
				Year: pinYear, TrackNo: pinTn, DiscNo: pinDisc,
				Genres: pinGenres, Art: artHas,
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

// UpdateJobProgress updates coarse progress counters/message (best-effort).
func (d *DB) UpdateJobProgress(ctx context.Context, id uuid.UUID, done, total *int, msg *string) error {
	_, err := d.Pool.Exec(ctx, `
		UPDATE jobs SET
			progress_done = COALESCE($2, progress_done),
			progress_total = COALESCE($3, progress_total),
			progress_msg = COALESCE($4, progress_msg)
		WHERE id = $1
	`, id, done, total, msg)
	return err
}

func (d *DB) SetJobResult(ctx context.Context, id uuid.UUID, resultJSON string) error {
	_, err := d.Pool.Exec(ctx, `UPDATE jobs SET result = $2::jsonb WHERE id = $1`, id, resultJSON)
	return err
}

type JobStatusRow struct {
	ID           uuid.UUID
	Type         string
	Status       string
	Attempts     int
	LastError    *string
	CreatedAt    time.Time
	ProgressDone *int
	ProgressTotal *int
	ProgressMsg  *string
	ResultJSON   *string
}

func (d *DB) GetJobStatus(ctx context.Context, id uuid.UUID) (JobStatusRow, error) {
	var out JobStatusRow
	var le sql.NullString
	var pd, pt sql.NullInt32
	var pm sql.NullString
	var res sql.NullString
	err := d.Pool.QueryRow(ctx, `
		SELECT id, type, status::text, attempts, last_error, created_at,
		       progress_done, progress_total, progress_msg, result::text
		FROM jobs WHERE id = $1
	`, id).Scan(&out.ID, &out.Type, &out.Status, &out.Attempts, &le, &out.CreatedAt, &pd, &pt, &pm, &res)
	if err != nil {
		return JobStatusRow{}, err
	}
	if le.Valid {
		s := le.String
		out.LastError = &s
	}
	if pd.Valid {
		v := int(pd.Int32)
		out.ProgressDone = &v
	}
	if pt.Valid {
		v := int(pt.Int32)
		out.ProgressTotal = &v
	}
	if pm.Valid {
		s := pm.String
		out.ProgressMsg = &s
	}
	if res.Valid {
		s := res.String
		out.ResultJSON = &s
	}
	return out, nil
}

// GetAlbumByID for metadata worker
func (d *DB) GetAlbumByID(ctx context.Context, id uuid.UUID) (title string, year *int, artistName string, err error) {
	var y sql.NullInt32
	var arn sql.NullString
	err = d.Pool.QueryRow(ctx, `
		SELECT
			COALESCE(NULLIF(BTRIM(a.meta_user_title), ''), a.title),
			CASE WHEN a.meta_user_year IS NOT NULL THEN a.meta_user_year ELSE a.year END,
			COALESCE(NULLIF(BTRIM(a.meta_user_artist), ''), ar.name)
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
			t.id,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) AS disp_title,
			t.duration_ms, t.format, t.bitrate_kbps,
			COALESCE(t.meta_user_track_no, t.track_no) AS disp_track_no,
			COALESCE(t.meta_user_disc_no, t.disc_no) AS disp_disc_no,
			CASE WHEN t.meta_user_year IS NOT NULL THEN t.meta_user_year
			ELSE COALESCE(CASE WHEN al.meta_user_year IS NOT NULL THEN al.meta_user_year ELSE al.year END, t.year) END AS disp_year,
			t.album_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) AS disp_album_title,
			t.artist_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) AS disp_artist_name,
			t.art_path,
			`+sqlDispTrackGenres+`,
			t.genres_manual AS pin_genres,
			(t.meta_user_title IS NOT NULL AND BTRIM(COALESCE(t.meta_user_title, '')) <> '') AS pin_title,
			(t.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(t.meta_user_artist, '')) <> '') AS pin_artist,
			(t.meta_user_album IS NOT NULL AND BTRIM(COALESCE(t.meta_user_album, '')) <> '') AS pin_album,
			(t.meta_user_year IS NOT NULL) AS pin_year,
			(t.meta_user_track_no IS NOT NULL) AS pin_track_no,
			(t.meta_user_disc_no IS NOT NULL) AS pin_disc_no
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
			t.id,
			COALESCE(NULLIF(BTRIM(t.meta_user_title), ''), t.title) AS disp_title,
			t.duration_ms, t.format, t.bitrate_kbps,
			COALESCE(t.meta_user_track_no, t.track_no) AS disp_track_no,
			COALESCE(t.meta_user_disc_no, t.disc_no) AS disp_disc_no,
			CASE WHEN t.meta_user_year IS NOT NULL THEN t.meta_user_year
			ELSE COALESCE(CASE WHEN al.meta_user_year IS NOT NULL THEN al.meta_user_year ELSE al.year END, t.year) END AS disp_year,
			t.album_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_album), ''), NULLIF(BTRIM(al.meta_user_title), ''), al.title) AS disp_album_title,
			t.artist_id::text,
			COALESCE(NULLIF(BTRIM(t.meta_user_artist), ''), ar.name) AS disp_artist_name,
			t.art_path,
			`+sqlDispTrackGenres+`,
			t.genres_manual AS pin_genres,
			(t.meta_user_title IS NOT NULL AND BTRIM(COALESCE(t.meta_user_title, '')) <> '') AS pin_title,
			(t.meta_user_artist IS NOT NULL AND BTRIM(COALESCE(t.meta_user_artist, '')) <> '') AS pin_artist,
			(t.meta_user_album IS NOT NULL AND BTRIM(COALESCE(t.meta_user_album, '')) <> '') AS pin_album,
			(t.meta_user_year IS NOT NULL) AS pin_year,
			(t.meta_user_track_no IS NOT NULL) AS pin_track_no,
			(t.meta_user_disc_no IS NOT NULL) AS pin_disc_no
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

// filePathUnderLibraryRoot returns true if trackPath is inside musicRoot (handles Clean/Abs).
func filePathUnderLibraryRoot(trackPath, musicRoot string) bool {
	rootAbs, err := filepath.Abs(filepath.Clean(musicRoot))
	if err != nil || rootAbs == "" || rootAbs == "." {
		rootAbs = filepath.Clean(musicRoot)
	}
	pathAbs, err := filepath.Abs(filepath.Clean(trackPath))
	if err != nil {
		pathAbs = filepath.Clean(trackPath)
	}
	rel, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return true
}

// DeleteTracksUnderRootNotSeen removes rows for files under musicRoot that were not seen during
// a full directory walk (removed or renamed off disk). seenPaths keys must be filepath.Clean paths.
func (d *DB) DeleteTracksUnderRootNotSeen(ctx context.Context, musicRoot string, seenPaths map[string]struct{}) (int64, error) {
	if musicRoot == "" || seenPaths == nil {
		return 0, nil
	}
	rootAbs, err := filepath.Abs(filepath.Clean(musicRoot))
	if err != nil {
		rootAbs = filepath.Clean(musicRoot)
	}
	rows, err := d.Pool.Query(ctx, `SELECT id, file_path FROM tracks`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	const batch = 256
	var ids []uuid.UUID
	flush := func() (int64, error) {
		if len(ids) == 0 {
			return 0, nil
		}
		tag, e := d.Pool.Exec(ctx, `DELETE FROM tracks WHERE id = ANY($1::uuid[])`, ids)
		if e != nil {
			return 0, e
		}
		n := tag.RowsAffected()
		ids = ids[:0]
		return n, nil
	}

	var total int64
	for rows.Next() {
		var id uuid.UUID
		var fp string
		if err := rows.Scan(&id, &fp); err != nil {
			return total, err
		}
		if !filePathUnderLibraryRoot(fp, rootAbs) {
			continue
		}
		k := filepath.Clean(fp)
		if _, ok := seenPaths[k]; ok {
			continue
		}
		ids = append(ids, id)
		if len(ids) >= batch {
			n, e := flush()
			total += n
			if e != nil {
				return total, e
			}
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	n, err := flush()
	total += n
	return total, err
}

// PrunePlaybackQueuesRemovedTracks drops missing track UUIDs from saved playback queues.
func (d *DB) PrunePlaybackQueuesRemovedTracks(ctx context.Context) error {
	_, err := d.Pool.Exec(ctx, `
UPDATE user_playback up
SET
  track_ids = sa.new_ids,
  current_index = CASE
    WHEN cardinality(sa.new_ids) = 0 THEN 0
    WHEN up.current_index < 0 THEN 0
    WHEN up.current_index >= cardinality(sa.new_ids) THEN cardinality(sa.new_ids) - 1
    ELSE up.current_index
  END,
  updated_at = NOW()
FROM (
  SELECT u.user_id,
    COALESCE((
      SELECT array_agg(tt.elem ORDER BY tt.ord)
      FROM unnest(u.track_ids) WITH ORDINALITY AS tt(elem, ord)
      INNER JOIN tracks tr ON tr.id = tt.elem
    ), '{}'::uuid[]) AS new_ids
  FROM user_playback u
) sa
WHERE up.user_id = sa.user_id
  AND sa.new_ids IS DISTINCT FROM up.track_ids`)
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

// PlaybackStaleAfterStop is how long paused state remains restorable after last pause.
const PlaybackStaleAfterStop = 12 * time.Hour

// GetUserPlayback returns saved playback or empty defaults if no row.
func (d *DB) GetUserPlayback(ctx context.Context, userID uuid.UUID) (PlaybackState, error) {
	var st PlaybackState
	var src sql.NullString
	var stopped sql.NullTime
	err := d.Pool.QueryRow(ctx, `
		SELECT track_ids, current_index, position_ms, is_playing, source_playlist_id::text, playback_client_id, owner_epoch, stopped_at, updated_at
		FROM user_playback WHERE user_id = $1
	`, userID).Scan(&st.TrackIDs, &st.CurrentIndex, &st.PositionMs, &st.IsPlaying, &src, &st.PlaybackClientID, &st.OwnerEpoch, &stopped, &st.UpdatedAt)
	if err == pgx.ErrNoRows {
		return PlaybackState{TrackIDs: []uuid.UUID{}, UpdatedAt: time.Now()}, nil
	}
	if err != nil {
		return PlaybackState{}, err
	}
	if stopped.Valid {
		t := stopped.Time
		st.StoppedAt = &t
	}
	if src.Valid && src.String != "" {
		u, err := uuid.Parse(src.String)
		if err == nil {
			st.SourcePlaylistID = &u
		}
	}
	// Drop stale paused snapshot (no resume after 12h since pause).
	if !st.IsPlaying && st.StoppedAt != nil && time.Since(*st.StoppedAt) > PlaybackStaleAfterStop {
		_ = d.ClearUserPlayback(ctx, userID)
		return PlaybackState{TrackIDs: []uuid.UUID{}, UpdatedAt: time.Now()}, nil
	}
	return st, nil
}

// UpsertUserPlayback replaces playback state for the user.
// stoppedAt is set when playing becomes false (pause); cleared when playing is true.
func (d *DB) UpsertUserPlayback(ctx context.Context, userID uuid.UUID, trackIDs []uuid.UUID, idx, posMs int, playing bool, sourcePl *uuid.UUID, playbackClientID string, stoppedAt *time.Time, expectedEpoch, newEpoch int64) (bool, error) {
	if trackIDs == nil {
		trackIDs = []uuid.UUID{}
	}
	res, err := d.Pool.Exec(ctx, `
		INSERT INTO user_playback (user_id, track_ids, current_index, position_ms, is_playing, source_playlist_id, playback_client_id, owner_epoch, stopped_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
		ON CONFLICT (user_id) DO UPDATE SET
			track_ids = EXCLUDED.track_ids,
			current_index = EXCLUDED.current_index,
			position_ms = EXCLUDED.position_ms,
			is_playing = EXCLUDED.is_playing,
			source_playlist_id = EXCLUDED.source_playlist_id,
			playback_client_id = EXCLUDED.playback_client_id,
			owner_epoch = EXCLUDED.owner_epoch,
			stopped_at = EXCLUDED.stopped_at,
			updated_at = now()
		WHERE user_playback.owner_epoch = $10
	`, userID, trackIDs, idx, posMs, playing, sourcePl, playbackClientID, newEpoch, stoppedAt, expectedEpoch)
	if err != nil {
		return false, err
	}
	return res.RowsAffected() > 0, nil
}

// ClearUserPlayback removes saved state (e.g. on logout).
func (d *DB) ClearUserPlayback(ctx context.Context, userID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `DELETE FROM user_playback WHERE user_id = $1`, userID)
	return err
}