# MusicSH

Self-hosted web player. It reads audio from a folder on the server, scans tags, streams tracks, and stores users, playlists, and likes. Metadata and cover art come from MusicBrainz and the Cover Art Archive. With an AcoustID key, tracks can be identified from a fingerprint (`fpcalc`).

The web UI is embedded in the same binary. The database is PostgreSQL.

## Docker Compose

Put a `.env` file next to `docker-compose.yml`. The only required variable is `MUSIC_HOST_DIR`: an absolute path to the music directory on the host. Compose mounts it into the container as `/music`, read-only.

```bash
docker compose build
docker compose up -d --no-build
```

Open [http://localhost:8180](http://localhost:8180). Create an account with Register, then run Scan library. A scan on startup is off.

The same compose file starts Postgres 16. The default password is `musicsh`; set `POSTGRES_PASSWORD` for a server that is not localhost. On first start the JWT key is written into the data volume (`/data/.jwt_secret`) and kept across restarts.

Writing tags back into files (imprint) needs the library directory mounted without `:ro`. The compose file in this repo mounts the library read-only.

### `.env` variables for Compose

Compose substitutes these into the services. Optional variables that are left unset use the value in the Default column.

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `MUSIC_HOST_DIR` | yes | — | Music directory on the host, mounted at `/music:ro` |
| `POSTGRES_PASSWORD` | no | `musicsh` | Password for the `musicsh` Postgres user, also used in the app `DATABASE_URL` |
| `MUSICSH_PORT` | no | `8180` | Host port. Inside the container the app listens on `8080` |
| `ACOUSTID_KEY` | no | empty | [AcoustID](https://acoustid.org/new-application) API key. Fingerprint lookup stays off when this is empty |
| `WORKER_CONCURRENCY` | no | `1` | Parallel background jobs, from 1 to 8 |
| `WORKER_POLL_SECONDS` | no | `8` | Pause between job-queue polls, 1–60 seconds |
| `MUSICSH_MEDIA_PROC_SLOTS` | no | `2` | How many `ffprobe` / `ffmpeg` / `fpcalc` processes may run at once. `0` means no limit |
| `LIBRARY_SCAN_YIELD_EVERY` | no | `12` | Pause the scan every N audio files. `0` together with `LIBRARY_SCAN_YIELD_MS` turns the pauses off |
| `LIBRARY_SCAN_YIELD_MS` | no | `60` | Length of that pause, in milliseconds |
| `LIBRARY_SCAN_DIR_YIELD_EVERY` | no | `6` | Pause every N directories opened while walking the tree. `0` turns it off |
| `LIBRARY_SCAN_DIR_YIELD_MS` | no | `35` | Length of the directory pause, in milliseconds |
| `SCAN_PROGRESS_INTERVAL_MS` | no | `1000` | Minimum interval between scan progress updates |
| `SCAN_PROGRESS_MIN_FILES` | no | `40` | How many new files trigger a progress update before the interval elapses |
| `MUSICSH_SCAN_FOLLOW_SYMLINKS` | no | `1` | Descend into directory symlinks. `0` or `false` skips them |
| `MUSICSH_SCAN_CONTINUE_ON_ERROR` | no | `1` | Log a single-file error and keep scanning. `0` or `false` stops on the first error |

Compose sets `DATABASE_URL`, `MUSIC_DIR=/music`, `DATA_DIR=/data`, and `HTTP_ADDR=0.0.0.0:8080` on the app itself. Those do not belong in `.env`.

## Image without Compose

You need a running PostgreSQL and a built image.

```bash
docker build -t musicsh .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL='postgres://musicsh:musicsh@host.docker.internal:5432/musicsh?sslmode=disable' \
  -e MUSIC_DIR=/music \
  -e DATA_DIR=/data \
  -v /absolute/path/to/music:/music:ro \
  -v musicsh_data:/data \
  musicsh
```

`DATABASE_URL` is required; the process exits without it. Defaults are `MUSIC_DIR=/music`, `DATA_DIR=/data`, and `HTTP_ADDR=0.0.0.0:8080`.

The other variables from the table above apply here too, except `MUSIC_HOST_DIR`, `POSTGRES_PASSWORD`, and `MUSICSH_PORT`: those are Compose substitutions and never enter the container. With no explicit values the code uses its own defaults: `WORKER_CONCURRENCY=3`, `WORKER_POLL_SECONDS=4`, `MUSICSH_MEDIA_PROC_SLOTS=4`, scan pauses of `20` files / `45` ms and `8` directories / `25` ms.

Extra variables when you run the image yourself:

| Variable | Meaning |
|----------|---------|
| `JWT_SECRET` | Session signing key, at least 16 characters. When unset, the server creates `$DATA_DIR/.jwt_secret` |
| `CORS_ORIGIN` | Allowed origins, comma-separated. Empty means `*`, without credentialed CORS |
| `SCAN_ON_START` | `1` enqueues a full library scan on every process start |
| `MUSICSH_SCAN_MAX_DEPTH` | Maximum directory nesting during a scan. Default `256`, ceiling `10000` |
| `MUSICSH_DISABLE_PLAYBACK_TRANSCODE` | `1` / `true` / `yes` serves the file as-is, with no MP3 transcode through `ffmpeg` |
| `MUSICSH_DISABLE_DISK_IO_PRIORITY` | `1` skips lowering `ffprobe` / `ffmpeg` / `fpcalc` priority via `ionice` and `nice` (Linux only) |
| `MUSICSH_LOG_DISK_ACCESS` | `1` / `true` / `yes` / `on` logs disk access to stdout (stream opens, tag reads, `ffprobe`, covers) |
