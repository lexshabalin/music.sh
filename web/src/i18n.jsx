import React from "react";

const LS_LANG = "musicsh_ui_lang";

export const LANGS = [
  { id: "ru", flag: "🇷🇺", label: "Русский" },
  { id: "en", flag: "🇺🇸", label: "English" },
];

export function normalizeLang(x) {
  const s = String(x || "").toLowerCase().trim();
  return s === "en" ? "en" : "ru";
}

export function getStoredLang() {
  try {
    const v = localStorage.getItem(LS_LANG);
    return normalizeLang(v);
  } catch (_) {
    return "ru";
  }
}

export function storeLang(lang) {
  try {
    localStorage.setItem(LS_LANG, normalizeLang(lang));
  } catch (_) {}
}

export function getBootLang() {
  // 1) Prefer lang pre-decided in index.html (prevents first-paint flash).
  try {
    const v = document?.documentElement?.dataset?.uiLang;
    const n = normalizeLang(v);
    if (n) return n;
  } catch (_) {}

  // 2) localStorage
  try {
    const n = normalizeLang(localStorage.getItem(LS_LANG));
    if (n) return n;
  } catch (_) {}

  // 3) browser locale
  try {
    const nav = (navigator?.languages && navigator.languages[0]) || navigator?.language || "";
    const s = String(nav || "").toLowerCase();
    return s.startsWith("en") ? "en" : "ru";
  } catch (_) {
    return "ru";
  }
}

