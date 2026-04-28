import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";

export function Library() {
  const [q, setQ] = useState("");
  const [albums, setA] = useState([]);
  const [scanning, setScan] = useState(false);
  const [msg, setMsg] = useState("");
  const [scanState, setScanState] = useState(null);
  const player = usePlayer();
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
      <div className="search-row">
        <input
          className="search-input"
          placeholder="Search albums/artists…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          className={`rescan-icon-btn${scanning ? " rescan-icon-btn--scanning" : ""}`}
          disabled={scanning}
          title="Rescan library"
          aria-label="Rescan library"
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
          <svg className="rescan-ecg" viewBox="0 0 48 14" aria-hidden>
            <path className="rescan-ecg__base" d="M1 7 L47 7" />
            <path
              className="rescan-ecg__pulse"
              d="M1 7 L18 7 L22.2 0.9 L25.2 13.1 L28.4 4.8 L31 7 L47 7"
            />
          </svg>
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
              <div className="tile-media">
                {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
                <button
                  type="button"
                  className="tile-play-btn"
                  title="Play album"
                  aria-label="Play album"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const tr = await lib.tracks("", a.id);
                      const items = (Array.isArray(tr) ? tr : []).map((t) => ({
                        id: t.id,
                        label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
                        url: lib.streamUrl(t.id),
                        artist: t.artist?.name || "",
                        title: t.title || "Track",
                        album: t.album?.title || a.title || "",
                        coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : a.coverUrl ? lib.coverUrl(a.id) : "",
                      }));
                      if (items.length) player.playQueue(items, 0);
                    } catch (err) {
                      setMsg(err?.message || "error");
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M9 7.5v9l8-4.5-8-4.5Z" fill="currentColor" />
                  </svg>
                </button>
              </div>
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
