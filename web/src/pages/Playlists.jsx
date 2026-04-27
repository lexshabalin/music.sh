import { useEffect, useState } from "react";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackRow } from "../components/TrackMenu";

export function Playlists() {
  const [list, setList] = useState([]);
  const [name, setN] = useState("");
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState("");
  const p = usePlayer();
  const load = () =>
    lib
      .playlists()
      .then((x) => {
        setErr("");
        setList(Array.isArray(x) ? x : []);
      })
      .catch((e) => setErr(e.message || "error"));
  useEffect(() => {
    load();
  }, []);
  return (
    <div>
      <h2>Playlists</h2>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input placeholder="New playlist" value={name} onChange={(e) => setN(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            if (!name.trim()) return;
            try {
              await lib.createPl(name.trim(), "");
              setN("");
              load();
            } catch (e) {
              setErr(e.message || "error");
            }
          }}
        >
          Create
        </button>
      </div>
      <ul className="plain-list">
        {list.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <button className="ghost" type="button" onClick={() => setSel(p.id === sel ? null : p.id)}>
              {p.id === sel ? "hide" : "view"}
            </button>
          </li>
        ))}
      </ul>
      {sel ? <PlaylistView id={sel} player={p} /> : null}
    </div>
  );
}

function PlaylistView({ id, player }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
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
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{data.name}</h3>
      <ul className="plain-list">
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            onPlayAt={(idx) => playAt(idx)}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={false}
            onToggleLike={() => {}}
            label={`${t.artist ? t.artist.name + " — " : ""}${t.title || "Untitled"}`}
          />
        ))}
      </ul>
    </div>
  );
}
