import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackRow } from "../components/TrackMenu";

function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function Album() {
  const { id } = useParams();
  const [tr, setTr] = useState([]);
  const [a, setA] = useState(null);
  const [liked, setLiked] = useState(new Set());
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
  const playAt = (startIdx) => {
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    }));
    p.playQueue(items, startIdx);
  };

  const shuffle = () => {
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
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
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
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
          <h2 style={{ margin: 0 }}>{a?.title || "Album"}</h2>
          <div className="muted">{a?.artistName}</div>
        </div>
        </div>
        <button type="button" className="ghost" onClick={shuffle} disabled={!tr.length} title="Shuffle">
          Shuffle
        </button>
      </div>
      <ul className="plain-list">
        {tr.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            onPlayAt={(idx) => playAt(idx)}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={liked.has(t.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${t.trackNo != null ? t.trackNo + ". " : ""}${t.title || "Untitled"}`}
            isNowPlaying={p.current?.id === t.id}
            isPlaying={p.isPlaying}
          />
        ))}
      </ul>
    </div>
  );
}
