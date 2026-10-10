# MusicSH

Self-hosted веб-плеер: читает аудио из папки на сервере, сканирует теги, стримит треки, хранит пользователей, плейлисты и лайки. Метаданные и обложки подтягиваются из MusicBrainz и Cover Art Archive. Если задан ключ AcoustID, треки можно опознать по отпечатку (`fpcalc`).

Веб-интерфейс вшит в тот же бинарник. База — PostgreSQL.

## Docker Compose

Рядом с `docker-compose.yml` нужен файл `.env`. Обязательна только `MUSIC_HOST_DIR` — абсолютный путь к каталогу с музыкой на хосте. Compose монтирует его в контейнер как `/music` только для чтения.

```bash
docker compose build
docker compose up -d --no-build
```

Интерфейс: [http://localhost:8180](http://localhost:8180). Учётку создайте через Register, затем Scan library. Автоскан при старте выключен.

Postgres 16 поднимается тем же compose. Пароль по умолчанию `musicsh`; для сервера вне localhost задайте `POSTGRES_PASSWORD`. JWT-ключ при первом старте пишется в том данных (`/data/.jwt_secret`) и переживает перезапуск.

Запись тегов в файлы (imprint) требует каталог библиотеки без `:ro`. В репозиторном compose библиотека смонтирована только для чтения.

### Переменные `.env` для compose

Compose подставляет их в сервисы. Незаданные необязательные берут значение из колонки «по умолчанию».

| Переменная | Обязательна | По умолчанию | Смысл |
|------------|-------------|--------------|--------|
| `MUSIC_HOST_DIR` | да | — | Каталог с музыкой на хосте, монтируется в `/music:ro` |
| `POSTGRES_PASSWORD` | нет | `musicsh` | Пароль пользователя `musicsh` в Postgres и в `DATABASE_URL` приложения |
| `MUSICSH_PORT` | нет | `8180` | Порт на хосте; внутри контейнера приложение слушает `8080` |
| `ACOUSTID_KEY` | нет | пусто | Ключ [AcoustID](https://acoustid.org/new-application). Без него опознание по отпечатку не работает |
| `WORKER_CONCURRENCY` | нет | `1` | Параллельных фоновых джобов, от 1 до 8 |
| `WORKER_POLL_SECONDS` | нет | `8` | Пауза между опросами очереди джобов, 1–60 с |
| `MUSICSH_MEDIA_PROC_SLOTS` | нет | `2` | Сколько `ffprobe` / `ffmpeg` / `fpcalc` могут работать одновременно. `0` — без лимита |
| `LIBRARY_SCAN_YIELD_EVERY` | нет | `12` | Пауза скана каждые N аудиофайлов. `0` вместе с `LIBRARY_SCAN_YIELD_MS` отключает паузы |
| `LIBRARY_SCAN_YIELD_MS` | нет | `60` | Длительность этой паузы, мс |
| `LIBRARY_SCAN_DIR_YIELD_EVERY` | нет | `6` | Пауза каждые N открытых каталогов при обходе дерева. `0` отключает |
| `LIBRARY_SCAN_DIR_YIELD_MS` | нет | `35` | Длительность паузы по каталогам, мс |
| `SCAN_PROGRESS_INTERVAL_MS` | нет | `1000` | Минимальный интервал обновления прогресса скана |
| `SCAN_PROGRESS_MIN_FILES` | нет | `40` | Сколько новых файлов нужно, чтобы обновить прогресс раньше интервала |
| `MUSICSH_SCAN_FOLLOW_SYMLINKS` | нет | `1` | Заходить в каталоги-симлинки. `0` или `false` — не заходить |
| `MUSICSH_SCAN_CONTINUE_ON_ERROR` | нет | `1` | Ошибка одного файла пишется в лог, скан идёт дальше. `0` или `false` — остановиться на первой ошибке |

Compose сам выставляет приложению `DATABASE_URL`, `MUSIC_DIR=/music`, `DATA_DIR=/data` и `HTTP_ADDR=0.0.0.0:8080`. Их в `.env` писать не нужно.

## Образ без Compose

Нужен уже запущенный PostgreSQL и собранный образ.

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

`DATABASE_URL` обязательна: без неё процесс не стартует. `MUSIC_DIR` по умолчанию `/music`, `DATA_DIR` — `/data`, `HTTP_ADDR` — `0.0.0.0:8080`.

Остальные переменные те же, что в таблице выше, кроме `MUSIC_HOST_DIR`, `POSTGRES_PASSWORD` и `MUSICSH_PORT`: это подстановки compose, внутрь контейнера они не попадают. Без явных значений код берёт свои дефолты: `WORKER_CONCURRENCY=3`, `WORKER_POLL_SECONDS=4`, `MUSICSH_MEDIA_PROC_SLOTS=4`, паузы скана `20` файлов / `45` мс и `8` каталогов / `25` мс.

Дополнительно, если запускаете образ сами:

| Переменная | Смысл |
|------------|--------|
| `JWT_SECRET` | Ключ подписи сессий, минимум 16 символов. Если не задан, создаётся файл `$DATA_DIR/.jwt_secret` |
| `CORS_ORIGIN` | Разрешённые origin через запятую. Пусто — `*`, без credentialed CORS |
| `SCAN_ON_START` | `1` — поставить полный скан в очередь при каждом старте процесса |
| `MUSICSH_SCAN_MAX_DEPTH` | Максимальная вложенность каталогов при скане. По умолчанию `256`, потолок `10000` |
| `MUSICSH_DISABLE_PLAYBACK_TRANSCODE` | `1` / `true` / `yes` — отдавать файл как есть, без перекодирования в MP3 через `ffmpeg` |
| `MUSICSH_DISABLE_DISK_IO_PRIORITY` | `1` — не понижать приоритет `ffprobe` / `ffmpeg` / `fpcalc` через `ionice` и `nice` (только Linux) |
| `MUSICSH_LOG_DISK_ACCESS` | `1` / `true` / `yes` / `on` — писать в stdout обращения к диску (открытие стрима, чтение тегов, `ffprobe`, обложки) |
