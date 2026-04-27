import { useEffect, useState } from "react";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";

export function Likes() {
  const [tracks, setT] = useState([]);
  const p = usePlayer();
  const load = async () => {
    const res = await lib.likeIds();
    const trackIds = Array.isArray(res?.trackIds) ? res.trackIds : [];
    const t = await Promise.all(trackIds.map((id) => lib.track(id).catch(() => null)));
    setT(t.filter(Boolean));
  };
  useEffect(() => {
    load();
  }, []);

  const playAt = (startIdx) => {
    const items = tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
    }));
    p.playQueue(items, startIdx);
  };

  const unlike = async (trackId) => {
    await lib.unlike(trackId);
    setT((prev) => prev.filter((x) => x.id !== trackId));
  };

  return (
    <div>
      <h2>Likes</h2>
      <ul className="plain-list">
        {tracks.map((t, i) => (
          <li key={t.id}>
            <span>
              {t.artist ? t.artist.name + " — " : ""}
              {t.title}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => playAt(i)}>
                Play
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => unlike(t.id)}
                title="Unlike"
                style={{ color: "tomato", borderColor: "tomato" }}
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
