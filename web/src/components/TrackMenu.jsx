import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { getToken, lib } from "../api";
import { IClock, IHeart } from "./icons";

function fmtDur(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const durationCache = new Map();

function useLazyDurationMs(trackId, knownDurationMs) {
  const rowRef = useRef(null);
  const [durMs, setDurMs] = useState(() => {
    if (typeof knownDurationMs === "number" && Number.isFinite(knownDurationMs) && knownDurationMs > 0) return knownDurationMs;
    const cached = trackId ? durationCache.get(trackId) : undefined;
    return typeof cached === "number" ? cached : null;
  });

  useEffect(() => {
    if (!trackId) return;
    if (typeof knownDurationMs === "number" && Number.isFinite(knownDurationMs) && knownDurationMs > 0) {
      durationCache.set(trackId, knownDurationMs);
      setDurMs(knownDurationMs);
      return;
    }
    const cached = durationCache.get(trackId);
    if (typeof cached === "number" && cached > 0) {
      setDurMs(cached);
      return;
    }
  }, [trackId, knownDurationMs]);

  useEffect(() => {
    if (!trackId) return;
    if (durMs) return;
    if (!rowRef.current) return;
    if (durationCache.has(trackId)) return;

    let cancelled = false;
    let obs = null;
    const el = rowRef.current;

    const load = () => {
      if (cancelled) return;
      // Avoid firing multiple times per track.
      if (durationCache.has(trackId)) return;
      durationCache.set(trackId, 0);

      const a = document.createElement("audio");
      a.preload = "metadata";
      a.src = lib.streamUrl(trackId);
      const cleanup = () => {
        try {
          a.removeAttribute("src");
          a.load();
        } catch (_) {}
      };
      const onMeta = () => {
        if (cancelled) return cleanup();
        const sec = Number(a.duration);
        if (Number.isFinite(sec) && sec > 0) {
          const ms = Math.round(sec * 1000);
          durationCache.set(trackId, ms);
          setDurMs(ms);
        } else {
          durationCache.delete(trackId);
        }
        cleanup();
      };
      const onErr = () => {
        durationCache.delete(trackId);
        cleanup();
      };
      a.addEventListener("loadedmetadata", onMeta, { once: true });
      a.addEventListener("error", onErr, { once: true });
    };

    if ("IntersectionObserver" in window) {
      obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            if (obs) obs.disconnect();
            load();
            break;
          }
        }
      }, { rootMargin: "250px 0px" });
      obs.observe(el);
    } else {
      load();
    }

    return () => {
      cancelled = true;
      if (obs) obs.disconnect();
    };
  }, [trackId, durMs, knownDurationMs]);

  return { rowRef, durationMs: durMs };
}

