import React from "react";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";

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

export function Songs() {
  const [tracks, setTracks] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
  const [sortKey, setSortKey] = React.useState("title");
  const [sortDir, setSortDir] = React.useState("asc");
  const p = usePlayer();

  const load = React.useCallback(() => {
    lib
      .tracks("")
      .then((x) => {
        setErr("");
        setTracks(Array.isArray(x) ? x : []);
      })
      .catch((e) => setErr(e?.message || "error"));

    lib
      .likeIds()
      .then((r) => setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : [])))
      .catch(() => setLiked(new Set()));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const sortedTracks = React.useMemo(() => sortTracks(tracks, sortKey, sortDir), [tracks, sortKey, sortDir]);

  const items = React.useMemo(() => {
    // Playback order should follow the original (unsorted) library order.
    return tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    }));
  }, [tracks]);

  const playAt = (startIdx) => {
    if (!items.length) return;
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    p.playQueue(items, idx);
    // iOS Safari sometimes ignores audio.play() when called after render.
    // Trigger it right from the click handler to guarantee the first tap.
    try {
      const el = p.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };

  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
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

  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Songs</h2>
        <button type="button" className="ghost" onClick={shuffle} disabled={!items.length} title="Shuffle">
          Shuffle
        </button>
      </div>

      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

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
            isLiked={liked.has(t.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${t.title || "Untitled"}`}
            isNowPlaying={p.current?.id === t.id}
            isPlaying={p.isPlaying}
            columns="full"
            onMetaSaved={load}
          />
        ))}
      </ul>
    </div>
  );
}

