import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

export function Playlist() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [sortKey, setSortKey] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
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

  if (err) return <p style={{ color: "tomato" }}>{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const sortedTracks = sortTracks(tracks, sortKey, sortDir);
  const playAt = (startIdx) => {
    // Playback order should follow playlist position (unsorted).
    if (!tracks.length) return;
    const items = tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
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
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    }));
    const shuffled = shuffleCopy(items);
    if (shuffled.length) player.playQueue(shuffled, 0);
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
    if (!player.current) player.playQueue([item], 0);
    else player.playNext(item);
  };

  return (
    <div>
      <p>
        <Link to="/playlists" className="muted">
          ← Playlists
        </Link>
      </p>
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{data.name}</h2>
          {data.description ? <p className="muted">{data.description}</p> : null}
        </div>
        <button type="button" className="ghost" onClick={shuffle} disabled={!tracks.length} title="Shuffle">
          Shuffle
        </button>
      </div>
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
            label={`${t.title || "Untitled"}`}
            isNowPlaying={player.current?.id === t.id}
            isPlaying={player.isPlaying}
            columns="full"
          />
        ))}
      </ul>
    </div>
  );
}