export function TrackRow({
  track,
  index,
  onPlayAt,
  onPlayNext,
  isLiked,
  onToggleLike,
  label,
  isNowPlaying,
  isPlaying,
  columns = "full",
  allowMetaEdit = true,
  onMetaSaved,
}) {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const btnRef = useRef(null);
  const suppressClickRef = useRef(false);
  const didScrollRef = useRef(false);
  const [suppressMenuClose, setSuppressMenuClose] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const onLiTouchStart = (e) => {
    // Only handle single-finger long press.
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    longPressFiredRef.current = false;
    didScrollRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      suppressClickRef.current = true; // prevent subsequent click from playing
      setSuppressMenuClose(true);
      setOpen(true);
    }, 650);
  };

  const onLiTouchMove = (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = Math.abs(t.clientX - touchStartRef.current.x);
    const dy = Math.abs(t.clientY - touchStartRef.current.y);
    if (dx > 12 || dy > 12) {
      // If user is scrolling, cancel long-press.
      clearLongPress();
      didScrollRef.current = true;
      suppressClickRef.current = true; // block synthetic click -> playback
    }
  };

  const onLiTouchEnd = (e) => {
    clearLongPress();
    if (longPressFiredRef.current) {
      // Long-press opened the context menu; don't start playback.
      suppressClickRef.current = true;
      try { e.preventDefault(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}
      return;
    }

    if (didScrollRef.current) {
      // This was a scroll gesture; don't treat as a tap.
      suppressClickRef.current = true;
      return;
    }

    const target = e.target;
    const moreBtn = target?.closest?.('button[title="More"]');
    const likeBtn = target?.closest?.('button[title="Like"]');
    if (moreBtn || likeBtn) return;

    suppressClickRef.current = true;
    onPlayAt(index);
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}
    setOpen(false);
  };

  const onLiTouchCancel = () => {
    clearLongPress();
  };

  useEffect(() => {
    if (!suppressMenuClose) return;
    // Keep menu visible for the next click that may be generated by touchend.
    const t = window.setTimeout(() => setSuppressMenuClose(false), 450);
    return () => window.clearTimeout(t);
  }, [suppressMenuClose]);

  const metaParts = [];
  if (track?.format) metaParts.push(String(track.format).toUpperCase());
  if (typeof track?.bitrateKbps === "number") metaParts.push(`${track.bitrateKbps} kbps`);
  const d = fmtDur(track?.durationMs);
  if (d) metaParts.push(d);

  const artistName = track?.artist?.name || "";
  const albumTitle = track?.album?.title || "";
  const { rowRef, durationMs } = useLazyDurationMs(track?.id, track?.durationMs);

  return (
    <>
      <li
        ref={rowRef}
        className={`track-row${isNowPlaying ? " track-row--now" : ""}${isNowPlaying && isPlaying ? " track-row--playing" : ""}`}
        onTouchStart={onLiTouchStart}
        onTouchMove={onLiTouchMove}
        onTouchEnd={onLiTouchEnd}
        onTouchCancel={onLiTouchCancel}
      >
        <div className={`track-grid${columns === "album" ? " track-grid--album" : ""}`}>
          <button
            type="button"
            className="track-title track-title-btn"
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onPlayAt(index);
            }}
            aria-label={`Play ${label}`}
          >
            <span className="track-title-text">{label}</span>
            <span className="track-mobile-sub muted">
              {artistName || "Unknown Artist"}
              {albumTitle ? ` • ${albumTitle}` : ""}
            </span>
          </button>

          <div className="track-col track-artist">
            {track?.artist?.id ? (
              <Link to={"/artist/" + track.artist.id} className="muted" style={{ textDecoration: "none" }}>
                {artistName || "Unknown Artist"}
              </Link>
            ) : (
              <span className="muted">{artistName || "—"}</span>
            )}
          </div>

          {columns === "full" ? (
            <div className="track-col track-album">
              <span className="muted">{albumTitle || "—"}</span>
            </div>
          ) : (
            <div className="track-col track-album track-album--hidden" aria-hidden="true" />
          )}

          <div className="track-col track-dur">
            <span className="muted">{fmtDur(durationMs) || ""}</span>
          </div>
        </div>
        <div className="track-actions">
          {isNowPlaying ? (
            <span className="np-eq" aria-hidden="true" title={isPlaying ? "Now playing" : "Paused"}>
              <span className="np-eq__bar" />
              <span className="np-eq__bar" />
              <span className="np-eq__bar" />
            </span>
          ) : (
            <span className="np-eq np-eq--off" aria-hidden="true" />
          )}
          {typeof onToggleLike === "function" ? (
            <button
              className="ghost"
              type="button"
              onClick={() => onToggleLike(track.id)}
              title="Like"
              style={{
                color: isLiked ? "tomato" : undefined,
                borderColor: isLiked ? "tomato" : undefined,
              }}
            >
              <IHeart />
            </button>
          ) : null}
          <button
            className="ghost"
            type="button"
            ref={btnRef}
            onClick={() => setOpen((v) => !v)}
            title="More"
          >
            ⋯
          </button>
        </div>
      </li>
      {open ? (
        <Menu
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
          suppressClose={suppressMenuClose}
          onPlayNow={() => {
            onPlayAt(index);
            setOpen(false);
          }}
          onPlayNext={() => {
            setShowAdd(false);
            setOpen(false);
            onPlayNext(track, index);
          }}
          onAddToPlaylist={() => {
            setShowAdd(true);
            setOpen(false);
          }}
          onEditMeta={
            allowMetaEdit && getToken()
              ? () => {
                  setShowMeta(true);
                  setOpen(false);
                }
              : undefined
          }
        />
      ) : null}
      {showAdd ? (
        <AddToPlaylistModal
          trackId={track.id}
          onClose={() => setShowAdd(false)}
        />
      ) : null}
      {showMeta ? (
        <TrackMetaEditModal
          trackId={track.id}
          onClose={() => setShowMeta(false)}
          onSaved={() => {
            if (typeof onMetaSaved === "function") onMetaSaved();
          }}
        />
      ) : null}
    </>
  );
}

