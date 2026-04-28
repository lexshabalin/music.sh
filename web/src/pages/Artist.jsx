import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";

export function Artist() {
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [albums, setAlbums] = useState([]);
  const [err, setErr] = useState("");
  const player = usePlayer();

  useEffect(() => {
    const t = setTimeout(() => {
      lib
        .albums(q, id)
        .then((x) => {
          setErr("");
          setAlbums(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(t);
  }, [q, id]);

  return (
    <div>
      <p>
        <Link to="/artists" className="muted">
          ← Artists
        </Link>
      </p>
      <div className="search">
        <input placeholder="Search albums…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
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
                    } catch (x) {}
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
    </div>
  );
}

