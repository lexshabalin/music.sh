import React, { useContext, useMemo, useRef, useState } from "react";
import { releasePlaybackServerSync } from "./api";

const Ctx = React.createContext(null);
export function PlayerProvider({ children }) {
  const ref = useRef(null);
  const queueRef = useRef([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(1);

  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;

  queueRef.current = queue;

  const api = useMemo(() => {
    const applyVolume = (v) => {
      const el = ref.current;
      if (el) el.volume = v;
    };
    const applyMuted = (m) => {
      const el = ref.current;
      if (el) el.muted = m;
    };
    const setAudioEl = (el) => {
      // React calls with null on unmount. Keep both state + ref accurate.
      ref.current = el;
      try {
        if (el) {
          el.volume = volume;
          el.muted = muted;
          setIsPlaying(!el.paused);
        } else {
          setIsPlaying(false);
        }
      } catch (_) {
        setIsPlaying(false);
      }
    };
    const playQueue = (items, startIndex) => {
      releasePlaybackServerSync();
      setQueue(items || []);
      setIdx(typeof startIndex === "number" ? startIndex : 0);
    };
    const playOne = (id, label, url) => playQueue([{ id, label, url }], 0);
    const playNext = (item) => {
      if (!item) return;
      releasePlaybackServerSync();
      setQueue((q) => {
        const base = Array.isArray(q) ? q.slice() : [];
        const insertAt = idx >= 0 ? idx + 1 : base.length;
        base.splice(insertAt, 0, item);
        return base;
      });
    };
    const jumpTo = (i) => {
      const n = typeof i === "number" ? i : -1;
      const q = queueRef.current;
      const len = Array.isArray(q) ? q.length : 0;
      if (!len) {
        setIdx(-1);
        return;
      }
      setIdx(Math.max(0, Math.min(len - 1, n)));
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
      isPlaying,
      setAudioEl,
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
  }, [queue, idx, current, volume, muted, lastVolume, isPlaying]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) {
      setIsPlaying(false);
      return;
    }
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    // initial
    try {
      setIsPlaying(!el.paused);
    } catch (_) {
      setIsPlaying(false);
    }
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [current?.id]);

  // keep element volume in sync
  try {
    if (ref.current && ref.current.volume !== volume) {
      ref.current.volume = volume;
    }
    if (ref.current && ref.current.muted !== muted) {
      ref.current.muted = muted;
    }
  } catch (_) {
    // Some browsers can throw if the underlying media element was unmounted.
    // Next render will repair ref.current via the audio ref callback.
  }
  const value = api;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function usePlayer() {
  return (
    useContext(Ctx) || {
      ref: { current: null },
      isPlaying: false,
      setAudioEl: () => {},
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