export function TrackHeader({
  columns = "full",
  sortKey = "",
  sortDir = "asc",
  onSort,
}) {
  const canSort = typeof onSort === "function";
  const arrow = sortDir === "desc" ? "▼" : "▲";
  const head = (k, label, cls) => {
    const active = sortKey === k;
    return (
      <button
        type="button"
        className={`track-head-btn ${cls || ""} ${active ? "is-active" : ""}`}
        onClick={canSort ? () => onSort(k) : undefined}
        disabled={!canSort}
        title={label}
      >
        <span>{label}</span>
        {active ? <span className="track-sort-arrow" aria-hidden="true">{arrow}</span> : <span className="track-sort-arrow track-sort-arrow--off" aria-hidden="true">{arrow}</span>}
      </button>
    );
  };
  return (
    <li className="track-header" aria-hidden="true">
      <div className={`track-grid track-grid--header${columns === "album" ? " track-grid--album" : ""}`}>
        <div className="track-col track-title-h">{head("title", "Title", "track-title-h")}</div>
        <div className="track-col track-artist-h">{head("artist", "Artist", "track-artist-h")}</div>
        {columns === "full" ? (
          <div className="track-col track-album-h">{head("album", "Album", "track-album-h")}</div>
        ) : (
          <div className="track-col track-album-h track-album--hidden" />
        )}
        <div className="track-col track-dur track-dur-h">
          <span className="track-time-icon" title="Time" aria-label="Time">
            <IClock size={16} />
          </span>
        </div>
      </div>
      <div className="track-actions track-actions--header" />
    </li>
  );
}

