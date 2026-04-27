import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackRow } from "../components/TrackMenu";

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
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{data.name}</h2>
        {data.description ? <p className="muted">{data.description}</p> : null}
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
            label={`${t.artist ? t.artist.name + " — " : ""}${t.title || "Untitled"}`}
          />
        ))}
      </ul>
    </div>
  );
}

