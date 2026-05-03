import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { releasePlaybackServerSync, trackFormatForPlayback } from "./api";

const Ctx = React.createContext(null);
export function PlayerProvider({ children }) {
  const ref = useRef(null);
  const queueRef = useRef([]);
  const indexRef = useRef(-1);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  const lastVolumeRef = useRef(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(-1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [lastVolume, setLastVolume] = useState(1);

  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;

  queueRef.current = queue;
  indexRef.current = idx;
  volumeRef.current = volume;
  mutedRef.current = muted;
  lastVolumeRef.current = lastVolume;

  const applyVolume = useCallback((v) => {
    const el = ref.current;
    if (el) el.volume = v;
  }, []);
  const applyMuted = useCallback((m) => {
    const el = ref.current;
    if (el) el.muted = m;
  }, []);

  const setAudioEl = useCallback((el) => {
    ref.current = el;
    try {
      if (el) {
        el.volume = volumeRef.current;
        el.muted = mutedRef.current;
        setIsPlaying(!el.paused);
      } else {
        setIsPlaying(false);
      }
    } catch (_) {
      setIsPlaying(false);
    }
  }, []);

  const playQueue = useCallback((items, startIndex, opts) => {
    const skipRelease = opts && opts.skipPlaybackRelease === true;
    if (!skipRelease) releasePlaybackServerSync();
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      setQueue([]);
      setIdx(-1);
      return;
    }
    const si = typeof startIndex === "number" ? startIndex : 0;
    const clamped = Math.max(0, Math.min(list.length - 1, si));
    setQueue(list);
    setIdx(clamped);
  }, []);

  const playOne = useCallback(
    (id, label, url, trackOrExt) => {
      const format =
        trackOrExt && typeof trackOrExt === "object"
          ? trackFormatForPlayback(trackOrExt)
          : trackFormatForPlayback({ format: trackOrExt });
      playQueue([{ id, label, url, ...(format ? { format } : {}) }], 0);
    },
    [playQueue]
  );

  const playNext = useCallback((item) => {
    if (!item) return;
    releasePlaybackServerSync();
    setQueue((q) => {
      const base = Array.isArray(q) ? q.slice() : [];
      const curIdx = indexRef.current;
      const insertAt = curIdx >= 0 ? curIdx + 1 : base.length;
      base.splice(insertAt, 0, item);
      return base;
    });
  }, []);

  const jumpTo = useCallback((i) => {
    const n = typeof i === "number" ? i : -1;
    const q = queueRef.current;
    const len = Array.isArray(q) ? q.length : 0;
    if (!len) {
      setIdx(-1);
      return;
    }
    setIdx(Math.max(0, Math.min(len - 1, n)));
  }, []);

  const next = useCallback(() => {
    setIdx((i) => {
      const len = queueRef.current.length;
      return len ? Math.min(len - 1, i + 1) : -1;
    });
  }, []);

  const prev = useCallback(() => {
    setIdx((i) => {
      const len = queueRef.current.length;
      return len ? Math.max(0, i - 1) : -1;
    });
  }, []);

  const removeTrackFromQueueById = useCallback((deadId) => {
    const sid = String(deadId || "");
    if (!sid) return;
    const curQ = queueRef.current;
    const curIdx = indexRef.current;
    const removeIdx = curQ.findIndex((x) => String(x?.id ?? "") === sid);
    if (removeIdx < 0) return;
    const newQ = curQ.filter((_, j) => j !== removeIdx);
    let ni = curIdx;
    if (newQ.length === 0) {
      ni = -1;
    } else if (removeIdx < curIdx) {
      ni = curIdx - 1;
    } else if (removeIdx === curIdx) {
      ni = Math.min(curIdx, newQ.length - 1);
    } else {
      ni = curIdx;
    }
    setQueue(newQ);
    setIdx(ni);
  }, []);

  const setVol = useCallback(
    (v) => {
      const vv = Math.max(0, Math.min(1, v));
      setVolume(vv);
      if (vv > 0) {
        setLastVolume(vv);
        lastVolumeRef.current = vv;
      }
      applyVolume(vv);
    },
    [applyVolume]
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nextM = !m;
      applyMuted(nextM);
      if (!nextM) {
        const restore = lastVolumeRef.current || 1;
        setVolume(restore);
        applyVolume(restore);
      }
      return nextM;
    });
  }, [applyMuted, applyVolume]);

  const setMute = useCallback(
    (m) => {
      const mm = !!m;
      setMuted(mm);
      applyMuted(mm);
      if (!mm) {
        const restore = lastVolumeRef.current || volumeRef.current || 1;
        setVolume(restore);
        applyVolume(restore);
      }
    },
    [applyMuted, applyVolume]
  );

  const api = useMemo(
    () => ({
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
      removeTrackFromQueueById,
      setVolume: setVol,
      toggleMute,
      setMute,
    }),
    [
      isPlaying,
      setAudioEl,
      queue,
      idx,
      current,
      volume,
      muted,
      playQueue,
      playOne,
      playNext,
      jumpTo,
      next,
      prev,
      removeTrackFromQueueById,
      setVol,
      toggleMute,
      setMute,
    ]
  );

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
      removeTrackFromQueueById: () => {},
    }
  );
}
