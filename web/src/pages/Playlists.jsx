import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";

export function Playlists() {
  const [list, setList] = useState([]);
  const [name, setN] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
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
        <input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            if (!name.trim()) return;
            try {
              await lib.createPl(name.trim(), desc.trim());
              setN("");
              setDesc("");
              load();
            } catch (e) {
              setErr(e.message || "error");
            }
          }}
        >
          Create
        </button>
      </div>
      <div className="grid">
        {list.map((p) => (
          <Link key={p.id} to={"/playlist/" + p.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card album-tile">
              <div className="album-meta" style={{ minHeight: 80 }}>
                <div className="album-title">{p.name}</div>
                <div className="album-sub" style={{ justifyContent: "flex-start" }}>
                  <span>{p.description || ""}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
