import React, { useContext, useMemo, useRef, useState } from "react";

const Ctx = React.createContext(null);
export function PlayerProvider({ children }) {
  const ref = useRef(null);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(1);

  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;

  const api = useMemo(() => {
    const applyVolume = (v) => {
      const el = ref.current;
      if (el) el.volume = v;
    };
    const applyMuted = (m) => {
      const el = ref.current;
      if (el) el.muted = m;
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
    const jumpTo = (i) => {
      const n = typeof i === "number" ? i : -1;
      setIdx(() => {
        if (!queue.length) return -1;
        return Math.max(0, Math.min(queue.length - 1, n));
      });
    };
    const next = () => setIdx((i) => (queue.length ? Math.min(queue.length - 1, i + 1) : -1));
    const prev = () => setIdx((i) => (queue.length ? Math.max(0, i - 1) : -1));
    const setVol = (v) => {
      const vv = Math.max(0, Math.min(1, v));
      setVolume(vv);
      if (vv > 0) setLastVolume(vv);
      applyVolume(vv);
    };
    const toggleMute = () => {
      setMuted((m) => {
        const nextM = !m;
        applyMuted(nextM);
        if (!nextM) {
          // restore volume to last non-zero
          setVol(lastVolume || 1);
        }
        return nextM;
      });
    };
    const setMute = (m) => {
      const mm = !!m;
      setMuted(mm);
      applyMuted(mm);
      if (!mm) setVol(lastVolume || volume || 1);
    };
    return {
      ref,
      queue,
      index: idx,
      current,
      volume,
      muted,
      playQueue,
      playOne,
      playNext,
      jumpTo,
      next,
      prev,
      setVolume: setVol,
      toggleMute,
      setMute,
    };
  }, [queue, idx, current, volume, muted, lastVolume]);

  // keep element volume in sync
  if (ref.current && ref.current.volume !== volume) {
    ref.current.volume = volume;
  }
  if (ref.current && ref.current.muted !== muted) {
    ref.current.muted = muted;
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
      muted: false,
      playQueue: () => {},
      playOne: () => {},
      playNext: () => {},
      jumpTo: () => {},
      next: () => {},
      prev: () => {},
      setVolume: () => {},
      toggleMute: () => {},
      setMute: () => {},
    }
  );
}
