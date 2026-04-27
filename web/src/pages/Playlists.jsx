import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickCoversForPlaylist(plId, tracks) {
  const albumIds = [];
  for (const t of tracks || []) {
    const id = t?.album?.id;
    if (id && !albumIds.includes(id)) albumIds.push(id);
  }
  if (albumIds.length === 0) return [];
  if (albumIds.length === 1) return albumIds;
  // deterministic pseudo-random based on playlist id
  let seed = hash32(plId);
  const arr = albumIds.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 4);
}

export function Playlists() {
  const [list, setList] = useState([]);
  const [name, setN] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [covers, setCovers] = useState({});
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (Array.isArray(list) ? list : []).map(async (p) => {
          try {
            const pl = await lib.playlist(p.id);
            const ids = pickCoversForPlaylist(p.id, pl?.tracks || []);
            return [p.id, ids.map((aid) => lib.coverUrl(aid))];
          } catch (_) {
            return [p.id, []];
          }
        }),
      );
      if (cancelled) return;
      const next = {};
      for (const [id, urls] of entries) next[id] = urls;
      setCovers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [list]);

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
              <div className={"pl-collage " + ((covers[p.id] || []).length <= 1 ? "one" : "four")}>
                {(covers[p.id] || []).length ? (
                  (covers[p.id] || []).slice(0, 4).map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)
                ) : (
                  <div className="pl-collage-empty" />
                )}
              </div>
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