const dict = {
  ru: {
    "auth.login": "Вход",
    "auth.register": "Регистрация",
    "auth.usernameOrEmail": "Имя пользователя или email",
    "auth.username": "Имя пользователя",
    "auth.displayNameOptional": "Отображаемое имя (необязательно)",
    "auth.email": "Email",
    "auth.password": "Пароль",
    "auth.password8": "Пароль (8+)",
    "auth.createAccount": "Создать аккаунт",
    "auth.backToLogin": "Назад к входу",
    "auth.noAccount": "Нет аккаунта?",

    "search.placeholder": "Поиск",
    "search.results": "Результаты поиска",
    "search.clear": "Очистить",
    "search.noMatches": "Нет совпадений",
    "search.songs": "Треки",
    "search.albums": "Альбомы",
    "search.artists": "Артисты",
    "search.playlists": "Плейлисты",
    "search.play": "Играть",
    "search.rescan": "Пересканировать библиотеку",
    "search.scannedFiles": "Просканировано файлов",
    "search.foundTracks": "Найдено треков",

    "library.playAlbum": "Воспроизвести альбом",

    "nav.home": "Главная",
    "nav.songs": "Треки",
    "nav.artists": "Артисты",
    "nav.albums": "Альбомы",
    "nav.genres": "Жанры",
    "nav.playlists": "Плейлисты",
    "nav.likes": "Любимое",

    "menu.profile": "Профиль",
    "menu.profileSettings": "Настройки профиля",
    "menu.logout": "Выйти",
    "menu.toggleNav": "Открыть меню",

    "err.uiCrashed": "Интерфейс сломался",
    "err.openConsole": "Открой DevTools Console, чтобы увидеть ошибку.",
    "err.tryAgain": "Попробовать снова",

    "player.queue": "Далее",
    "player.upNext": "Далее",
    "player.emptyQueue": "Очередь пуста",
    "player.playingRemote": "Музыка воспроизводится на другом устройстве",
    "player.playingOnAnotherDevice": "Воспроизводится на другом устройстве",
    "player.prev": "Предыдущий",
    "player.next": "Следующий",
    "player.rewind": "Назад",
    "player.fastForward": "Вперед",
    "player.play": "Играть",
    "player.pause": "Пауза",
    "player.mute": "Выключить звук",
    "player.unmute": "Включить звук",
    "player.seek": "Перемотка",
    "player.volume": "Громкость",
    "player.like": "Нравится",
    "player.unlike": "Не нравится",
    "player.addToPlaylist": "Добавить в плейлист",

    "missingFile.title": "Упс!",
    "missingFile.trackBody":
      "Упс! Файла нет на диске! Удалить запись о треке из библиотеки? Это затрагивает только базу music.sh.",
    "missingFile.albumBody":
      "Удалить запись об альбоме и все связанные треки только в базе music.sh? На диске ничего не меняется.",
    "missingFile.artistBody":
      "Удалить запись об исполнителе и связанные альбомы/треки только в базе music.sh? На диске ничего не меняется.",
    "missingFile.stripLead": "Удалить записи о ",
    "missingFile.stripTail": " недоступных треках из базы music.sh (файлы на диске не трогаются)?",
    "missingFile.yes": "Да",
    "missingFile.no": "Нет",
    "missingFile.banner": "На диске нет некоторых файлов из этого альбома.",
    "missingFile.bannerArtist": "У этого исполнителя есть записи без файлов на диске.",
    "missingFile.bannerArtistNoTracks":
      "У этого исполнителя нет треков в библиотеке — возможно, это устаревшая запись в базе после удаления файлов или сбоя скана.",
    "missingFile.stripAlbumTracks": "Удалить недоступные треки из БД",
    "missingFile.deleteAlbumDb": "Удалить альбом из БД",
    "missingFile.deleteArtistDb": "Удалить исполнителя из БД",

    "profile.title": "Профиль",
    "profile.close": "Закрыть",
    "profile.uploadAvatar": "Загрузить аватар",
    "profile.background": "Фон",
    "profile.bg.none": "Нет",
    "profile.bg.lava": "Лава",
    "profile.bg.grain": "Зерно",
    "profile.bg.grid": "Сетка",
    "profile.bg.waves": "Волны",
    "profile.bg.upload": "Загрузить",
    "profile.bg.hint": "Пресеты применяются сразу. Загрузка — изображения или GIF.",
    "profile.password.title": "Сменить пароль",
    "profile.password.current": "Текущий пароль",
    "profile.password.new": "Новый пароль (8+)",
    "profile.save": "Сохранить",
    "profile.language": "Язык интерфейса",

    "common.user": "Пользователь",
    "common.track": "Трек",
    "common.untitled": "Без названия",
    "common.loading": "Загрузка…",
    "common.clear": "Очистить",
    "common.cancel": "Отмена",
    "common.deleteFile": "Удалить файл",
    "common.save": "Сохранить",
    "common.error": "Ошибка",
    "common.unknownArtist": "Неизвестный исполнитель",
    "common.unknown": "—",

    "tracks.title": "Название",
    "tracks.artist": "Исполнитель",
    "tracks.trackNo": "№",
    "tracks.album": "Альбом",
    "tracks.time": "Длительность",
    "tracks.like": "Нравится",
    "tracks.more": "Ещё",
    "tracks.nowPlaying": "Сейчас играет",
    "tracks.paused": "Пауза",
    "genres.browseIntro":
      "Список жанров из библиотеки (поле genres у трека и альбома). По каждому жанру — треки, у которых он отображается в интерфейсе.",
    "genres.emptyLibrary": "Пока нет ни одного жанра с треками в библиотеке.",
    "genres.noTracks": "Нет треков с этим жанром.",
    "tracks.shuffle": "Перемешать",
    "tracks.actions": "Действия с треком",
    "tracks.playAria": "Воспроизвести",
    "tracks.playNow": "Играть сейчас",
    "tracks.playNext": "Играть следующим",
    "tracks.addToPlaylist": "Добавить в плейлист",
    "tracks.editMeta": "Править метаданные",

    "playlist.playlists": "Плейлисты",
    "playlist.newPlaylist": "Новый плейлист",
    "playlist.descriptionOptional": "Описание (необязательно)",
    "playlist.create": "Создать",
    "playlist.play": "Воспроизвести плейлист",
    "playlist.more": "Ещё",
    "playlist.delete": "Удалить плейлист",
    "playlist.deleteConfirm": "Удалить плейлист? Это действие нельзя отменить.",

    "likes.title": "Любимое",

    "artists.searchArtists": "Искать артистов…",
    "artists.back": "← Артисты",
    "artists.searchAlbums": "Искать альбомы…",

    "plmodal.title": "Добавить в плейлист",
    "plmodal.help": "Выбери существующий плейлист или создай новый.",
    "plmodal.existing": "Существующий",
    "plmodal.select": "— Выбрать —",
    "plmodal.add": "Добавить",
    "plmodal.new": "Новый плейлист",
    "plmodal.name": "Название",
    "plmodal.desc": "Описание",
    "plmodal.myPlaylist": "Мой плейлист",
    "plmodal.optional": "Необязательно",
    "plmodal.createAdd": "Создать и добавить",

    "trackmeta.coverHint": "JPEG, PNG или WebP. Не заменяет обложку альбома для других треков. Сканирование библиотеки не удаляет свою обложку.",
    "trackmeta.coverUrlHint":
      "Можно вставить ссылку (https): сервер загрузит картинку и сохранит как JPEG.",
    "trackmeta.coverUrlPlaceholder": "https://…",
    "trackmeta.coverFromUrl": "Загрузить по ссылке",
    "trackmeta.coverUrlInvalid": "Некорректная или недоступная ссылка на обложку.",
    "trackmeta.coverUrlNotImage": "По ссылке не удалось получить поддерживаемое изображение.",
    "trackmeta.coverUrlFetchFailed": "Не удалось скачать обложку по ссылке (сеть или удалённый сервер).",
    "trackmeta.uploadError": "Ошибка загрузки",
    "trackmeta.title": "Метаданные трека",
    "trackmeta.help": "Сначала укажите исполнителя — подгрузятся альбомы из библиотеки для этого исполнителя. Можно выбрать готовый альбом (трек унаследует его название, год и обложку) или ввести альбом вручную. Текстовые поля и своя обложка не перезаписываются при повторном сканировании.",
    "trackmeta.loading": "Загрузка…",
    "trackmeta.field.title": "Название",
    "trackmeta.field.artist": "Исполнитель",
    "trackmeta.field.album": "Альбом",
    "trackmeta.field.genre": "Жанры",
    "trackmeta.genreHint":
      "Несколько через «;» или «|». Выпадающий список — жанры, уже встречающиеся в библиотеке. «Сброс» вернёт теги с альбома.",
    "trackmeta.album.pick": "— выберите альбом из библиотеки —",
    "trackmeta.album.custom": "Другой альбом (ввести вручную)…",
    "trackmeta.album.title": "Название альбома",
    "trackmeta.album.artist": "Исполнитель альбома (если отличается)",
    "trackmeta.year": "Год",
    "trackmeta.year.keepAlbum": "Как у альбома, если не менять",
    "trackmeta.year.example": "Напр. 2020",
    "trackmeta.year.hint": "Берётся из альбома. Измените поле, чтобы зафиксировать свой год для трека.",
    "trackmeta.trackNo": "№ трека",
    "trackmeta.discNo": "№ диска",
    "trackmeta.cover": "Обложка",
    "trackmeta.err.needTitle": "Укажите название трека",
    "trackmeta.err.pickAlbumOrCustom": "Выберите альбом из списка или переключитесь на ввод вручную",
    "trackmeta.err.badYear": "Некорректный год",
    "trackmeta.err.badTrackNo": "Некорректный номер трека",
    "trackmeta.err.badDiscNo": "Некорректный номер диска",
    "trackmeta.err.saveFailed": "Ошибка сохранения",
    "trackmeta.optional": "Необязательно",

    "album.editTitle": "Альбом",
    "album.meta.help":
      "Название, исполнитель, год и жанры (несколько тегов через «;») для альбома. Жанры копируются на все треки альбома. Своя обложка не заменяется автоматически из MusicBrainz. «Сбросить» возвращает значение из тегов / снимает закрепление.",
    "album.meta.title": "Название",
    "album.meta.artist": "Исполнитель",
    "album.meta.year": "Год",
    "album.meta.genre": "Жанры",
    "album.meta.genreSuggestHint":
      "Несколько через «;» или «|». В списке — названия уже встречавшиеся в библиотеке.",
    "album.meta.genreRolloutHint": "Сохраняется для альбома и копируется во все его треки; при скане теги файла подмешиваются только если жанры альбома не заданы.",
    "album.meta.cover": "Обложка",
    "album.meta.coverUrlHint":
      "Можно вставить ссылку (https): сервер загрузит картинку, приведёт к разумному размеру и сохранит как JPEG. При импринте она попадёт в теги треков, если включена обложка.",
    "album.meta.coverUrlPlaceholder": "https://…",
    "album.meta.coverFromUrl": "Загрузить по ссылке",
    "album.meta.coverUrlInvalid": "Некорректная или недоступная ссылка на обложку.",
    "album.meta.coverUrlNotImage": "По ссылке не удалось получить поддерживаемое изображение.",
    "album.meta.coverUrlFetchFailed": "Не удалось скачать обложку по ссылке (сеть или удалённый сервер).",
    "album.meta.yearExample": "Напр. 2020",
    "album.meta.reset": "Сбросить",
    "album.meta.needTitle": "Укажите название альбома",
    "album.meta.badYear": "Некорректный год",
    "album.meta.saveError": "Ошибка сохранения",
    "album.meta.uploadError": "Ошибка загрузки",
    "album.editButton": "Редактировать альбом",

    "view.title": "Вид",
    "view.aria": "Выбор вида отображения",
    "view.grid": "Плитка",
    "view.table": "Таблица",

    "album.imprint.intro":
      "Предпросмотр перед записью тегов в файлы. Для каждого трека всегда показаны исполнитель, название, альбом и год; остальные поля видны только если значение отличается от текущего в файле. По умолчанию отмечены только изменяющиеся поля. Расширенный режим показывает все поддерживаемые поля. После успешной записи тегов файл переименовывается в «Исполнитель - Название.расширение» в той же папке (расширение как у текущего файла). Если имя занято, добавляется « (2)», « (3)» и т. д.",
    "album.imprint.fileRenameHint": "Имя файла после импринта:",
    "album.imprint.advanced": "Расширенный режим",
    "album.imprint.advancedHint": "Показать и отредактировать все поддерживаемые поля тегов (даже если они не меняются).",
    "album.imprint.coverEditHint": "Обложка берётся из выбранного источника в библиотеке; хеш нельзя отредактировать вручную.",
    "album.imprint.field.title": "Название",
    "album.imprint.field.artist": "Исполнитель",
    "album.imprint.field.album": "Альбом",
    "album.imprint.field.albumArtist": "Album artist",
    "album.imprint.field.genre": "Жанр",
    "album.imprint.field.composer": "Композитор",
    "album.imprint.field.comment": "Комментарий",
    "album.imprint.field.year": "Год",
    "album.imprint.field.trackNo": "Номер трека",
    "album.imprint.field.discNo": "Номер диска",
    "album.imprint.field.cover": "Обложка",
  },
  en: {
    "auth.login": "Log in",
    "auth.register": "Register",
    "auth.usernameOrEmail": "Username or email",
    "auth.username": "Username",
    "auth.displayNameOptional": "Display name (optional)",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.password8": "Password (8+)",
    "auth.createAccount": "Create account",
    "auth.backToLogin": "Back to login",
    "auth.noAccount": "No account?",

    "search.placeholder": "Search",
    "search.results": "Search results",
    "search.clear": "Clear",
    "search.noMatches": "No matches",
    "search.songs": "Songs",
    "search.albums": "Albums",
    "search.artists": "Artists",
    "search.playlists": "Playlists",
    "search.play": "Play",
    "search.rescan": "Rescan library",
    "search.scannedFiles": "Scanned files",
    "search.foundTracks": "Found tracks",

    "library.playAlbum": "Play album",

    "nav.home": "Home",
    "nav.songs": "Songs",
    "nav.artists": "Artists",
    "nav.albums": "Albums",
    "nav.genres": "Genres",
    "nav.playlists": "Playlists",
    "nav.likes": "Likes",

    "menu.profile": "Profile",
    "menu.profileSettings": "Profile settings",
    "menu.logout": "Log out",
    "menu.toggleNav": "Toggle navigation",

    "err.uiCrashed": "UI crashed",
    "err.openConsole": "Open DevTools Console to see the error.",
    "err.tryAgain": "Try again",

    "player.queue": "Up next",
    "player.upNext": "Up next",
    "player.emptyQueue": "Empty queue",
    "player.playingRemote": "Music is playing on another device",
    "player.playingOnAnotherDevice": "Playing on another device",
    "player.prev": "Previous",
    "player.next": "Next",
    "player.rewind": "Rewind",
    "player.fastForward": "Fast-forward",
    "player.play": "Play",
    "player.pause": "Pause",
    "player.mute": "Mute",
    "player.unmute": "Unmute",
    "player.seek": "Seek",
    "player.volume": "Volume",
    "player.like": "Like",
    "player.unlike": "Unlike",
    "player.addToPlaylist": "Add to playlist",

    "missingFile.title": "Whoops!",
    "missingFile.trackBody":
      "Whoops! File is missing! Remove record from library? This change affects only the music.sh database.",
    "missingFile.albumBody":
      "Remove this album record and related tracks only from the music.sh database? Nothing on disk will be touched.",
    "missingFile.artistBody":
      "Remove this artist record and related albums/tracks only from the music.sh database? Nothing on disk will be touched.",
    "missingFile.stripLead": "Remove database records for ",
    "missingFile.stripTail": " tracks whose files are missing on disk?",
    "missingFile.yes": "Yes",
    "missingFile.no": "No",
    "missingFile.banner": "Some audio files referenced by this album are missing on disk.",
    "missingFile.bannerArtist": "This artist still has tracks with missing audio files.",
    "missingFile.bannerArtistNoTracks":
      "This artist has no tracks in the library — the database row may be stale after removed files or a scan issue.",
    "missingFile.stripAlbumTracks": "Remove missing-track records",
    "missingFile.deleteAlbumDb": "Remove album from database",
    "missingFile.deleteArtistDb": "Remove artist from database",

    "profile.title": "Profile",
    "profile.close": "Close",
    "profile.uploadAvatar": "Upload avatar",
    "profile.background": "Background",
    "profile.bg.none": "None",
    "profile.bg.lava": "Lava",
    "profile.bg.grain": "Grain",
    "profile.bg.grid": "Grid",
    "profile.bg.waves": "Waves",
    "profile.bg.upload": "Upload",
    "profile.bg.hint": "Presets apply instantly. Upload supports images and GIFs.",
    "profile.password.title": "Change password",
    "profile.password.current": "Current password",
    "profile.password.new": "New password (8+)",
    "profile.save": "Save",
    "profile.language": "Interface language",

    "common.user": "User",
    "common.track": "Track",
    "common.untitled": "Untitled",
    "common.loading": "Loading…",
    "common.clear": "Clear",
    "common.cancel": "Cancel",
    "common.deleteFile": "Delete file",
    "common.save": "Save",
    "common.error": "Error",
    "common.unknownArtist": "Unknown Artist",
    "common.unknown": "—",

    "tracks.title": "Title",
    "tracks.artist": "Artist",
    "tracks.trackNo": "#",
    "tracks.album": "Album",
    "tracks.time": "Time",
    "tracks.like": "Like",
    "tracks.more": "More",
    "tracks.nowPlaying": "Now playing",
    "tracks.paused": "Paused",
    "genres.browseIntro":
      "Genres derived from library metadata (track and album genres). Each entry lists tracks where that genre is shown in the app.",
    "genres.emptyLibrary": "No genres with tracks yet.",
    "genres.noTracks": "No tracks for this genre.",
    "tracks.shuffle": "Shuffle",
    "tracks.actions": "Track actions",
    "tracks.playAria": "Play",
    "tracks.playNow": "Play now",
    "tracks.playNext": "Play next",
    "tracks.addToPlaylist": "Add to playlist",
    "tracks.editMeta": "Edit metadata",

    "playlist.playlists": "Playlists",
    "playlist.newPlaylist": "New playlist",
    "playlist.descriptionOptional": "Description (optional)",
    "playlist.create": "Create",
    "playlist.play": "Play playlist",
    "playlist.more": "More",
    "playlist.delete": "Delete playlist",
    "playlist.deleteConfirm": "Delete this playlist? This cannot be undone.",

    "likes.title": "Likes",

    "artists.searchArtists": "Search artists…",
    "artists.back": "← Artists",
    "artists.searchAlbums": "Search albums…",

    "plmodal.title": "Add to playlist",
    "plmodal.help": "Pick an existing playlist, or create a new one.",
    "plmodal.existing": "Existing",
    "plmodal.select": "— Select —",
    "plmodal.add": "Add",
    "plmodal.new": "New playlist",
    "plmodal.name": "Name",
    "plmodal.desc": "Description",
    "plmodal.myPlaylist": "My playlist",
    "plmodal.optional": "Optional",
    "plmodal.createAdd": "Create & add",

    "trackmeta.coverHint": "JPEG, PNG, or WebP. Does not replace the album cover for other tracks. Library rescan will not remove your custom cover.",
    "trackmeta.coverUrlHint":
      "Paste an https URL: the server downloads the image and saves it as JPEG.",
    "trackmeta.coverUrlPlaceholder": "https://…",
    "trackmeta.coverFromUrl": "Load from URL",
    "trackmeta.coverUrlInvalid": "Invalid or disallowed cover URL.",
    "trackmeta.coverUrlNotImage": "The URL did not yield a supported image.",
    "trackmeta.coverUrlFetchFailed": "Could not download the cover from the URL (network or remote server error).",
    "trackmeta.uploadError": "Upload failed",
    "trackmeta.title": "Track metadata",
    "trackmeta.help": "Start by setting the artist — albums from your library will load for this artist. You can pick an existing album (the track will inherit its title, year, and cover) or enter album info manually. Text fields and your custom cover are not overwritten on rescan.",
    "trackmeta.loading": "Loading…",
    "trackmeta.field.title": "Title",
    "trackmeta.field.artist": "Artist",
    "trackmeta.field.album": "Album",
    "trackmeta.field.genre": "Genres",
    "trackmeta.genreHint":
      "Separate tags with ; or |. Dropdown lists genres already used in your library. Reset restores tags inherited from the album.",
    "trackmeta.album.pick": "— choose an album from library —",
    "trackmeta.album.custom": "Other album (enter manually)…",
    "trackmeta.album.title": "Album title",
    "trackmeta.album.artist": "Album artist (if different)",
    "trackmeta.year": "Year",
    "trackmeta.year.keepAlbum": "Same as album unless changed",
    "trackmeta.year.example": "e.g. 2020",
    "trackmeta.year.hint": "Inherited from the album. Change it to pin a custom year for this track.",
    "trackmeta.trackNo": "Track #",
    "trackmeta.discNo": "Disc #",
    "trackmeta.cover": "Cover",
    "trackmeta.err.needTitle": "Please provide a track title",
    "trackmeta.err.pickAlbumOrCustom": "Pick an album from the list or switch to manual entry",
    "trackmeta.err.badYear": "Invalid year",
    "trackmeta.err.badTrackNo": "Invalid track number",
    "trackmeta.err.badDiscNo": "Invalid disc number",
    "trackmeta.err.saveFailed": "Save failed",
    "trackmeta.optional": "Optional",

    "album.editTitle": "Album",
    "album.meta.help":
      "Title, artist, year, and genres (multiple tags with ;) for this album; genres roll out to every track. Custom cover is not auto-replaced from MusicBrainz. “Reset” restores values / unpins the field.",
    "album.meta.title": "Title",
    "album.meta.artist": "Artist",
    "album.meta.year": "Year",
    "album.meta.genre": "Genres",
    "album.meta.genreSuggestHint":
      "Separate tags with ; or |. Dropdown lists genre names already seen in your library.",
    "album.meta.genreRolloutHint":
      "Saved on the album and copied to every track; file-tag genres from scan merge in only when the album has no genre tags set.",
    "album.meta.cover": "Cover",
    "album.meta.coverUrlHint":
      "Or paste an HTTPS URL: the server downloads the image, scales it down, saves as JPEG, and imprint can embed it in track tags when cover is selected.",
    "album.meta.coverUrlPlaceholder": "https://…",
    "album.meta.coverFromUrl": "Load from URL",
    "album.meta.coverUrlInvalid": "Invalid or disallowed cover URL.",
    "album.meta.coverUrlNotImage": "The URL did not yield a supported image.",
    "album.meta.coverUrlFetchFailed": "Could not download the cover from the URL (network or remote server error).",
    "album.meta.yearExample": "e.g. 2020",
    "album.meta.reset": "Reset",
    "album.meta.needTitle": "Please provide an album title",
    "album.meta.badYear": "Invalid year",
    "album.meta.saveError": "Save failed",
    "album.meta.uploadError": "Upload failed",
    "album.editButton": "Edit album",

    "view.title": "View",
    "view.aria": "Choose view mode",
    "view.grid": "Grid",
    "view.table": "Table",

    "album.imprint.intro":
      "Preview before writing tags to files. Artist, title, album, and year appear for every track; other fields only show when the value differs from what is in the file. By default only fields that change are checked. Advanced mode reveals all supported fields. After tags are written successfully each file is renamed to Artist - Title.extension in the same folder (same extension as the current file). If that name is taken, suffixes « (2)», « (3)» etc. are used.",
    "album.imprint.fileRenameHint": "Filename after imprint:",
    "album.imprint.advanced": "Advanced mode",
    "album.imprint.advancedHint": "Show and edit all supported tag fields (even if unchanged).",
    "album.imprint.coverEditHint": "Cover is taken from the library-selected source; the hash cannot be edited manually.",
    "album.imprint.field.title": "Title",
    "album.imprint.field.artist": "Artist",
    "album.imprint.field.album": "Album",
    "album.imprint.field.albumArtist": "Album artist",
    "album.imprint.field.genre": "Genre",
    "album.imprint.field.composer": "Composer",
    "album.imprint.field.comment": "Comment",
    "album.imprint.field.year": "Year",
    "album.imprint.field.trackNo": "Track #",
    "album.imprint.field.discNo": "Disc #",
    "album.imprint.field.cover": "Cover",
  },
};

export const I18nContext = React.createContext({
  lang: "ru",
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({ initialLang, children }) {
  const [lang, setLangState] = React.useState(normalizeLang(initialLang || getBootLang()));

  const setLang = React.useCallback((next) => {
    const l = normalizeLang(next);
    setLangState(l);
    storeLang(l);
  }, []);

  const t = React.useCallback(
    (key) => {
      const l = normalizeLang(lang);
      return dict?.[l]?.[key] ?? dict?.en?.[key] ?? String(key);
    },
    [lang]
  );

  const value = React.useMemo(() => ({ lang: normalizeLang(lang), setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return React.useContext(I18nContext);
}