function Menu({ anchorRef, onClose, suppressClose, onPlayNow, onPlayNext, onAddToPlaylist, onEditMeta }) {
  useEffect(() => {
    const onDoc = (e) => {
      if (suppressClose) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [onClose, anchorRef, suppressClose]);

  const r = anchorRef.current?.getBoundingClientRect?.();
  const style = r
    ? {
        position: "fixed",
        top: r.bottom + 6,
        left: Math.min(window.innerWidth - 240, r.left - 160),
        width: 220,
        background: "#18181f",
        border: "1px solid #2a2a33",
        borderRadius: 10,
        padding: 6,
        zIndex: 999,
      }
    : {};

  return (
    <div style={style} role="menu" aria-label="Track actions">
      <MenuItem onClick={onPlayNow}>Play now</MenuItem>
      <MenuItem onClick={onPlayNext}>Play next</MenuItem>
      <MenuItem onClick={onAddToPlaylist}>Add to playlist</MenuItem>
      {typeof onEditMeta === "function" ? <MenuItem onClick={onEditMeta}>Править метаданные</MenuItem> : null}
    </div>
  );
}

function MenuItem({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      className="ghost"
      onClick={disabled ? undefined : onClick}
      style={{
        width: "100%",
        justifyContent: "flex-start",
        display: "flex",
        padding: "8px 10px",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function ResetLink({ onClick, busy }) {
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

function TrackMetaEditModal({ trackId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [albumArtist, setAlbumArtist] = useState("");
  const [year, setYear] = useState("");
  const [yearTouched, setYearTouched] = useState(false);
  const [trackNo, setTrackNo] = useState("");
  const [discNo, setDiscNo] = useState("");
  const [albumList, setAlbumList] = useState([]);
  /** "library" = привязка к строке альбома в БД; "custom" = название вручную */
  const [albumSource, setAlbumSource] = useState("custom");
  const [libraryAlbumId, setLibraryAlbumId] = useState("");

  const applyAlbumStateFromTrack = (t, albs) => {
    const list = Array.isArray(albs) ? albs : [];
    const curAid = t.album?.id;
    if (curAid && list.some((a) => a.id === curAid)) {
      setAlbumSource("library");
      setLibraryAlbumId(curAid);
      const al = list.find((a) => a.id === curAid);
      setYear(al?.year != null ? String(al.year) : t.year != null ? String(t.year) : "");
      setYearTouched(false);
    } else {
      setAlbumSource("custom");
      setLibraryAlbumId("");
      setAlbum(t.album?.title || "");
      setYear(t.year != null ? String(t.year) : "");
      setYearTouched(false);
    }
  };

  const loadAlbumsForArtistName = useCallback(async (artistName, fallbackArtistId) => {
    let aid = fallbackArtistId;
    const name = (artistName || "").trim();
    if (name) {
      try {
        const artists = await lib.artists(name);
        const ex = artists.find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
        if (ex?.id) aid = ex.id;
      } catch (_) {}
    }
    if (!aid) {
      setAlbumList([]);
      return [];
    }
    try {
      const albs = await lib.albums("", aid);
      const list = Array.isArray(albs) ? albs : [];
      setAlbumList(list);
      return list;
    } catch (_) {
      setAlbumList([]);
      return [];
    }
  }, []);

  const skipArtistDebounceRef = useRef(true);
  const libraryAlbumIdRef = useRef("");
  const fullRef = useRef(null);
  useEffect(() => {
    libraryAlbumIdRef.current = libraryAlbumId;
  }, [libraryAlbumId]);
  useEffect(() => {
    fullRef.current = full;
  }, [full]);

  useEffect(() => {
    skipArtistDebounceRef.current = true;
  }, [trackId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const t = await lib.track(trackId);
        if (cancelled || !t) return;
        setFull(t);
        setTitle(t.title || "");
        setArtist(t.artist?.name || "");
        setAlbumArtist("");
        setTrackNo(t.trackNo != null ? String(t.trackNo) : "");
        setDiscNo(t.discNo != null ? String(t.discNo) : "");
        const albs = await loadAlbumsForArtistName(t.artist?.name, t.artist?.id);
        if (cancelled) return;
        applyAlbumStateFromTrack(t, albs);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackId, loadAlbumsForArtistName]);

  useEffect(() => {
    if (loading) return;
    if (skipArtistDebounceRef.current) {
      skipArtistDebounceRef.current = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const fr = fullRef.current;
      const albs = await loadAlbumsForArtistName(artist, fr?.artist?.id);
      if (cancelled) return;
      const picked = libraryAlbumIdRef.current;
      if (picked && !albs.some((a) => a.id === picked)) {
        setLibraryAlbumId("");
        setAlbumSource("custom");
        setAlbum(fr?.album?.title || "");
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [artist, loading, loadAlbumsForArtistName]);

  const resetField = async (field) => {
    setBusy(true);
    setErr("");
    try {
      await lib.patchTrackMeta(trackId, { clear: [field] });
      const t = await lib.track(trackId);
      setFull(t);
      setTitle(t.title || "");
      setArtist(t.artist?.name || "");
      setAlbumArtist("");
      setTrackNo(t.trackNo != null ? String(t.trackNo) : "");
      setDiscNo(t.discNo != null ? String(t.discNo) : "");
      const albs = await loadAlbumsForArtistName(t.artist?.name, t.artist?.id);
      applyAlbumStateFromTrack(t, albs);
      onSaved();
    } catch (e) {
      setErr(e.message || "Ошибка");
    }
    setBusy(false);
  };

  const save = async () => {
    if (!title.trim()) {
      setErr("Укажите название трека");
      return;
    }
    if (albumSource === "library" && !libraryAlbumId) {
      setErr("Выберите альбом из списка или переключитесь на ввод вручную");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const clear = [];
      if (!trackNo.trim() && full?.meta?.trackNo) clear.push("trackNo");
      if (!discNo.trim() && full?.meta?.discNo) clear.push("discNo");

      const body = {
        title: title.trim(),
        artistName: artist.trim(),
        clear,
      };

      if (albumSource === "library" && libraryAlbumId) {
        body.albumId = libraryAlbumId;
        if (yearTouched) {
          if (!year.trim()) {
            clear.push("year");
          } else {
            const y = parseInt(year, 10);
            if (!Number.isFinite(y)) throw new Error("Некорректный год");
            body.year = y;
          }
        }
      } else {
        if (!year.trim() && full?.meta?.year) clear.push("year");
        body.albumTitle = album.trim();
        if (albumArtist.trim()) body.albumArtistName = albumArtist.trim();
        if (year.trim()) {
          const y = parseInt(year, 10);
          if (!Number.isFinite(y)) throw new Error("Некорректный год");
          body.year = y;
        }
      }

      if (trackNo.trim()) {
        const n = parseInt(trackNo, 10);
        if (!Number.isFinite(n)) throw new Error("Некорректный номер трека");
        body.trackNo = n;
      }
      if (discNo.trim()) {
        const n = parseInt(discNo, 10);
        if (!Number.isFinite(n)) throw new Error("Некорректный номер диска");
        body.discNo = n;
      }
      await lib.patchTrackMeta(trackId, body);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message || "Ошибка сохранения");
    }
    setBusy(false);
  };

  const m = full?.meta;
  const albumSelectValue = albumSource === "custom" ? "__custom__" : libraryAlbumId || "";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Метаданные трека</h3>
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: "-0.5rem" }}>
          Сначала укажите исполнителя — подгрузятся альбомы из библиотеки для этого исполнителя. Можно выбрать готовый
          альбом (трек унаследует его название, год и обложку) или ввести альбом вручную. Текстовые поля и своя обложка
          не перезаписываются при повторном сканировании.
        </p>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            <p>
              <label>
                Название {m?.title ? <ResetLink onClick={() => resetField("title")} busy={busy} /> : null}
              </label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </p>
            <p>
              <label>
                Исполнитель {m?.artist ? <ResetLink onClick={() => resetField("artist")} busy={busy} /> : null}
              </label>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </p>
            <p>
              <label>
                Альбом {m?.album ? <ResetLink onClick={() => resetField("album")} busy={busy} /> : null}
              </label>
              <select
                value={albumSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__custom__") {
                    setAlbumSource("custom");
                    setLibraryAlbumId("");
                    setAlbum(full?.album?.title || "");
                    setYear(full?.year != null ? String(full.year) : "");
                    setYearTouched(false);
                  } else {
                    setAlbumSource("library");
                    setLibraryAlbumId(v);
                    const al = albumList.find((x) => x.id === v);
                    setYear(al?.year != null ? String(al.year) : "");
                    setYearTouched(false);
                  }
                }}
              >
                <option value="">— выберите альбом из библиотеки —</option>
                {albumList.map((al) => (
                  <option key={al.id} value={al.id}>
                    {al.title}
                    {al.year != null ? ` (${al.year})` : ""}
                  </option>
                ))}
                <option value="__custom__">Другой альбом (ввести вручную)…</option>
              </select>
            </p>
            {albumSource === "custom" ? (
              <>
                <p>
                  <label>Название альбома</label>
                  <input value={album} onChange={(e) => setAlbum(e.target.value)} />
                </p>
                <p>
                  <label>Исполнитель альбома (если отличается)</label>
                  <input value={albumArtist} onChange={(e) => setAlbumArtist(e.target.value)} placeholder="Необязательно" />
                </p>
              </>
            ) : null}
            <p>
              <label>
                Год {m?.year ? <ResetLink onClick={() => resetField("year")} busy={busy} /> : null}
              </label>
              <input
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  setYearTouched(true);
                }}
                placeholder={albumSource === "library" && libraryAlbumId ? "Как у альбома, если не менять" : "Напр. 2020"}
              />
              {albumSource === "library" && libraryAlbumId && !yearTouched ? (
                <span className="muted" style={{ fontSize: "0.85rem", display: "block", marginTop: 4 }}>
                  Берётся из альбома. Измените поле, чтобы зафиксировать свой год для трека.
                </span>
              ) : null}
            </p>
            <p style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <span>
                <label>
                  № трека {m?.trackNo ? <ResetLink onClick={() => resetField("trackNo")} busy={busy} /> : null}
                </label>
                <input value={trackNo} onChange={(e) => setTrackNo(e.target.value)} />
              </span>
              <span>
                <label>
                  № диска {m?.discNo ? <ResetLink onClick={() => resetField("discNo")} busy={busy} /> : null}
                </label>
                <input value={discNo} onChange={(e) => setDiscNo(e.target.value)} />
              </span>
            </p>
            <p>
              <label>
                Обложка {m?.art ? <ResetLink onClick={() => resetField("art")} busy={busy} /> : null}
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                {full?.coverUrl || m?.art ? (
                  <img
                    src={lib.trackCoverUrl(trackId)}
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
                      await lib.uploadTrackCover(trackId, file);
                      const t = await lib.track(trackId);
                      setFull(t);
                      onSaved();
                    } catch (err2) {
                      setErr(err2.message || "Ошибка загрузки");
                    }
                    setBusy(false);
                  }}
                />
              </div>
              <span className="muted" style={{ fontSize: "0.85rem", display: "block", marginTop: 6 }}>
                JPEG, PNG или WebP. Не заменяет обложку альбома для других треков. Сканирование библиотеки не удаляет свою
                обложку.
              </span>
            </p>
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="button" disabled={busy || loading} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function AddToPlaylistModal({ trackId, onClose }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Add to playlist</h3>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        <p className="muted">Create a new playlist and add this track.</p>
        <p>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My playlist" />
        </p>
        <p>
          <label>Description</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const pl = await lib.createPl(name.trim(), desc.trim());
                await lib.addToPl(pl.id, trackId);
                onClose();
              } catch (e) {
                setErr(e.message || "error");
              }
              setBusy(false);
            }}
          >
            Create & add
          </button>
        </div>
      </div>
    </div>
  );
}

