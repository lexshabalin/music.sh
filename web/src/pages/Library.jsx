import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";

export function Library() {
  const [q, setQ] = useState("");
  const [albums, setA] = useState([]);
  const [scanning, setScan] = useState(false);
  const [msg, setMsg] = useState("");
  const [scanState, setScanState] = useState(null);
  const load = () => {
    lib
      .albums(q)
      .then((x) => setA(Array.isArray(x) ? x : []))
      .catch((e) => setMsg(e.message));
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!scanning) return;
    let stop = false;
    const tick = async () => {
      try {
        const st = await lib.scanStatus();
        if (stop) return;
        setScanState(st);
        if (!st.running) {
          setScan(false);
          load();
        }
      } catch (_) {}
      if (!stop) setTimeout(tick, 500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [scanning]);
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
              setMsg("Rescan started");
            } catch (e) {
              setMsg(e.message);
              setScan(false);
            }
          }}
        >
          Rescan
        </button>
      </div>
      {scanning && scanState ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            Scanned files: <b>{scanState.scannedFiles}</b> • Found tracks: <b>{scanState.foundTracks}</b>
          </div>
          <div style={{ height: 6, background: "#2a2a33", borderRadius: 999 }}>
            <div
              style={{
                height: 6,
                width: `${Math.min(100, (scanState.scannedFiles / Math.max(1, scanState.foundTracks || 1)) * 100)}%`,
                background: "#cfcfd6",
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      ) : null}
      {msg ? <p className="muted">{msg}</p> : null}
      <div className="grid">
        {albums.map((a) => (
          <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card album-tile">
              {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
              <div className="album-meta">
                <div className="album-title">{a.title}</div>
                <div className="album-sub">
                  <span>{a.artistName || "—"}</span>
                  {a.year ? <span className="album-year">{a.year}</span> : null}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
