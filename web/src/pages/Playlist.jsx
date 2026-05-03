import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import { useI18n } from "../i18n";

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
    if (key === "album") return (t?.album?.title || "").toString();
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

export function Playlist() {
  const { t } = useI18n();
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sortKey, setSortKey] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null); // { left, top }
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const menuBtnRef = useRef(null);
  const menuRef = useRef(null);
  const player = usePlayer();

  const load = () =>
    lib
      .playlist(id)
      .then((x) => {
        setErr("");
        setData(x && typeof x === "object" ? x : { name: "", tracks: [] });
      })
      .catch((e) => setErr(e.message || "error"));

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuBtnRef.current && menuBtnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const r = menuBtnRef.current?.getBoundingClientRect?.();
    if (!r) return;
    const w = 220;
    const pad = 8;
    const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
    const top = Math.min(window.innerHeight - pad, r.bottom + 6);
    setMenuPos({ left, top, width: w });
  }, [menuOpen]);

  if (err) return <p style={{ color: "tomato" }}>{err}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;

  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const sortedTracks = sortTracks(tracks, sortKey, sortDir);
  const playAt = (startIdx) => {
    // Playback order should follow playlist position (unsorted).
    if (!tracks.length) return;
    const items = tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    }));
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    player.playQueue(items, idx);
    // iOS Safari: call play() from the click handler for guaranteed first tap.
    try {
      const el = player.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };
  const shuffle = () => {
    const items = tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    }));
    const shuffled = shuffleCopy(items);
    if (shuffled.length) player.playQueue(shuffled, 0);
  };
  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    };
    if (!player.current) player.playQueue([item], 0);
    else player.playNext(item);
  };

  return (
    <div>
      <p>
        <Link to="/playlists" className="muted">
          ← {t("playlist.playlists")}
        </Link>
      </p>
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{data.name}</h2>
          {data.description ? <p className="muted">{data.description}</p> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={shuffle}
            disabled={!tracks.length}
            title={t("tracks.shuffle")}
            aria-label={t("tracks.shuffle")}
          >
            ⇄
          </button>
          <button
            ref={menuBtnRef}
            type="button"
            className="ghost playlist-more-btn"
            title={t("playlist.more")}
            aria-label={t("playlist.more")}
            onClick={(e) => {
              try { e.preventDefault(); } catch (_) {}
              try { e.stopPropagation(); } catch (_) {}
              const r = menuBtnRef.current?.getBoundingClientRect?.();
              if (r) {
                const w = 220;
                const pad = 8;
                const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
                const top = Math.min(window.innerHeight - pad, r.bottom + 6);
                setMenuPos({ left, top, width: w });
              }
              setMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
        </div>
      </div>
      {menuOpen && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: "fixed",
                left: menuPos.left,
                top: menuPos.top,
                width: menuPos.width || 220,
                background: "#18181f",
                border: "1px solid #2a2a33",
                borderRadius: 10,
                padding: 6,
                zIndex: 5000,
                boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
              }}
              role="menu"
              aria-label={t("playlist.more")}
              onMouseDown={(e) => {
                try { e.stopPropagation(); } catch (_) {}
              }}
              onTouchStart={(e) => {
                try { e.stopPropagation(); } catch (_) {}
              }}
              onClick={(e) => {
                try { e.stopPropagation(); } catch (_) {}
              }}
            >
              <button
                type="button"
                className="ghost"
                style={{ width: "100%", justifyContent: "flex-start", display: "flex", padding: "8px 10px", color: "tomato" }}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDeleteOpen(true);
                }}
              >
                {t("playlist.delete")}
              </button>
            </div>,
            document.body
          )
        : null}
      {confirmDeleteOpen ? (
        <ConfirmModal
          title={t("playlist.delete")}
          text={t("playlist.deleteConfirm")}
          dangerText={t("playlist.delete")}
          busy={busyDelete}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={async () => {
            setBusyDelete(true);
            setErr("");
            try {
              await lib.deletePl(id);
              nav("/playlists", { replace: true });
            } catch (e) {
              setErr(e?.message || "error");
            }
            setBusyDelete(false);
            setConfirmDeleteOpen(false);
          }}
        />
      ) : null}
      <ul className="plain-list">
        <TrackHeader
          columns="full"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(k) => {
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
              const idx = tracks.findIndex((x) => x.id === t.id);
              playAt(Math.max(0, idx));
            }}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={false}
            onToggleLike={null}
            label={`${t.title || t("common.untitled")}`}
            isNowPlaying={player.current?.id === t.id}
            isPlaying={player.isPlaying}
            columns="full"
            onMetaSaved={load}
          />
        ))}
      </ul>
    </div>
  );
}

function ConfirmModal({ title, text, dangerText, busy, onClose, onConfirm }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted">{text}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} style={{ borderColor: "tomato", color: "tomato" }}>
            {dangerText}
          </button>
        </div>
      </div>
    </div>
  );
}

