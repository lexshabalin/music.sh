import React from "react";
import { createPortal } from "react-dom";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import {
  auth,
  getToken,
  getPlaybackClientId,
  lib,
  PLAYBACK_SYNC_RELEASE_EVENT,
  playback,
  releasePlaybackServerSync,
  tracksToQueueItems,
} from "./api";
import { usePlayer } from "./usePlayer";
import { Login } from "./pages/Login";
import { Library } from "./pages/Library";
import { Album } from "./pages/Album";
import { Playlists } from "./pages/Playlists";
import { Likes } from "./pages/Likes";
import { Register } from "./pages/Register";
import { Artists } from "./pages/Artists";
import { Albums } from "./pages/Albums";
import { Artist } from "./pages/Artist";
import { Playlist } from "./pages/Playlist";
import { Songs } from "./pages/Songs";
import { PlayerPlaylistModal } from "./components/PlayerPlaylistModal";
import { GlobalSearch } from "./components/GlobalSearch";
import {
  IFastForward,
  IHeart,
  IPause,
  IPlay,
  IPlus,
  IQueue,
  IRemoteDevice,
  IRewind,
  ISpeaker,
  ISpeakerOff,
} from "./components/icons";

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    console.error(err);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card" style={{ maxWidth: 720, margin: "2rem auto" }}>
          <h2>UI crashed</h2>
          <p className="muted">Open DevTools Console to see the error.</p>
          <pre style={{ whiteSpace: "pre-wrap", color: "tomato" }}>
            {String(this.state.err?.message || this.state.err)}
          </pre>
          <button className="ghost" type="button" onClick={() => this.setState({ err: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function BrandIcon() {
  return (
    <svg
      className="brand-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="19" height="16" rx="3.5" />
      <path d="M2.5 8h19" />
      <circle cx="6" cy="6" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="6" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="11" cy="6" r="0.6" fill="currentColor" stroke="none" />
      {/* music note */}
      <path d="M14 12v5.5a1.5 1.5 0 1 1-1-1.42V12l6-1.2v4.7a1.5 1.5 0 1 1-1-1.42V9.8L14 12Z" />
    </svg>
  );
}

function Shell({ children }) {
  const location = useLocation();
  const p = usePlayer();
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [curT, setCurT] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [playErr, setPlayErr] = React.useState("");
  const [liked, setLiked] = React.useState(false);
  const [showPlModal, setShowPlModal] = React.useState(false);
  const [showQueue, setShowQueue] = React.useState(false);
  const queueBtnRef = React.useRef(null);
  const mobileQueueBtnRef = React.useRef(null);
  const [me, setMe] = React.useState(null);
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [showProfile, setShowProfile] = React.useState(false);
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [mobileTopChromeHidden, setMobileTopChromeHidden] = React.useState(false);
  const lastScrollYRef = React.useRef(0);
  const [showMobilePlayer, setShowMobilePlayer] = React.useState(false);
  const [mobilePlayerIsDragging, setMobilePlayerIsDragging] = React.useState(false);
  const mobilePlayerSheetRef = React.useRef(null);
  const mobilePlayerDragRef = React.useRef({ active: false, startY: 0, dy: 0 });
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches;
  });
  const userBtnRef = React.useRef(null);
  const [bg, setBg] = React.useState({ type: "none", preset: "", url: "", mime: "" });
  const [remotePlayingNotice, setRemotePlayingNotice] = React.useState("");
  const [remotePlaybackActive, setRemotePlaybackActive] = React.useState(false);
  const remotePlaybackActiveRef = React.useRef(false);
  const remoteProgressBaseMsRef = React.useRef(0);
  const remoteProgressUpdatedAtRef = React.useRef(0);
  const remotePlaybackSeenUntilRef = React.useRef(0);
  const remoteInactiveStreakRef = React.useRef(0);

  const skipAutoplayOnceRef = React.useRef(false);
  const skipPlaybackPushUntilRef = React.useRef(0);
  const restoredPlaybackRef = React.useRef(false);
  /** After first `/api/me/playback` restore attempt finishes — blocks flush from wiping DB before hydrate. */
  const playbackHydratedRef = React.useRef(false);
  const pendingSeekSecRef = React.useRef(null);
  const playQueueRef = React.useRef(p.playQueue);
  React.useEffect(() => {
    playQueueRef.current = p.playQueue;
  }, [p.playQueue]);

  const suspendPlaybackPushRef = React.useRef(false);
  const takeoverRequestedRef = React.useRef(false);
  const takeoverGuardUntilRef = React.useRef(0);
  const ownerEpochRef = React.useRef(0);

  const takeoverRemotePlaybackUI = React.useCallback(() => {
    // Important ordering: block outgoing flush BEFORE pausing, because pause
    // event handler triggers an immediate flush.
    suspendPlaybackPushRef.current = true;
    try {
      const el = p.ref.current;
      if (el) el.pause();
    } catch (_) {}
    setRemotePlayingNotice("Музыка воспроизводится на другом устройстве");
    window.setTimeout(() => setRemotePlayingNotice(""), 9000);
  }, [p.ref]);

  const flushPlayback = React.useCallback(async (opts = {}) => {
    const forceNow = !!opts.forceNow;
    const forceTakeover = !!opts.forceTakeover;
    if (!getToken()) return;
    if (!forceNow && !playbackHydratedRef.current) return;
    if (!forceNow && suspendPlaybackPushRef.current) return;
    if (!forceNow && Date.now() < skipPlaybackPushUntilRef.current) return;
    const el = p.ref.current;
    const q = p.queue;
    const idx = p.index;
    const cid = getPlaybackClientId();
    const body =
      !q.length || idx < 0
        ? {
            trackIds: [],
            currentIndex: 0,
            positionMs: 0,
            isPlaying: false,
            clientId: cid,
            ownerEpoch: ownerEpochRef.current,
            forceTakeover: forceTakeover || takeoverRequestedRef.current,
          }
        : {
            trackIds: q.map((x) => x.id),
            currentIndex: idx,
            positionMs: Math.round(Math.max(0, (el?.currentTime || 0) * 1000)),
            isPlaying: !!(el && !el.paused),
            clientId: cid,
            ownerEpoch: ownerEpochRef.current,
            forceTakeover: forceTakeover || takeoverRequestedRef.current,
          };
    try {
      await playback.put(body);
      takeoverRequestedRef.current = false;
    } catch (e) {
      if (e?.httpStatus !== 409) return;
      try {
        const st = await playback.get();
        ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : 0;
        const mine = getPlaybackClientId();
        if (st?.isPlaying && st.clientId && mine && st.clientId !== mine) {
          takeoverRemotePlaybackUI();
        }
      } catch (_) {}
    }
  }, [p.queue, p.index, p.ref, takeoverRemotePlaybackUI]);

  const flushPlaybackRef = React.useRef(flushPlayback);
  React.useEffect(() => {
    flushPlaybackRef.current = flushPlayback;
  }, [flushPlayback]);

  const pushTakeoverNow = React.useCallback(async () => {
    if (!getToken()) return;
    const q = p.queue;
    const idx = p.index;
    if (!Array.isArray(q) || !q.length || idx < 0 || idx >= q.length) return;
    const el = p.ref.current;
    const cid = getPlaybackClientId();
    const body = {
      trackIds: q.map((x) => x.id),
      currentIndex: idx,
      positionMs: Math.round(Math.max(0, (el?.currentTime || 0) * 1000)),
      isPlaying: true,
      clientId: cid,
      ownerEpoch: ownerEpochRef.current,
    };
    try {
      const r = await playback.takeover(body);
      ownerEpochRef.current = Number.isFinite(r?.ownerEpoch) ? Number(r.ownerEpoch) : (ownerEpochRef.current + 1);
      takeoverRequestedRef.current = false;
    } catch (_) {}
  }, [p.queue, p.index, p.ref]);

  const claimPlaybackSync = React.useCallback(() => {
    releasePlaybackServerSync();
  }, []);

  const doLogout = React.useCallback(async () => {
    try {
      const el = p.ref.current;
      if (el && typeof el.pause === "function") el.pause();
    } catch (_) {}
    try {
      if (typeof p.playQueue === "function") p.playQueue([], -1);
    } catch (_) {}
    try {
      await playback.clear();
    } catch (_) {}
    restoredPlaybackRef.current = false;
    playbackHydratedRef.current = false;
    suspendPlaybackPushRef.current = false;
    takeoverRequestedRef.current = false;
    takeoverGuardUntilRef.current = 0;
    ownerEpochRef.current = 0;
    try {
      localStorage.removeItem("musicsh_token");
    } catch (_) {}
    window.location.hash = "#/login";
  }, [p]);

  React.useEffect(() => {
    if (!getToken()) {
      restoredPlaybackRef.current = false;
      playbackHydratedRef.current = false;
      takeoverRequestedRef.current = false;
      takeoverGuardUntilRef.current = 0;
      ownerEpochRef.current = 0;
      return;
    }
    if (restoredPlaybackRef.current) return;
    restoredPlaybackRef.current = true;
    void (async () => {
      try {
        const st = await playback.get();
        ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : 0;
        if (!getToken()) return;
        if (!st?.trackIds?.length) return;
        const tracks = await lib.tracksByIds(st.trackIds);
        if (!getToken() || !tracks.length) return;
        const origId = st.trackIds[st.currentIndex];
        let newIdx = tracks.findIndex((t) => t.id === origId);
        if (newIdx < 0) newIdx = 0;
        const items = tracksToQueueItems(tracks);
        skipPlaybackPushUntilRef.current = Date.now() + 4000;
        if (!st.isPlaying) skipAutoplayOnceRef.current = true;
        pendingSeekSecRef.current = Math.max(0, (st.positionMs || 0) / 1000 - 0.5);
        playQueueRef.current(items, newIdx);
      } catch (_) {
      } finally {
        playbackHydratedRef.current = true;
      }
    })();
  }, [me?.id]);

  React.useEffect(() => {
    if (isMobile && !showMobilePlayer) setShowQueue(false);
  }, [isMobile, showMobilePlayer]);

  React.useEffect(() => {
    const onRelease = () => {
      suspendPlaybackPushRef.current = false;
      takeoverRequestedRef.current = true;
      // Give explicit user takeover a short priority window.
      takeoverGuardUntilRef.current = Date.now() + 3000;
      setRemotePlaybackActive(false);
      remotePlaybackActiveRef.current = false;
      remotePlaybackSeenUntilRef.current = 0;
      remoteInactiveStreakRef.current = 0;
      // Explicit takeover endpoint (atomic intent), then heartbeat.
      try {
        void pushTakeoverNow();
        flushPlaybackRef.current({ forceNow: true, forceTakeover: true });
      } catch (_) {}
    };
    window.addEventListener(PLAYBACK_SYNC_RELEASE_EVENT, onRelease);
    return () => window.removeEventListener(PLAYBACK_SYNC_RELEASE_EVENT, onRelease);
  }, [pushTakeoverNow]);

  React.useEffect(() => {
    if (!getToken()) return;
    const tick = async () => {
      if (suspendPlaybackPushRef.current) return;
      if (Date.now() < takeoverGuardUntilRef.current) return;
      if (Date.now() < skipPlaybackPushUntilRef.current) return;
      const mine = getPlaybackClientId();
      if (!mine) return;
      try {
        const el = p.ref.current;
        if (!el || el.paused) return;
        const st = await playback.get();
        ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : ownerEpochRef.current;
        if (!st?.isPlaying || !st.clientId || st.clientId === mine) return;
        setRemotePlaybackActive(true);
        takeoverRemotePlaybackUI();
      } catch (_) {}
    };
    const id = window.setInterval(tick, 600);
    tick();
    return () => clearInterval(id);
  }, [p.current?.id, takeoverRemotePlaybackUI]);

  React.useEffect(() => {
    remotePlaybackActiveRef.current = remotePlaybackActive;
  }, [remotePlaybackActive]);

  React.useEffect(() => {
    if (!getToken() || !p.current?.id) {
      setRemotePlaybackActive(false);
      remotePlaybackActiveRef.current = false;
      remotePlaybackSeenUntilRef.current = 0;
      remoteInactiveStreakRef.current = 0;
      return;
    }
    const syncRemote = async () => {
      try {
        const st = await playback.get();
        ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : ownerEpochRef.current;
        const mine = getPlaybackClientId();
        const activeRemote = !!(st?.isPlaying && st?.clientId && mine && st.clientId !== mine);
        if (activeRemote) {
          remoteInactiveStreakRef.current = 0;
          remotePlaybackSeenUntilRef.current = Date.now() + 800;
          remoteProgressBaseMsRef.current = Math.max(0, Number(st.positionMs) || 0);
          remoteProgressUpdatedAtRef.current = Date.parse(st.updatedAt || "") || Date.now();
          if (!remotePlaybackActiveRef.current) {
            remotePlaybackActiveRef.current = true;
            setRemotePlaybackActive(true);
          }
        } else {
          remoteInactiveStreakRef.current += 1;
          // Hide only after N consecutive inactive polls to avoid flicker.
          if (remoteInactiveStreakRef.current >= 3) {
            remotePlaybackActiveRef.current = false;
            setRemotePlaybackActive(false);
            remotePlaybackSeenUntilRef.current = 0;
          }
        }
        if (!activeRemote || !Array.isArray(st?.trackIds) || !st.trackIds.length) return;
        const remoteTrackId = st.trackIds[st.currentIndex];
        if (!remoteTrackId) return;
        const q = Array.isArray(p.queue) ? p.queue : [];
        const remoteIdx = q.findIndex((x) => x?.id === remoteTrackId);
        if (remoteIdx >= 0 && remoteIdx !== p.index) {
          skipAutoplayOnceRef.current = true;
          p.jumpTo(remoteIdx);
        }
      } catch (_) {}
    };
    const id = window.setInterval(syncRemote, 1000);
    syncRemote();
    return () => clearInterval(id);
  }, [p.current?.id, p.index, p.queue]);

  React.useEffect(() => {
    if (!remotePlaybackActive) return;
    const tick = () => {
      // Do not auto-hide based on wall-clock only; rely on consecutive inactive polls.
      if (remoteInactiveStreakRef.current < 3) return;
      remotePlaybackActiveRef.current = false;
      setRemotePlaybackActive(false);
      remotePlaybackSeenUntilRef.current = 0;
    };
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [remotePlaybackActive]);

  React.useEffect(() => {
    if (!remotePlaybackActive) return;
    const tick = () => {
      const baseMs = remoteProgressBaseMsRef.current;
      const updatedAt = remoteProgressUpdatedAtRef.current || Date.now();
      const nextSec = Math.max(0, (baseMs + Math.max(0, Date.now() - updatedAt)) / 1000);
      setCurT(nextSec);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [remotePlaybackActive, p.current?.id]);

  React.useEffect(() => {
    if (!getToken()) return;
    const id = window.setInterval(() => flushPlayback(), 5000);
    return () => clearInterval(id);
  }, [flushPlayback]);

  React.useEffect(() => {
    const onHidden = () => flushPlayback();
    const vis = () => {
      if (document.visibilityState === "hidden") onHidden();
    };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [flushPlayback]);

  React.useEffect(() => {
    flushPlayback();
  }, [p.current?.id, flushPlayback]);

  React.useEffect(() => {
    const authed = !!getToken();
    if (!authed) {
      setBg({ type: "none", preset: "", url: "", mime: "" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const s = await auth.backgroundSettings();
        if (cancelled) return;
        setBg({
          type: s?.type || "none",
          preset: s?.preset || "",
          url: s?.url || "",
          mime: s?.mime || "",
        });
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [!!getToken()]);

  React.useEffect(() => {
    // Close mobile sidebar on route changes.
    setMobileNavOpen(false);
    setMobileTopChromeHidden(false);
  }, [location.pathname]);

  React.useEffect(() => {
    if (mobileNavOpen) setMobileTopChromeHidden(false);
  }, [mobileNavOpen]);

  React.useEffect(() => {
    if (!isMobile || !getToken()) {
      setMobileTopChromeHidden(false);
      return undefined;
    }
    lastScrollYRef.current = window.scrollY || 0;
    const onScroll = () => {
      if (mobileNavOpen) {
        lastScrollYRef.current = window.scrollY || 0;
        return;
      }
      const y = window.scrollY || 0;
      const prev = lastScrollYRef.current;
      const delta = y - prev;
      lastScrollYRef.current = y;
      if (y < 48) {
        setMobileTopChromeHidden(false);
        return;
      }
      const t = 10;
      if (delta > t) setMobileTopChromeHidden(true);
      else if (delta < -t) setMobileTopChromeHidden(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isMobile, mobileNavOpen]);

  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e) => setIsMobile(!!e.matches);
    setIsMobile(!!mq.matches);
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  React.useEffect(() => {
    if (!isMobile) setShowMobilePlayer(false);
  }, [isMobile]);

  const setMobilePlayerTransform = React.useCallback((dyPx) => {
    const el = mobilePlayerSheetRef.current;
    if (!el) return;
    el.style.transform = `translateY(${dyPx}px)`;
  }, []);

  const endMobilePlayerDrag = React.useCallback(
    (finalDyPx) => {
      const dy = Math.max(0, Number.isFinite(finalDyPx) ? finalDyPx : 0);
      const threshold = Math.max(100, Math.round(window.innerHeight * 0.18));
      setMobilePlayerIsDragging(false);
      mobilePlayerDragRef.current.active = false;
      mobilePlayerDragRef.current.dy = 0;
      if (dy > threshold) {
        setShowMobilePlayer(false);
      } else {
        setMobilePlayerTransform(0);
      }
    },
    [setMobilePlayerTransform]
  );

  React.useEffect(() => {
    const el = p.ref.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      try {
        flushPlaybackRef.current();
      } catch (_) {}
    };
    const onTime = () => {
      // When remote playback is active, we drive progress from server-updated base+updatedAt.
      // Prevent audio timeupdate events from fighting and causing UI "jitter".
      if (remotePlaybackActiveRef.current) return;
      setCurT(el.currentTime || 0);
    };
    const onMeta = () => setDur(el.duration || 0);
    const onError = async () => {
      // Don't auto-skip: browsers can mark the media as ended after a failed load.
      setIsPlaying(false);
      const mediaErr = el.error?.code ? `mediaErr=${el.error.code}` : "";
      const src = p.current?.url || el.currentSrc || "";
      let http = "";
      if (src) {
        try {
          // Probe the URL to surface the real HTTP status (401/404/416/500).
          const r = await fetch(src, { headers: { Range: "bytes=0-0" } });
          http = `http=${r.status}`;
        } catch (_) {
          http = "http=failed";
        }
      }
      setPlayErr(["Playback error (stream failed).", mediaErr, http].filter(Boolean).join(" "));
      // keep queue position; user can retry or skip manually
    };
    const onEnded = () => {
      // Guard: if media ended due to an error / empty response, don't auto-advance forever.
      if (el.error || !Number.isFinite(el.duration) || el.duration <= 0.5 || (el.currentTime || 0) <= 0.1) {
        onError();
        return;
      }
      setPlayErr("");
      p.next();
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    // initial
    onMeta();
    onTime();
    setIsPlaying(!el.paused);
    setPlayErr("");

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [p.current?.id]);

  // iOS Safari in background is more reliable when we keep one audio element
  // and explicitly resume playback after source switch.
  React.useEffect(() => {
    const el = p.ref.current;
    if (!el || !p.current?.id) return;
    if (skipAutoplayOnceRef.current) {
      skipAutoplayOnceRef.current = false;
      return;
    }
    const pr = el.play?.();
    if (pr && typeof pr.catch === "function") {
      pr.catch(() => {
        // Ignore: browser can block autoplay until user interaction.
      });
    }
  }, [p.current?.id]);

  // Resume position from cross-device / reload sync after metadata loads.
  React.useEffect(() => {
    const el = p.ref.current;
    if (!el || !p.current?.id) return;
    const sec = pendingSeekSecRef.current;
    if (sec == null || !Number.isFinite(sec)) return;
    const apply = () => {
      try {
        el.currentTime = Math.max(0, sec);
      } catch (_) {}
      pendingSeekSecRef.current = null;
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
    return () => el.removeEventListener("loadedmetadata", apply);
  }, [p.current?.id]);

  React.useEffect(() => {
    const authed = !!getToken();

    if (!authed) {
      setMe(null);
      setAvatarUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return "";
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const u = await auth.me();
        if (cancelled) return;
        setMe(u);
      } catch (_) {
        if (cancelled) return;
        setMe(null);
      }

      try {
        const b = await auth.avatar();
        if (cancelled) return;
        if (!b) {
          setAvatarUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return "";
          });
          return;
        }
        const url = URL.createObjectURL(b);
        setAvatarUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (_) {
        if (cancelled) return;
        setAvatarUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return "";
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [!!getToken()]);

  React.useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        if (!p.current?.id) return;
        const r = await lib.likeIds();
        if (stop) return;
        setLiked(Array.isArray(r?.trackIds) && r.trackIds.includes(p.current.id));
      } catch (_) {
        if (!stop) setLiked(false);
      }
    };
    check();
    return () => {
      stop = true;
    };
  }, [p.current?.id]);

  // Enable multimedia keys (next/prev) via Media Session API.
  React.useEffect(() => {
    if (!getToken()) return;
    if (typeof navigator === "undefined") return;
    const ms = navigator.mediaSession;
    if (!ms) return;

    const title = p.current?.title || p.current?.label || "Track";
    const artist = p.current?.artist || "";
    const album = p.current?.album || "";
    const artwork = p.current?.coverUrl
      ? [
          { src: p.current.coverUrl, sizes: "96x96", type: "image/jpeg" },
          { src: p.current.coverUrl, sizes: "256x256", type: "image/jpeg" },
          { src: p.current.coverUrl, sizes: "512x512", type: "image/jpeg" },
        ]
      : [];

    try {
      // Some browsers require being served from a secure context; guard errors.
      ms.metadata = new window.MediaMetadata({ title, artist, album, artwork });
    } catch (_) {}

    try {
      ms.setActionHandler("play", async () => {
        releasePlaybackServerSync();
        const el = p.ref.current;
        if (!el) return;
        const pr = el.play();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      });
    } catch (_) {}
    try {
      ms.setActionHandler("pause", () => {
        const el = p.ref.current;
        if (el && typeof el.pause === "function") el.pause();
      });
    } catch (_) {}
    try {
      ms.setActionHandler("nexttrack", () => {
        releasePlaybackServerSync();
        p.next();
      });
    } catch (_) {}
    try {
      ms.setActionHandler("previoustrack", () => {
        releasePlaybackServerSync();
        p.prev();
      });
    } catch (_) {}
    try {
      ms.setActionHandler("seekto", (details) => {
        releasePlaybackServerSync();
        const el = p.ref.current;
        if (!el) return;
        if (details?.seekTime != null && Number.isFinite(details.seekTime)) {
          el.currentTime = Math.max(0, details.seekTime);
        }
      });
    } catch (_) {}

    // Playback state hint helps some devices decide which buttons to show.
    try {
      ms.playbackState = isPlaying ? "playing" : "paused";
    } catch (_) {}

    // Position state improves scrubbing on lockscreen.
    try {
      if (Number.isFinite(dur) && dur > 0) {
        ms.setPositionState?.({
          duration: dur,
          playbackRate: 1,
          position: Math.max(0, Math.min(dur, curT || 0)),
        });
      }
    } catch (_) {}

    return () => {
      // Avoid keeping stale handlers when logging out / switching tracks.
      try { ms.setActionHandler("play", null); } catch (_) {}
      try { ms.setActionHandler("pause", null); } catch (_) {}
      try { ms.setActionHandler("nexttrack", null); } catch (_) {}
      try { ms.setActionHandler("previoustrack", null); } catch (_) {}
      try { ms.setActionHandler("seekto", null); } catch (_) {}
    };
  }, [p.current?.id, p.current?.coverUrl, p.current?.title, p.current?.label, p.current?.artist, p.current?.album, isPlaying, curT, dur]);

  return (
    <>
      <BackgroundLayer bg={bg} />
      {remotePlayingNotice ? (
        <div className="playback-remote-notice" role="status">
          {remotePlayingNotice}
        </div>
      ) : null}
      <div
        className="layout"
        {...(getToken() && isMobile
          ? {
              "data-mobile-chrome": mobileTopChromeHidden && !mobileNavOpen ? "hidden" : "visible",
            }
          : {})}
      >
        {getToken() ? (
          <>
            <button
              type="button"
              className="mobile-nav-toggle ghost"
              aria-label="Toggle navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              <span />
              <span />
              <span />
            </button>
            <div
              className={`mobile-nav-scrim${mobileNavOpen ? " is-open" : ""}`}
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
          </>
        ) : null}
        {getToken() ? (
          <aside className={`sidebar${mobileNavOpen ? " is-open" : ""}`}>
            <div className="brand">
              <BrandIcon />
              <span>music.sh</span>
              <button
                ref={userBtnRef}
                type="button"
                className="user-chip"
                title="Profile"
                aria-label="Profile"
                onClick={() => setShowUserMenu((v) => !v)}
              >
                {avatarUrl ? <img className="user-avatar" src={avatarUrl} alt="" /> : <div className="user-avatar placeholder" />}
              </button>
              {showUserMenu ? (
                <UserMenu
                  anchorRef={userBtnRef}
                  name={me?.displayName || me?.username || me?.email || "User"}
                  onClose={() => setShowUserMenu(false)}
                  onOpenProfile={() => {
                    setShowUserMenu(false);
                    setShowProfile(true);
                  }}
                  onLogout={() => {
                    doLogout();
                  }}
                />
              ) : null}
            </div>
            <nav className="side-nav">
              <Link to="/" onClick={() => setMobileNavOpen(false)}>Home</Link>
              <Link to="/songs" onClick={() => setMobileNavOpen(false)}>Songs</Link>
              <Link to="/artists" onClick={() => setMobileNavOpen(false)}>Artists</Link>
              <Link to="/albums" onClick={() => setMobileNavOpen(false)}>Albums</Link>
              <Link to="/playlists" onClick={() => setMobileNavOpen(false)}>Playlists</Link>
              <Link to="/likes" onClick={() => setMobileNavOpen(false)}>Likes</Link>
            </nav>
          </aside>
        ) : null}
        <main className="main">
          {getToken() ? <GlobalSearch /> : null}
          {children}
        </main>
      </div>
      {p.current && getToken() && !isMobile ? (
        <div className="player">
          <button
            className="player-skip"
            type="button"
            onClick={() => {
              claimPlaybackSync();
              p.prev();
            }}
            title="Rewind"
          >
            <IRewind />
          </button>

          <button
            className="player-play"
            type="button"
            onClick={() => {
              const el = p.ref.current;
              if (!el) return;
              if (el.paused) {
                claimPlaybackSync();
                const pr = el.play();
                if (pr && typeof pr.catch === "function") {
                  pr.catch(() => {
                    setIsPlaying(false);
                    setPlayErr("Playback blocked or failed.");
                  });
                }
              }
              else el.pause();
            }}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <IPause /> : <IPlay />}
          </button>

          <button
            className="player-skip"
            type="button"
            onClick={() => {
              claimPlaybackSync();
              p.next();
            }}
            title="Fast-forward"
          >
            <IFastForward />
          </button>

          <button
            className="player-skip"
            type="button"
            onClick={p.toggleMute}
            title={p.muted ? "Unmute" : "Mute"}
          >
            {p.muted ? <ISpeakerOff /> : <ISpeaker />}
          </button>

          <input
            className="range mono vol"
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
          />

          <div className="nowplaying">
            {p.current.coverUrl ? (
              <img className="nowplaying-art" src={p.current.coverUrl} alt="" />
            ) : (
              <div className="nowplaying-art placeholder" />
            )}
            <div className="nowplaying-text">
              <div className="nowplaying-line1">
                {p.current.artist ? `${p.current.artist} — ` : ""}
                {p.current.title || p.current.label}
              </div>
              <div className="nowplaying-line2">{p.current.album || ""}</div>
            </div>
          </div>

          <button
            className="ghost"
            type="button"
            title={liked ? "Unlike" : "Like"}
            onClick={async () => {
              try {
                if (!p.current?.id) return;
                if (liked) await lib.unlike(p.current.id);
                else await lib.like(p.current.id);
                setLiked(!liked);
              } catch (_) {}
            }}
            style={{ color: liked ? "tomato" : undefined, borderColor: liked ? "tomato" : undefined }}
          >
            <IHeart />
          </button>

          <button className="ghost" type="button" title="Add to playlist" onClick={() => setShowPlModal(true)}>
            <IPlus />
          </button>

          {remotePlaybackActive ? (
            <span className="player-remote-indicator" title="Playing on another device" aria-label="Playing on another device">
              <IRemoteDevice />
            </span>
          ) : null}

          <div className="muted" style={{ minWidth: 64, textAlign: "right" }}>
            {fmtTime(curT)}
          </div>

          <div className="player-progress-wrap">
            <input
              className="range mono progress"
              aria-label="Seek"
              type="range"
              min="0"
              max={Math.max(1, dur || 0)}
              step="0.25"
              value={Math.min(curT, Math.max(1, dur || 0))}
              onChange={(e) => {
                const el = p.ref.current;
                if (!el) return;
                claimPlaybackSync();
                const v = Number(e.target.value);
                el.currentTime = v;
                setCurT(v);
              }}
            />
          </div>

          <button
            ref={queueBtnRef}
            className="player-skip"
            type="button"
            title="Queue"
            aria-label="Queue"
            onClick={() => setShowQueue((v) => !v)}
          >
            <IQueue />
          </button>

          <div className="muted" style={{ minWidth: 64 }}>
            {fmtTime(dur)}
          </div>

          {playErr ? (
            <div className="muted" style={{ color: "tomato", fontSize: 12, marginLeft: 8, maxWidth: 220 }}>
              {playErr}
            </div>
          ) : null}

        </div>
      ) : null}
      {p.current && getToken() && isMobile ? (
        <>
          <div className="player player--mobile-mini" onClick={() => setShowMobilePlayer(true)}>
            <div className="nowplaying">
              {p.current.coverUrl ? (
                <img className="nowplaying-art" src={p.current.coverUrl} alt="" />
              ) : (
                <div className="nowplaying-art placeholder" />
              )}
              <div className="nowplaying-text">
                <div className="nowplaying-line1">
                  {p.current.title || p.current.label}
                </div>
                <div className="nowplaying-line2">{p.current.artist || p.current.album || ""}</div>
              </div>
            </div>
            <div className="player-mini-controls">
              {remotePlaybackActive ? (
                <span className="player-remote-indicator player-remote-indicator--mini" title="Playing on another device" aria-label="Playing on another device">
                  <IRemoteDevice />
                </span>
              ) : null}
              <button
                className="player-skip"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  claimPlaybackSync();
                  p.prev();
                }}
                title="Previous"
              >
                <IRewind />
              </button>
              <button
                className="player-play"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const el = p.ref.current;
                  if (!el) return;
                  if (el.paused) {
                    claimPlaybackSync();
                    const pr = el.play();
                    if (pr && typeof pr.catch === "function") pr.catch(() => {});
                  } else {
                    el.pause();
                  }
                }}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <IPause /> : <IPlay />}
              </button>
              <button
                className="player-skip"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  claimPlaybackSync();
                  p.next();
                }}
                title="Next"
              >
                <IFastForward />
              </button>
            </div>
          </div>
          {showMobilePlayer ? (
            <div className="mobile-player-overlay" onMouseDown={() => setShowMobilePlayer(false)}>
              <div
                className={`mobile-player-sheet${mobilePlayerIsDragging ? " mobile-player-sheet--dragging" : ""}`}
                ref={mobilePlayerSheetRef}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  className="mobile-player-handle"
                  role="button"
                  tabIndex={0}
                  aria-label="Collapse player"
                  onTouchStart={(e) => {
                    if (!e.touches || e.touches.length !== 1) return;
                    const t = e.touches[0];
                    mobilePlayerDragRef.current.active = true;
                    mobilePlayerDragRef.current.startY = t.clientY;
                    mobilePlayerDragRef.current.dy = 0;
                    setMobilePlayerIsDragging(true);
                  }}
                  onTouchMove={(e) => {
                    if (!mobilePlayerDragRef.current.active) return;
                    if (!e.touches || e.touches.length !== 1) return;
                    const t = e.touches[0];
                    const dy = Math.max(0, t.clientY - mobilePlayerDragRef.current.startY);
                    mobilePlayerDragRef.current.dy = dy;
                    setMobilePlayerTransform(Math.min(dy, 240));
                    if (e.cancelable) e.preventDefault();
                  }}
                  onTouchEnd={(e) => {
                    const dy = mobilePlayerDragRef.current.dy || 0;
                    endMobilePlayerDrag(dy);
                  }}
                  onTouchCancel={() => endMobilePlayerDrag(mobilePlayerDragRef.current.dy || 0)}
                  onClick={(e) => {
                    // Ignore clicks triggered after touch drags.
                    if (mobilePlayerIsDragging) e.preventDefault();
                  }}
                />
                <div className="mobile-player-top">
                  <button className="ghost" type="button" onClick={() => setShowMobilePlayer(false)}>
                    Close
                  </button>
                  <div className="muted">{p.current.album || ""}</div>
                  <button
                    ref={mobileQueueBtnRef}
                    className="ghost"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowQueue((v) => !v);
                    }}
                  >
                    <IQueue />
                  </button>
                </div>
                <div className="mobile-player-cover-wrap">
                  {p.current.coverUrl ? (
                    <img className="mobile-player-cover" src={p.current.coverUrl} alt="" />
                  ) : (
                    <div className="mobile-player-cover placeholder" />
                  )}
                </div>
                <div className="mobile-player-meta">
                  <div className="mobile-player-title">{p.current.title || p.current.label}</div>
                  <div className="muted">{p.current.artist || ""}</div>
                </div>
                <div className="mobile-player-progress">
                  <input
                    className="range mono progress"
                    aria-label="Seek"
                    type="range"
                    min="0"
                    max={Math.max(1, dur || 0)}
                    step="0.25"
                    value={Math.min(curT, Math.max(1, dur || 0))}
                    onChange={(e) => {
                      const el = p.ref.current;
                      if (!el) return;
                      claimPlaybackSync();
                      const v = Number(e.target.value);
                      el.currentTime = v;
                      setCurT(v);
                    }}
                  />
                  <div className="mobile-player-times">
                    <span className="muted">{fmtTime(curT)}</span>
                    <span className="muted">{fmtTime(dur)}</span>
                  </div>
                </div>
                <div className="mobile-player-controls">
                  <button
                    className="player-skip"
                    type="button"
                    onClick={() => {
                      claimPlaybackSync();
                      p.prev();
                    }}
                    title="Previous"
                  >
                    <IRewind />
                  </button>
                  <button
                    className="player-play"
                    type="button"
                    onClick={() => {
                      const el = p.ref.current;
                      if (!el) return;
                      if (el.paused) {
                        claimPlaybackSync();
                        const pr = el.play();
                        if (pr && typeof pr.catch === "function") pr.catch(() => {});
                      } else {
                        el.pause();
                      }
                    }}
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <IPause /> : <IPlay />}
                  </button>
                  <button
                    className="player-skip"
                    type="button"
                    onClick={() => {
                      claimPlaybackSync();
                      p.next();
                    }}
                    title="Next"
                  >
                    <IFastForward />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {getToken() ? (
        <audio
          autoPlay={!!p.current?.url}
          playsInline
          preload="auto"
          ref={(el) => {
            if (typeof p.setAudioEl === "function") p.setAudioEl(el);
            else p.ref.current = el;
          }}
          src={p.current?.url || ""}
          style={{ display: "none" }}
        />
      ) : null}
      {showQueue && p.current && getToken() ? (
        <QueuePopover
          anchorRef={isMobile && showMobilePlayer ? mobileQueueBtnRef : queueBtnRef}
          items={Array.isArray(p.queue) ? p.queue : []}
          currentIndex={typeof p.index === "number" ? p.index : -1}
          onJump={(i) => p.jumpTo(i)}
          onClose={() => setShowQueue(false)}
        />
      ) : null}
      {showPlModal && p.current?.id ? (
        <PlayerPlaylistModal trackId={p.current.id} onClose={() => setShowPlModal(false)} />
      ) : null}
      {showProfile && getToken() ? (
        <ProfileModal
          me={me}
          avatarUrl={avatarUrl}
          bg={bg}
          onBgChange={setBg}
          onClose={() => setShowProfile(false)}
          onAvatarUpdated={async () => {
            try {
              const b = await auth.avatar();
              const url = URL.createObjectURL(b);
              setAvatarUrl((old) => {
                if (old) URL.revokeObjectURL(old);
                return url;
              });
            } catch (_) {}
          }}
          onLogout={() => {
            doLogout();
          }}
        />
      ) : null}
    </>
  );
}

function BackgroundLayer({ bg }) {
  if (!bg || bg.type === "none") return null;
  if (bg.type === "preset" && bg.preset === "lava") {
    return <div className="bg-layer bg-lava" aria-hidden="true" />;
  }
  if (bg.type === "preset" && bg.preset === "grain") {
    return <div className="bg-layer bg-grain" aria-hidden="true" />;
  }
  if (bg.type === "preset" && bg.preset === "grid") {
    return <div className="bg-layer bg-grid" aria-hidden="true" />;
  }
  if (bg.type === "preset" && bg.preset === "waves") {
    return <div className="bg-layer bg-waves" aria-hidden="true" />;
  }
  if (bg.type === "custom" && bg.url) {
    if (typeof bg.mime === "string" && bg.mime.startsWith("video/")) {
      return (
        <div className="bg-layer bg-custom" aria-hidden="true">
          <video className="bg-video" autoPlay loop muted playsInline preload="auto" src={bg.url} />
          <div className="bg-dim" />
        </div>
      );
    }
    return <div className="bg-layer bg-custom" aria-hidden="true" style={{ backgroundImage: `url(${bg.url})` }} />;
  }
  return null;
}

function UserMenu({ anchorRef, name, onClose, onOpenProfile, onLogout }) {
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => {
      const el = anchorRef.current;
      if (el && el.contains(e.target)) return;
      const menuEl = menuRef.current;
      if (menuEl && menuEl.contains(e.target)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const r = anchorRef.current?.getBoundingClientRect?.();
  const width = 240;
  const pad = 8;
  const style = r
    ? {
        position: "fixed",
        top: r.bottom + 8,
        left: Math.min(window.innerWidth - width - pad, Math.max(pad, r.right - width)),
        width,
        background: "#111119",
        border: "1px solid #2a2a33",
        borderRadius: 12,
        padding: 8,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        zIndex: 5000,
      }
    : { display: "none" };

  return createPortal(
    <div ref={menuRef} style={style} role="menu" aria-label="Profile menu">
      <div style={{ padding: "6px 8px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </div>
      <button type="button" className="ghost menu-btn" onClick={onOpenProfile}>
        Profile settings
      </button>
      <button type="button" className="ghost menu-btn" onClick={onLogout}>
        Log out
      </button>
    </div>,
    document.body
  );
}

function ProfileModal({ me, avatarUrl, bg, onBgChange, onClose, onAvatarUpdated, onLogout }) {
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Profile</h3>
          <button className="ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          {avatarUrl ? <img src={avatarUrl} alt="" className="profile-avatar" /> : <div className="profile-avatar placeholder" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>{me?.displayName || me?.username || me?.email || "User"}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {me?.email || ""}
            </div>
            <div style={{ marginTop: 8 }}>
              <label className="ghost" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
                Upload avatar
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setErr("");
                    setBusy(true);
                    try {
                      await auth.uploadAvatar(f);
                      await onAvatarUpdated?.();
                    } catch (x) {
                      setErr(x?.message || "upload failed");
                    }
                    setBusy(false);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>Background</h4>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="bg-presets">
              <button
                type="button"
                className={`bg-preset ${!bg?.type || bg?.type === "none" ? "active" : ""}`}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.clearBackground();
                    onBgChange?.({ type: "none", preset: "", url: "", mime: "" });
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
                disabled={busy}
                title="No background"
              >
                None
              </button>

              <button
                type="button"
                className={`bg-preset ${bg?.type === "preset" && bg?.preset === "lava" ? "active" : ""}`}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.setBackgroundPreset("lava");
                    onBgChange?.({ type: "preset", preset: "lava", url: "", mime: "" });
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
                disabled={busy}
                title="Lava lamp"
              >
                <span className="bg-thumb bg-thumb--lava" aria-hidden="true" />
                Lava
              </button>

              <button
                type="button"
                className={`bg-preset ${bg?.type === "preset" && bg?.preset === "grain" ? "active" : ""}`}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.setBackgroundPreset("grain");
                    onBgChange?.({ type: "preset", preset: "grain", url: "", mime: "" });
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
                disabled={busy}
                title="Dark grain"
              >
                <span className="bg-thumb bg-thumb--grain" aria-hidden="true" />
                Grain
              </button>

              <button
                type="button"
                className={`bg-preset ${bg?.type === "preset" && bg?.preset === "grid" ? "active" : ""}`}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.setBackgroundPreset("grid");
                    onBgChange?.({ type: "preset", preset: "grid", url: "", mime: "" });
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
                disabled={busy}
                title="Neon grid"
              >
                <span className="bg-thumb bg-thumb--grid" aria-hidden="true" />
                Grid
              </button>

              <button
                type="button"
                className={`bg-preset ${bg?.type === "preset" && bg?.preset === "waves" ? "active" : ""}`}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.setBackgroundPreset("waves");
                    onBgChange?.({ type: "preset", preset: "waves", url: "", mime: "" });
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
                disabled={busy}
                title="Subtle waves"
              >
                <span className="bg-thumb bg-thumb--waves" aria-hidden="true" />
                Waves
              </button>

              <label className={`bg-preset ${bg?.type === "custom" ? "active" : ""}`} title="Upload your own">
                <span className="bg-thumb bg-thumb--upload" aria-hidden="true">
                  +
                </span>
                Upload
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setErr("");
                    setBusy(true);
                    try {
                      const res = await auth.uploadBackground(f);
                      onBgChange?.({ type: "custom", preset: "", url: res?.url || "/api/me/background", mime: res?.mime || "" });
                    } catch (x) {
                      setErr(x?.message || "upload failed");
                    }
                    setBusy(false);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              Presets are instant. Upload supports images, GIFs, and short videos.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>Change password</h4>
          <div style={{ display: "grid", gap: 8 }}>
            <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input type="password" placeholder="New password (8+)" value={next} onChange={(e) => setNext(e.target.value)} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={busy || !cur || !next}
                onClick={async () => {
                  setErr("");
                  setBusy(true);
                  try {
                    await auth.changePassword(cur, next);
                    setCur("");
                    setNext("");
                  } catch (x) {
                    setErr(x?.message || "error");
                  }
                  setBusy(false);
                }}
              >
                Save
              </button>
              <button className="ghost" type="button" onClick={onLogout} disabled={busy}>
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QueuePopover({ anchorRef, items, currentIndex, onJump, onClose }) {
  const popRef = React.useRef(null);
  const [box, setBox] = React.useState(null);

  React.useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        setBox(null);
        return;
      }
      const r = anchor.getBoundingClientRect();
      const w = 340;
      const maxH = 300;
      const m = 8;
      const left = Math.min(window.innerWidth - w - m, Math.max(m, r.right - w));
      let top = r.top - maxH - m;
      if (top < m) top = r.bottom + m;
      setBox({ left, top, width: w, maxHeight: maxH });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, items.length, currentIndex]);

  React.useEffect(() => {
    const onDoc = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  if (!box) return null;

  const panel = (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        left: box.left,
        top: box.top,
        width: box.width,
        maxHeight: box.maxHeight,
        overflow: "auto",
        background: "#111119",
        border: "1px solid #2a2a33",
        borderRadius: 12,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        zIndex: 5000,
        padding: 6,
      }}
      role="dialog"
      aria-label="Queue"
    >
      <div style={{ padding: "6px 8px", fontWeight: 800 }}>Queue</div>
      {items.length ? (
        items.map((it, i) => {
          const active = i === currentIndex;
          const title = it.title || it.label || "Track";
          const sub = [it.artist, it.album].filter(Boolean).join(" • ");
          return (
            <button
              key={it.id + ":" + i}
              type="button"
              className="queue-item"
              onClick={() => {
                onJump(i);
                onClose();
              }}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 10px",
                borderRadius: 10,
                background: active ? "rgba(255,255,255,0.08)" : "transparent",
                border: "1px solid transparent",
                color: "var(--text)",
              }}
            >
              <div style={{ fontWeight: 700, opacity: active ? 1 : 0.95 }}>{title}</div>
              {sub ? <div className="muted" style={{ fontSize: 12 }}>{sub}</div> : null}
            </button>
          );
        })
      ) : (
        <div className="muted" style={{ padding: 10 }}>
          Empty queue
        </div>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}

function HomeRedirect() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Library />;
}

export function App() {
  return (
    <Shell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/login"
            element={getToken() ? <Navigate to="/" replace /> : <Login />}
          />
          <Route
            path="/register"
            element={getToken() ? <Navigate to="/" replace /> : <Register />}
          />
          <Route
            path="/album/:id"
            element={!getToken() ? <Navigate to="/login" replace /> : <Album />}
          />
          <Route
            path="/songs"
            element={!getToken() ? <Navigate to="/login" replace /> : <Songs />}
          />
          <Route
            path="/artists"
            element={!getToken() ? <Navigate to="/login" replace /> : <Artists />}
          />
          <Route
            path="/artist/:id"
            element={!getToken() ? <Navigate to="/login" replace /> : <Artist />}
          />
          <Route
            path="/albums"
            element={!getToken() ? <Navigate to="/login" replace /> : <Albums />}
          />
          <Route
            path="/playlists"
            element={!getToken() ? <Navigate to="/login" replace /> : <Playlists />}
          />
          <Route
            path="/playlist/:id"
            element={!getToken() ? <Navigate to="/login" replace /> : <Playlist />}
          />
          <Route
            path="/likes"
            element={!getToken() ? <Navigate to="/login" replace /> : <Likes />}
          />
        </Routes>
      </ErrorBoundary>
    </Shell>
  );
}
