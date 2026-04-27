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

1. Создайте папку с музыкой, например `./music`, и укажите путь:
   `export MUSIC_HOST_DIR=/путь/к/музыке` *(или в `docker-compose.yml` заменьте `source: ./music`)*.

2. Запуск:
   ```bash
   docker compose up --build
   ```

3. Веб-интерфейс: [http://localhost:8080](http://localhost:8080)  
4. Создайте учётку через **Register**, затем **Scan library** на главной.

`JWT_SECRET` в `docker-compose.yml` **обязательно смените** для публичного сервера.

## Разработка (без Docker для Go/Node)

Нужен Go 1.22+, Node 20+, PostgreSQL 16+.

```bash
createdb musicsh
export DATABASE_URL=postgres://...
export JWT_SECRET=dev-dev-dev-dev-dev-dev
export MUSIC_DIR=./music
go run ./cmd/server
# другой терминал
cd web && npm install && npm run dev
```

Vite проксирует `/api` на `http://127.0.0.1:8080` (см. `web/vite.config.js`).

## Переменные среды

| Переменная | Смысл |
|------------|--------|
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | Секрет подписи JWT |
| `MUSIC_DIR` | Папка с музыкой (только чтение в prod) |
| `DATA_DIR` | Кэш (обложки) |
| `CORS_ORIGIN` | Список origin через запятую, по умолчанию `*` в конфиге |
| `SCAN_ON_START` | `1` = поставить job сканирования при старте |
| `HTTP_ADDR` | Адрес прослушивания (по умолчанию `0.0.0.0:8080`) |

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
