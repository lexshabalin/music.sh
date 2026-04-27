import { useEffect, useState } from "react";
import { lib } from "../api";

export function Playlists() {
  const [list, setList] = useState([]);
  const [name, setN] = useState("");
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState("");
  const load = () =>
    lib
      .playlists()
      .then((x) => {
        setErr("");
        setList(x);
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
              await lib.createPl(name.trim());
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
      {sel ? <PlaylistView id={sel} /> : null}
    </div>
  );
}

function PlaylistView({ id }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = () =>
    lib
      .playlist(id)
      .then((x) => {
        setErr("");
        setData(x);
      })
      .catch((e) => setErr(e.message || "error"));
  useEffect(() => {
    load();
  }, [id]);
  if (err) return <p style={{ color: "tomato" }}>{err}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{data.name}</h3>
      <ul className="plain-list">
        {(data.tracks || []).map((t) => (
          <li key={t.id}>
            {t.artist ? t.artist.name + " — " : ""}
            {t.title || "Untitled"}
          </li>
        ))}
      </ul>
    </div>
  );
}
