import React from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import { useI18n } from "../i18n";

/** Loose UUID acceptance for route param (PostgreSQL IDs are lowercase v4 hex). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortTracks(list, key, dir) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const mult = dir === "desc" ? -1 : 1;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const get = (tr) => {
    if (key === "title") return (tr?.title || "").toString();
    if (key === "artist") return (tr?.artist?.name || "").toString();
    if (key === "album") return (tr?.album?.title || "").toString();
    return "";
  };
  return arr
    .map((t, i) => ({ t, i }))
    .sort((x, y) => {
      const ax = get(x.t);
      const ay = get(y.t);
      const r = coll.compare(ax, ay);
      return r !== 0 ? r * mult : x.i - y.i;
    })
    .map((x) => x.t);
}

export function Genre() {
  const { id } = useParams();
  const { t } = useI18n();
  const genreId = (id || "").trim();
  const validId = UUID_RE.test(genreId);
  const [label, setLabel] = React.useState("");
  const [tracks, setTracks] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
  const [sortKey, setSortKey] = React.useState("title");
  const [sortDir, setSortDir] = React.useState("asc");
  const p = usePlayer();

  const load = React.useCallback(async () => {
    if (!validId) return;
    setErr("");
    try {
      const [meta, tl] = await Promise.all([
        lib.libraryGenre(genreId).catch(() => null),
        lib.tracks("", { genreId }).catch(() => []),
      ]);
      const title = typeof meta?.label === "string" ? meta.label : "";
      setLabel(title.trim() || genreId);
      setTracks(Array.isArray(tl) ? tl : []);
    } catch (e) {
      setErr(e?.message || "error");
      setTracks([]);
    }
    try {
      const r = await lib.likeIds();
      setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : []));
    } catch (_) {
      setLiked(new Set());
    }
  }, [genreId, validId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const sortedTracks = React.useMemo(() => sortTracks(tracks, sortKey, sortDir), [tracks, sortKey, sortDir]);

  const items = React.useMemo(() => {
    return tracks.map((tr) => ({
      id: tr.id,
      label: (tr.artist ? tr.artist.name + " — " : "") + (tr.title || t("common.track")),
      url: lib.streamUrl(tr.id),
      artist: tr.artist?.name || "",
      artistId: tr.artist?.id || "",
      title: tr.title || t("common.track"),
      album: tr.album?.title || "",
      albumId: tr.album?.id || "",
      coverUrl: effectiveTrackCoverUrl(tr),
      format: trackFormatForPlayback(tr),
    }));
  }, [tracks, t]);

  const playAt = (startIdx) => {
    if (!items.length) return;
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    p.playQueue(items, idx);
    try {
      const el = p.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };

  const playNext = (tr) => {
    const item = {
      id: tr.id,
      label: (tr.artist ? tr.artist.name + " — " : "") + (tr.title || t("common.track")),
      url: lib.streamUrl(tr.id),
      artist: tr.artist?.name || "",
      artistId: tr.artist?.id || "",
      title: tr.title || t("common.track"),
      album: tr.album?.title || "",
      albumId: tr.album?.id || "",
      coverUrl: effectiveTrackCoverUrl(tr),
      format: trackFormatForPlayback(tr),
    };
    if (!p.current) p.playQueue([item], 0);
    else p.playNext(item);
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

  const shuffle = () => {
    const shuffled = shuffleCopy(items);
    if (shuffled.length) p.playQueue(shuffled, 0);
  };

  if (!validId) {
    return <Navigate to="/genres" replace />;
  }

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link to="/genres" className="muted">
          ← {t("nav.genres")}
        </Link>
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button type="button" className="ghost icon-btn" onClick={shuffle} disabled={!items.length} title={t("tracks.shuffle")} aria-label={t("tracks.shuffle")}>
          ⇄
        </button>
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {!tracks.length && !err ? <p className="muted">{t("genres.noTracks")}</p> : null}
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
        {sortedTracks.map((tr) => (
          <TrackRow
            key={tr.id}
            track={tr}
            index={0}
            onPlayAt={() => {
              const idx = tracks.findIndex((x) => x.id === tr.id);
              playAt(Math.max(0, idx));
            }}
            onPlayNext={(tk) => playNext(tk)}
            isLiked={liked.has(tr.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${tr.title || t("common.untitled")}`}
            isNowPlaying={p.current?.id === tr.id}
            isPlaying={p.isPlaying}
            columns="full"
            onMetaSaved={load}
          />
        ))}
      </ul>
    </div>
  );
}
