import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { effectiveTrackCoverUrl, getToken, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";

function ResetPinButton({ onClick, busy }) {
  return (
    <button
      type="button"
      className="ghost"
      style={{ fontSize: "0.75rem", marginLeft: 8, padding: "2px 6px" }}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      Сбросить
    </button>
  );
}

function AlbumMetaModal({ albumId, album, onClose, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState(album?.title || "");
  const [artist, setArtist] = useState(album?.artistName || "");
  const [year, setYear] = useState(album?.year != null ? String(album.year) : "");

  useEffect(() => {
    setTitle(album?.title || "");
    setArtist(album?.artistName || "");
    setYear(album?.year != null ? String(album.year) : "");
  }, [album]);

  const m = album?.meta || {};

  const resetField = async (field) => {
    setBusy(true);
    setErr("");
    try {
      await lib.patchAlbumMeta(albumId, { clear: [field] });
      onRefresh();
    } catch (e) {
      setErr(e.message || "Ошибка");
    }
    setBusy(false);
  };

  const save = async () => {
    if (!title.trim()) {
      setErr("Укажите название альбома");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const clear = [];
      if (!year.trim() && m.year) clear.push("year");
      const body = {
        title: title.trim(),
        artistName: artist.trim(),
        clear,
      };
      if (year.trim()) {
        const y = parseInt(year, 10);
        if (!Number.isFinite(y)) throw new Error("Некорректный год");
        body.year = y;
      }
      await lib.patchAlbumMeta(albumId, body);
      onRefresh();
      onClose();
    } catch (e) {
      setErr(e.message || "Ошибка сохранения");
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Альбом</h3>
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: "-0.5rem" }}>
          Название, исполнитель и год для всех треков этого альбома в библиотеке. Своя обложка не заменяется
          автоматически из MusicBrainz. «Сбросить» возвращает значение из тегов / снимает закрепление.
        </p>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        <p>
          <label>
            Название {m.title ? <ResetPinButton onClick={() => resetField("title")} busy={busy} /> : null}
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </p>
        <p>
          <label>
            Исполнитель {m.artist ? <ResetPinButton onClick={() => resetField("artist")} busy={busy} /> : null}
          </label>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </p>
        <p>
          <label>
            Год {m.year ? <ResetPinButton onClick={() => resetField("year")} busy={busy} /> : null}
          </label>
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Напр. 2020" />
        </p>
        <p>
          <label>
            Обложка {m.cover ? <ResetPinButton onClick={() => resetField("cover")} busy={busy} /> : null}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            {album?.coverUrl || m.cover ? (
              <img
                src={lib.coverUrl(albumId)}
                alt=""
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }}
              />
            ) : (
              <div style={{ width: 96, height: 96, background: "#222", borderRadius: 8 }} />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setErr("");
                try {
                  await lib.uploadAlbumCover(albumId, file);
                  onRefresh();
                } catch (ex) {
                  setErr(ex.message || "Ошибка загрузки");
                }
                setBusy(false);
              }}
            />
            {(album?.coverUrl || m.cover) && (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  try {
                    await lib.deleteAlbumCover(albumId);
                    onRefresh();
                  } catch (ex) {
                    setErr(ex.message || "Ошибка");
                  }
                  setBusy(false);
                }}
              >
                Удалить файл
              </button>
            )}
          </div>
        </p>
        <p style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button type="button" disabled={busy} onClick={save}>
            Сохранить
          </button>
        </p>
      </div>
    </div>
  );
}

function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortTracks(list, key, dir) {
  const a = Array.isArray(list) ? list.slice() : [];
  const mult = dir === "desc" ? -1 : 1;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const get = (t) => {
    if (key === "title") return (t?.title || "").toString();
    if (key === "artist") return (t?.artist?.name || "").toString();
    return "";
  };
  return a
    .map((t, i) => ({ t, i }))
    .sort((x, y) => {
      const ax = get(x.t);
      const ay = get(y.t);
      const r = coll.compare(ax, ay);
      return r !== 0 ? r * mult : (x.i - y.i);
    })
    .map((x) => x.t);
}

export function Album() {
  const { id } = useParams();
  const [tr, setTr] = useState([]);
  const [a, setA] = useState(null);
  const [editAlbum, setEditAlbum] = useState(false);
  const [liked, setLiked] = useState(new Set());
  const [sortKey, setSortKey] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
  const p = usePlayer();
  const load = () => {
    lib
      .tracks("", id)
      .then((x) => setTr(Array.isArray(x) ? x : []))
      .catch(() => setTr([]));
    lib
      .album(id)
      .then(setA)
      .catch(() => setA(null));
    lib
      .likeIds()
      .then((r) => setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : [])))
      .catch(() => setLiked(new Set()));
  };
  useEffect(() => {
    load();
  }, [id]);

  const sortedTracks = sortTracks(tr, sortKey, sortDir);

  const playAt = (startIdx) => {
    // Playback order should follow album track order (unsorted).
    if (!tr.length) return;
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    }));
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    p.playQueue(items, idx);
    // iOS Safari: call play() from the click handler for guaranteed first tap.
    try {
      const el = p.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };

  const shuffle = () => {
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    }));
    const shuffled = shuffleCopy(items);
    if (shuffled.length) p.playQueue(shuffled, 0);
  };

  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    };
    if (!p.current) {
      p.playQueue([item], 0);
      return;
    }
    p.playNext(item);
  };
  const toggleLike = async (trackId) => {
    const on = liked.has(trackId);
    try {
      if (on) await lib.unlike(trackId);
      else await lib.like(trackId);
      const next = new Set(liked);
      if (on) next.delete(trackId);
      else next.add(trackId);
      setLiked(next);
    } catch (_) {}
  };
  return (
    <div>
      <p>
        <Link to="/" className="muted">
          ← Home
        </Link>
      </p>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", minWidth: 0 }}>
        {a?.coverUrl ? (
          <img
            src={lib.coverUrl(a.id)}
            alt=""
            style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8 }}
          />
        ) : (
          <div style={{ width: 120, height: 120, background: "#222" }} />
        )}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>
            {a?.title || "Album"}
            {a?.year != null ? (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                ({a.year})
              </span>
            ) : null}
          </h2>
          <div className="muted">{a?.artistName}</div>
        </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {getToken() ? (
            <button type="button" className="ghost" onClick={() => setEditAlbum(true)}>
              Редактировать альбом
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={shuffle} disabled={!tr.length} title="Shuffle">
            Shuffle
          </button>
        </div>
      </div>
      {editAlbum && a ? (
        <AlbumMetaModal albumId={id} album={a} onClose={() => setEditAlbum(false)} onRefresh={load} />
      ) : null}
      <ul className="plain-list">
        <TrackHeader
          columns="album"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(k) => {
            if (k === "album") return;
            if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            else {
              setSortKey(k);
              setSortDir("asc");
            }
          }}
        />
        {sortedTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            index={0}
            onPlayAt={() => {
              const idx = tr.findIndex((x) => x.id === t.id);
              playAt(Math.max(0, idx));
            }}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={liked.has(t.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${t.trackNo != null ? t.trackNo + ". " : ""}${t.title || "Untitled"}`}
            isNowPlaying={p.current?.id === t.id}
            isPlaying={p.isPlaying}
            columns="album"
            onMetaSaved={load}
          />
        ))}
      </ul>
    </div>
  );
}
