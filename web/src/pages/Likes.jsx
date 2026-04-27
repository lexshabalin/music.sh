import { useEffect, useState } from "react";
import { lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackRow } from "../components/TrackMenu";

export function Likes() {
  const [tracks, setT] = useState([]);
  const p = usePlayer();
  const likedSet = new Set(tracks.map((t) => t.id));
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
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    }));
    p.playQueue(items, startIdx);
  };

  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || "Track",
      album: t.album?.title || "",
      coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
    };
    if (!p.current) {
      p.playQueue([item], 0);
      return;
    }
    p.playNext(item);
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
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            onPlayAt={(idx) => playAt(idx)}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={likedSet.has(t.id)}
            onToggleLike={() => unlike(t.id)}
            label={`${t.title || "Untitled"}`}
          />
        ))}
      </ul>
    </div>
  );
}
