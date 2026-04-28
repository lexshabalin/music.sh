import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

export function Playlist() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
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
  const playAt = (startIdx) => {
    const items = tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    }));
    player.playQueue(items, startIdx);
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
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            onPlayAt={(idx) => playAt(idx)}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={false}
            onToggleLike={null}
            label={`${t.title || "Untitled"}`}
            isNowPlaying={player.current?.id === t.id}
            isPlaying={player.isPlaying}
          />
        ))}
      </ul>
    </div>
  );
}

