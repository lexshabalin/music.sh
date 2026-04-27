import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";

export function Library() {
  const [q, setQ] = useState("");
  const [albums, setA] = useState([]);
  const [scanning, setScan] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => {
    lib.albums(q).then(setA).catch((e) => setMsg(e.message));
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <div className="search">
        <input placeholder="Search albums/artists…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          type="button"
          className="ghost"
          style={{ marginLeft: 8 }}
          disabled={scanning}
          onClick={async () => {
            setScan(true);
            try {
              await lib.scan();
              setMsg("Library scan queued");
              load();
            } catch (e) {
              setMsg(e.message);
            }
            setScan(false);
          }}
        >
          Scan library
        </button>
      </div>
      {msg ? <p className="muted">{msg}</p> : null}
      <div className="grid">
        {albums.map((a) => (
          <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card">
              {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
              <div style={{ marginTop: 6, fontSize: "0.9rem" }}>{a.title}</div>
              <div className="muted" style={{ fontSize: "0.8rem" }}>
                {a.artistName || "—"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
