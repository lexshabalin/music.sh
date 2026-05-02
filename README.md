# MusicSH

Self‑hosted веб‑приложение для прослушивания музыки из **локальной папки** на сервере: пользователи, плейлисты, лайки, плейлист‑как, скан библиотеки, **MusicBrainz + Cover Art Archive** для метаданных и обложек (без алгоритмов рекомендаций, как план).

## Возможности (MVP)

- Регистрация / логин (JWT)
- Сканирование каталога с аудиофайлами (теги через `dhowden/tag`, MP3/FLAC/…)
- Список артистов / альбомов / треков, поиск, стрим **с поддержкой HTTP Range** (`/api/tracks/{id}/stream?token=…` для тега `<audio>`)
- Плейлисты (создать, добавить треки, удалить)
- Лайки
- Очередь джобов: `scan` и `fetch_album` (подтягивание release MB + обложка в `/data/covers/…`)

## Запуск Docker Compose

1. Скопируйте `cp .env.example .env` и задайте **`MUSIC_HOST_DIR`** (абсолютный путь к каталогу с музыкой на хосте, доступный Docker). По желанию смените **`POSTGRES_PASSWORD`**. Секрет JWT создаётся сам при первом запуске и хранится в томе данных как **`DATA_DIR/.jwt_secret`** — задавать **`JWT_SECRET`** не нужно, если только вы не хотите явный ключ (например, несколько реплик с общим ключом).

2. Запуск (поднимается Postgres 16 и приложение). Первый раз соберите образ отдельно — так проще держать хост живым на слабом железе, чем `up --build` за один шаг:
   ```bash
   docker compose build
   docker compose up -d --no-build
   ```

3. Веб-интерфейс: [http://localhost:8180](http://localhost:8180)
4. Создайте учётку через **Register**, затем **Scan library** на главной (автоскан при старте **не** включён в compose по умолчанию — см. **`SCAN_ON_START`**).

Если нужен только образ без compose: см. **`Dockerfile`**. Для публичного сервера усильте **`POSTGRES_PASSWORD`** и настройте резервное копирование тома с **`/data`** (там же лежит **`.jwt_secret`**).

## Деплой через GitLab CI (`deploy:prod`)

Репозиторий **не заливает `.env`**. На сервере нужен хотя бы **`MUSIC_HOST_DIR`** в **`$DEPLOY_DIR/.env`** (или экспорт переменной окружения перед `docker compose`).

Через GitLab: переменная **`MUSIC_HOST_DIR`** и включите **`DEPLOY_WRITE_ENV_FROM_CI=1`** — на каждый деплой в `$DEPLOY_DIR/.env` запишется эта строка (при желании добавьте в шаг свой блок с другими ключами).

## Разработка (без Docker для Go/Node)

Нужен Go 1.22+, Node 20+, PostgreSQL 16+.

```bash
createdb musicsh
export DATABASE_URL=postgres://...
export MUSIC_DIR=./music
# optional: JWT_SECRET=...  (omit to auto-write ./data/.jwt_secret)
go run ./cmd/server
# другой терминал
cd web && npm install && npm run dev
```

Vite проксирует `/api` на `http://127.0.0.1:8080` (см. `web/vite.config.js`).

## Переменные среды

| Переменная | Смысл |
|------------|--------|
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | Необязательно; если не задан — генерируется и сохраняется в **`$DATA_DIR/.jwt_secret`** (путь по умолчанию в контейнере `/data/.jwt_secret`) |
| `MUSIC_DIR` | Папка с музыкой (только чтение в prod) |
| `DATA_DIR` | Кэш (обложки) и файл **`.jwt_secret`**, если не используете **`JWT_SECRET`** |
| `CORS_ORIGIN` | Список origin через запятую, по умолчанию `*` в конфиге |
| `SCAN_ON_START` | `1` = полный скан библиотеки при каждом старте процесса (осторожно при частых деплоях и больших коллекциях) |
| `WORKER_CONCURRENCY` | Параллельных обработчиков фоновых джобов (1–8, по умолчанию без env: **3**) |
| `LIBRARY_SCAN_YIELD_EVERY`, `LIBRARY_SCAN_YIELD_MS` | Пауза `…_MS` мс каждые `…_EVERY` обработанных аудиофайлов при скане (если переменные не заданы вне Docker — по умолчанию **выключено**, внутри **`docker-compose.yml`** заданы ориентированные на **HDD**) |
| `HTTP_ADDR` | Адрес прослушивания (по умолчанию `0.0.0.0:8080`) |

Дополнительно при использовании репозиторного **`docker-compose.yml`**: `MUSIC_HOST_DIR`, `POSTGRES_PASSWORD`, опционально `MUSICSH_PORT`.

**Большая библиотека на одном жёстком диске с VM/PostgreSQL.** Скан дергаёт тысячи мелких чтений и часто **`ffprobe`** по файлам — на HDD это даёт минуты/часы высокого **iowait**; гипервизор и гости «замирают», в логах Proxmox при этом может не быть ошибок. Имеет смысл держать **диск виртуальной машины и `pgdata` на SSD**, а HDD отдавать приложению **только под музыку** (`:ro`); первый **`Scan library`** запускать в спокойное время. Смягчение — переменные **`LIBRARY_SCAN_YIELD_*`** и **`WORKER_CONCURRENCY=1`** в compose.

**Если после деплоя «падает» Proxmox или зависает сеть хранилища:** сборка образа на той же VM (`docker compose build`) может на минуты загрузить **все ядра и диск** — лимиты `cpus` / `mem_limit` в compose на это не действуют (они только на **запущенные** контейнеры). Скрипт **`scripts/deploy_remote.sh`** уже собирает образ с **`nice`/ionice** и ограничениями Node/Go в **`Dockerfile`**. Не совмещайте тяжёлый **`docker compose build`**, полный **`Scan library`** и копирование по **SMB/NFS** в один момент; при слабом железе перенесите сборку в registry (push в CI, на сервере **`pull`** + **`up`**).

## API (кратко)

- `POST /api/auth/register` `{ "email", "password", "displayName?" }`
- `POST /api/auth/login`
- `GET /api/artists`, `GET /api/albums`, `GET /api/tracks?query&albumId=`
- `GET /api/tracks/{id}/stream` — `Authorization: Bearer` или `?token=`
- `GET /api/albums/{id}/cover` — то же для картинки
- `POST /api/library/scan` — поставить скан в очередь
- Плейлисты и лайки — под `/api/playlists` и `/api/likes`

## Музыка

Поддержка расширений (через скан): `.mp3` `.flac` `.m4a` `.aac` `.ogg` `.opus` `.wav`.

## Лицензия

MIT (по желанию; проект-шаблон self-hosted).
