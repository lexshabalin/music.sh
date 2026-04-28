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

export function Songs() {
  const [tracks, setTracks] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
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

  const items = React.useMemo(() => {
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
    p.playQueue(items, startIdx);
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
        <TrackHeader columns="full" />
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            onPlayAt={(idx) => playAt(idx)}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={liked.has(t.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${t.title || "Untitled"}`}
            isNowPlaying={p.current?.id === t.id}
            isPlaying={p.isPlaying}
            columns="full"
          />
        ))}
      </ul>
    </div>
  );
}

