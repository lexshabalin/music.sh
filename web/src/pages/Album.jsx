import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";

export function Album() {
  const { id } = useParams();
  const [tr, setTr] = useState([]);
  const [a, setA] = useState(null);
  const [liked, setLiked] = useState(new Set());
  const p = usePlayer();
  const load = () => {
    lib
      .tracks("", id)
      .then(setTr)
      .catch(() => setTr([]));
    lib
      .album(id)
      .then(setA)
      .catch(() => setA(null));
    lib
      .likeIds()
      .then(({ trackIds = [] }) => setLiked(new Set(trackIds)))
      .catch(() => setLiked(new Set()));
  };
  useEffect(() => {
    load();
  }, [id]);
  const playAt = (startIdx) => {
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
    }));
    p.playQueue(items, startIdx);
  };
  const toggleLike = async (trackId) => {
    const on = liked.has(trackId);
    try {
      if (on) await lib.unlike(trackId);
      else await lib.like(trackId);
      const next = new Set(liked);
      if (on) next.delete(trackId);
      else next.add(trackId);
      setLiked(next);
    } catch (_) {}
  };
  return (
    <div>
      <p>
        <Link to="/" className="muted">
          ← Home
        </Link>
      </p>
      <div className="card" style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
        {a?.coverUrl ? (
          <img
            src={lib.coverUrl(a.id)}
            alt=""
            style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8 }}
          />
        ) : (
          <div style={{ width: 120, height: 120, background: "#222" }} />
        )}
        <div>
          <h2 style={{ margin: 0 }}>{a?.title || "Album"}</h2>
          <div className="muted">{a?.artistName}</div>
        </div>
      </div>
      <ul className="plain-list">
        {tr.map((t, i) => (
          <li key={t.id}>
            <span>
              {t.trackNo != null ? t.trackNo + ". " : ""}
              {t.title || "Untitled"}{" "}
              {t.durationMs != null ? <span className="muted">({Math.floor(t.durationMs / 1000)}s)</span> : null}
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => playAt(i)}>
                Play
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => toggleLike(t.id)}
                title="Like"
                style={{ color: liked.has(t.id) ? "tomato" : undefined, borderColor: liked.has(t.id) ? "tomato" : undefined }}
              >
                ♥
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
