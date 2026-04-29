import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
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
}) {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
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
        />
      ) : null}
      {showAdd ? (
        <AddToPlaylistModal
          trackId={track.id}
          onClose={() => setShowAdd(false)}
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

function Menu({ anchorRef, onClose, suppressClose, onPlayNow, onPlayNext, onAddToPlaylist }) {
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

