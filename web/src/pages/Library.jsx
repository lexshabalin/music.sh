import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";

export function Library() {
  const [q, setQ] = useState("");
  const [albums, setA] = useState([]);
  const [res, setRes] = useState({ songs: [], albums: [], artists: [], playlists: [] });
  const [searching, setSearching] = useState(false);
  const [scanning, setScan] = useState(false);
  const [msg, setMsg] = useState("");
  const [scanState, setScanState] = useState(null);
  const player = usePlayer();
  useEffect(() => {
    const qq = (q || "").trim();
    const t = setTimeout(() => {
      setMsg("");
      if (!qq) {
        setSearching(false);
        lib
          .albums("")
          .then((x) => setA(Array.isArray(x) ? x : []))
          .catch((e) => setMsg(e.message));
        return;
      }
      setSearching(true);
      Promise.allSettled([lib.tracks(qq), lib.albums(qq), lib.artists(qq), lib.playlists(qq)]).then((all) => {
        const songs = all[0].status === "fulfilled" && Array.isArray(all[0].value) ? all[0].value : [];
        const albs = all[1].status === "fulfilled" && Array.isArray(all[1].value) ? all[1].value : [];
        const arts = all[2].status === "fulfilled" && Array.isArray(all[2].value) ? all[2].value : [];
        const pls = all[3].status === "fulfilled" && Array.isArray(all[3].value) ? all[3].value : [];
        setRes({ songs: songs.slice(0, 6), albums: albs.slice(0, 6), artists: arts.slice(0, 6), playlists: pls.slice(0, 6) });
      });
    }, 220);
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
          placeholder="Search"
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
      {searching ? (
        <div className="search-results">
          <ResultSection title="Songs">
            {res.songs.length ? (
              res.songs.map((t) => (
                <div key={t.id} className="search-item">
                  <button
                    type="button"
                    className="ghost search-play"
                    title="Play"
                    aria-label="Play"
                    onClick={() => {
                      const item = {
                        id: t.id,
                        label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
                        url: lib.streamUrl(t.id),
                        artist: t.artist?.name || "",
                        title: t.title || "Track",
                        album: t.album?.title || "",
                        coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
                      };
                      player.playQueue([item], 0);
                    }}
                  >
                    <IPlay size={16} />
                  </button>
                  <div className="search-item-main">
                    <div className="search-item-title">{t.title || "Track"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t.artist?.name || "—"} {t.album?.title ? `• ${t.album.title}` : ""}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">No matches</div>
            )}
          </ResultSection>

          <ResultSection title="Albums">
            {res.albums.length ? (
              <div className="pill-row">
                {res.albums.map((a) => (
                  <Link key={a.id} to={"/album/" + a.id} className="pill">
                    {a.title}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="muted">No matches</div>
            )}
          </ResultSection>

          <ResultSection title="Artists">
            {res.artists.length ? (
              <div className="pill-row">
                {res.artists.map((a) => (
                  <Link key={a.id} to={"/artist/" + a.id} className="pill">
                    {a.name}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="muted">No matches</div>
            )}
          </ResultSection>

          <ResultSection title="Playlists">
            {res.playlists.length ? (
              <div className="pill-row">
                {res.playlists.map((p) => (
                  <Link key={p.id} to={"/playlist/" + p.id} className="pill">
                    {p.name}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="muted">No matches</div>
            )}
          </ResultSection>
        </div>
      ) : (
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
                    <IPlay size={16} />
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
      )}
    </div>
  );
}

function ResultSection({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
