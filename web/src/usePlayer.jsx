import React, { useContext, useMemo, useRef, useState } from "react";

const Ctx = React.createContext(null);
export function PlayerProvider({ children }) {
  const ref = useRef(null);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [volume, setVolume] = useState(1);

  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;

  const api = useMemo(() => {
    const applyVolume = (v) => {
      const el = ref.current;
      if (el) el.volume = v;
    };
    const playQueue = (items, startIndex) => {
      setQueue(items || []);
      setIdx(typeof startIndex === "number" ? startIndex : 0);
    };
    const playOne = (id, label, url) => playQueue([{ id, label, url }], 0);
    const playNext = (item) => {
      if (!item) return;
      setQueue((q) => {
        const base = Array.isArray(q) ? q.slice() : [];
        const insertAt = idx >= 0 ? idx + 1 : base.length;
        base.splice(insertAt, 0, item);
        return base;
      });
    };
    const next = () => setIdx((i) => (queue.length ? Math.min(queue.length - 1, i + 1) : -1));
    const prev = () => setIdx((i) => (queue.length ? Math.max(0, i - 1) : -1));
    const setVol = (v) => {
      const vv = Math.max(0, Math.min(1, v));
      setVolume(vv);
      applyVolume(vv);
    };
    return { ref, queue, index: idx, current, volume, playQueue, playOne, playNext, next, prev, setVolume: setVol };
  }, [queue, idx, current, volume]);

  // keep element volume in sync
  if (ref.current && ref.current.volume !== volume) {
    ref.current.volume = volume;
  }
  const value = api;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function usePlayer() {
  return (
    useContext(Ctx) || {
      ref: { current: null },
      queue: [],
      index: -1,
      current: null,
      volume: 1,
      playQueue: () => {},
      playOne: () => {},
      playNext: () => {},
      next: () => {},
      prev: () => {},
      setVolume: () => {},
    }
  );
}
