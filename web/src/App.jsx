import React from "react";
import { createPortal } from "react-dom";
import { Routes, Route, Link, NavLink, Navigate, useLocation } from "react-router-dom";
import { I18nContext, I18nProvider, LANGS, normalizeLang, useI18n } from "./i18n";
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
import { Register } from "./pages/Register";

const Library = React.lazy(() => import("./pages/Library").then((m) => ({ default: m.Library })));
const Album = React.lazy(() => import("./pages/Album").then((m) => ({ default: m.Album })));
const Playlists = React.lazy(() => import("./pages/Playlists").then((m) => ({ default: m.Playlists })));
const Likes = React.lazy(() => import("./pages/Likes").then((m) => ({ default: m.Likes })));
const Artists = React.lazy(() => import("./pages/Artists").then((m) => ({ default: m.Artists })));
const Albums = React.lazy(() => import("./pages/Albums").then((m) => ({ default: m.Albums })));
const Artist = React.lazy(() => import("./pages/Artist").then((m) => ({ default: m.Artist })));
const Playlist = React.lazy(() => import("./pages/Playlist").then((m) => ({ default: m.Playlist })));
const Songs = React.lazy(() => import("./pages/Songs").then((m) => ({ default: m.Songs })));
const Genres = React.lazy(() => import("./pages/Genres").then((m) => ({ default: m.Genres })));
const Genre = React.lazy(() => import("./pages/Genre").then((m) => ({ default: m.Genre })));
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

/** Wall-clock estimate of server `positionMs` while `isPlaying` (cross-device takeover). */
function interpolatePlaybackPositionMsFromServer(st) {
  if (!st) return null;
  const base = Math.max(0, Number(st.positionMs) || 0);
  if (!st.isPlaying) return Math.round(base);
  const updatedAt = Date.parse(st.updatedAt || "") || Date.now();
  return Math.round(base + Math.max(0, Date.now() - updatedAt));
}

function seekMediaWhenReady(mediaRef, sec) {
  if (sec == null || !Number.isFinite(sec)) return;
  const el = mediaRef?.current;
  if (!el) return;
  const s = Math.max(0, sec);
  const run = () => {
    try {
      el.currentTime = s;
    } catch (_) {}
  };
  if (el.readyState >= 1) run();
  else el.addEventListener("loadedmetadata", run, { once: true });
}

/** Current 2D rotation in degrees from `transform: matrix(...)` / `rotate(...)`. */
function cssRotationDegFromTransform(transform) {
  if (!transform || transform === "none") return 0;
  if (typeof DOMMatrixReadOnly === "undefined") return 0;
  try {
    const m = new DOMMatrixReadOnly(transform);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  } catch (_) {
    return 0;
  }
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
          <I18nContext.Consumer>
            {({ t }) => (
              <>
                <h2>{t("err.uiCrashed")}</h2>
                <p className="muted">{t("err.openConsole")}</p>
              </>
            )}
          </I18nContext.Consumer>
          <pre style={{ whiteSpace: "pre-wrap", color: "tomato" }}>
            {String(this.state.err?.message || this.state.err)}
          </pre>
          <button className="ghost" type="button" onClick={() => this.setState({ err: null })}>
            <I18nContext.Consumer>{({ t }) => t("err.tryAgain")}</I18nContext.Consumer>
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
  const { t, lang, setLang } = useI18n();
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
  const [mobilePlayerIsClosing, setMobilePlayerIsClosing] = React.useState(false);
  const [mobilePlayerIsPaging, setMobilePlayerIsPaging] = React.useState(false);
  const mobilePlayerSheetRef = React.useRef(null);
  const mobilePlayerPagesRef = React.useRef(null);
  const mobilePlayerDragRef = React.useRef({ active: false, startY: 0, dy: 0 });
  const mobilePlayerGestureRef = React.useRef({
    active: false,
    startX: 0,
    startY: 0,
    startT: 0,
    lastX: 0,
    lastT: 0,
    dx: 0,
    dy: 0,
    mode: "", // "" | "h" | "v"
  });
  const [mobilePlayerPage, setMobilePlayerPage] = React.useState(0); // 0=player, 1=queue
  const mobileMiniSwipeRef = React.useRef({
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    moved: false,
    suppressClick: false,
  });
  const mobileQueueTapRef = React.useRef({ x: 0, y: 0, moved: false });
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 900px)").matches;
  });
  const userBtnRef = React.useRef(null);
  const desktopNowplayingRef = React.useRef(null);
  const [bg, setBg] = React.useState({ type: "none", preset: "", url: "", mime: "" });
  const [remotePlayingNotice, setRemotePlayingNotice] = React.useState("");
  const [remotePlaybackActive, setRemotePlaybackActive] = React.useState(false);
  const remotePlaybackActiveRef = React.useRef(false);
  const remoteProgressBaseMsRef = React.useRef(0);
  const remoteProgressUpdatedAtRef = React.useRef(0);
  const remoteInactiveStreakRef = React.useRef(0);
  /** Last server session we attributed to a remote owner (stable UI vs flaky isPlaying). */
  const remoteOwnerLockRef = React.useRef(null);
  const lastRemotePlayingSeenAtRef = React.useRef(0);
  /** Mirrors server: another client owns playback and is playing (drives progress interpolation). */
  const remoteServerPlayingRef = React.useRef(false);
  /** `timeupdate` fires very often; throttling avoids re-rendering the whole shell every tick. */
  const localProgressUiLastRef = React.useRef(0);
  const mobileScrollRafRef = React.useRef(0);

  const skipAutoplayOnceRef = React.useRef(false);
  const skipPlaybackPushUntilRef = React.useRef(0);
  const restoredPlaybackRef = React.useRef(false);
  /** After first `/api/me/playback` restore attempt finishes — blocks flush from wiping DB before hydrate. */
  const playbackHydratedRef = React.useRef(false);
  const pendingSeekSecRef = React.useRef(null);
  /** Position restore applies only to this track id; avoids seeking new track to old time if user switched before metadata. */
  const pendingSeekTrackIdRef = React.useRef(null);
  const playQueueRef = React.useRef(p.playQueue);
  React.useEffect(() => {
    playQueueRef.current = p.playQueue;
  }, [p.playQueue]);
  const queueRef = React.useRef(p.queue);
  const indexRef = React.useRef(p.index);
  const jumpToRef = React.useRef(p.jumpTo);
  React.useEffect(() => {
    queueRef.current = p.queue;
    indexRef.current = p.index;
    jumpToRef.current = p.jumpTo;
  }, [p.queue, p.index, p.jumpTo]);

  const suspendPlaybackPushRef = React.useRef(false);
  const takeoverRequestedRef = React.useRef(false);
  const takeoverGuardUntilRef = React.useRef(0);
  const ownerEpochRef = React.useRef(0);

  /** Pause local `<audio>` and stop passive `/playback` PUTs — same client must not overwrite remote owner on server. */
  const suspendPlaybackForRemoteSession = React.useCallback(() => {
    suspendPlaybackPushRef.current = true;
    try {
      const el = p.ref.current;
      if (el) el.pause();
    } catch (_) {}
  }, [p.ref]);

  const takeoverRemotePlaybackUI = React.useCallback(() => {
    // Important ordering: block outgoing flush BEFORE pausing, because pause
    // event handler triggers an immediate flush.
    suspendPlaybackForRemoteSession();
    setRemotePlayingNotice(t("player.playingRemote"));
    window.setTimeout(() => setRemotePlayingNotice(""), 9000);
  }, [suspendPlaybackForRemoteSession, t]);

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
    let positionMs = Math.round(Math.max(0, (el?.currentTime || 0) * 1000));
    try {
      const st = await playback.get();
      ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : ownerEpochRef.current;
      const stCid = (st?.clientId && String(st.clientId)) || "";
      if (st?.isPlaying && stCid && cid && stCid !== cid) {
        const fromServer = interpolatePlaybackPositionMsFromServer(st);
        if (fromServer != null && Number.isFinite(fromServer)) positionMs = Math.max(0, fromServer);
      }
    } catch (_) {}
    const body = {
      trackIds: q.map((x) => x.id),
      currentIndex: idx,
      positionMs,
      isPlaying: true,
      clientId: cid,
      ownerEpoch: ownerEpochRef.current,
    };
    try {
      const r = await playback.takeover(body);
      ownerEpochRef.current = Number.isFinite(r?.ownerEpoch) ? Number(r.ownerEpoch) : ownerEpochRef.current + 1;
      takeoverRequestedRef.current = false;
      seekMediaWhenReady(p.ref, positionMs / 1000);
    } catch (_) {}
  }, [p.queue, p.index, p.ref]);

  const claimPlaybackSync = React.useCallback(() => releasePlaybackServerSync(), []);

  /** Disc art uses @keyframes on --disc-rot; CSS cannot smoothly unwind to 0 on hover, so we snapshot matrix → rotate(0). */
  const onDesktopNowplayingDiscEnter = React.useCallback((e) => {
    const el = e.currentTarget?.querySelector?.(".nowplaying-art");
    if (!el || typeof window === "undefined" || typeof window.getComputedStyle !== "function") return;
    let angle = cssRotationDegFromTransform(window.getComputedStyle(el).transform);
    if (!Number.isFinite(angle)) angle = 0;
    el.dataset.discHoverUnwind = "1";
    el.style.animation = "none";
    el.style.transform = `rotate(${angle}deg)`;
    void el.offsetHeight;
    el.style.transition = "transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (el.dataset.discHoverUnwind !== "1") return;
        el.style.transform = "rotate(0deg)";
      });
    });
  }, []);

  const onDesktopNowplayingDiscLeave = React.useCallback((e) => {
    const el = e.currentTarget?.querySelector?.(".nowplaying-art");
    if (!el) return;
    delete el.dataset.discHoverUnwind;
    el.style.animation = "";
    el.style.transform = "";
    el.style.transition = "";
  }, []);

  React.useEffect(() => {
    const wrap = desktopNowplayingRef.current;
    const el = wrap?.querySelector?.(".nowplaying-art");
    if (!el) return;
    delete el.dataset.discHoverUnwind;
    el.style.animation = "";
    el.style.transform = "";
    el.style.transition = "";
  }, [p.current?.id]);

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
    pendingSeekSecRef.current = null;
    pendingSeekTrackIdRef.current = null;
    suspendPlaybackPushRef.current = false;
    takeoverRequestedRef.current = false;
    takeoverGuardUntilRef.current = 0;
    ownerEpochRef.current = 0;
    remoteOwnerLockRef.current = null;
    lastRemotePlayingSeenAtRef.current = 0;
    remoteServerPlayingRef.current = false;
    remoteInactiveStreakRef.current = 0;
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
        // After refresh/reload we restore queue + position but DO NOT auto-play.
        // iOS Safari + UX: user should explicitly resume.
        skipAutoplayOnceRef.current = true;
        pendingSeekTrackIdRef.current = tracks[newIdx]?.id ?? null;
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
      remoteInactiveStreakRef.current = 0;
      remoteOwnerLockRef.current = null;
      lastRemotePlayingSeenAtRef.current = 0;
      remoteServerPlayingRef.current = false;
      // Do not PUT immediately after POST /takeover: local `<audio>` is still paused here, and a heartbeat
      // would send isPlaying:false and mute server state the user is about to resume.
      try {
        void pushTakeoverNow();
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
        const e = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : 0;
        remoteOwnerLockRef.current = { epoch: e, clientId: st.clientId };
        lastRemotePlayingSeenAtRef.current = Date.now();
        remoteServerPlayingRef.current = true;
        if (!remotePlaybackActiveRef.current) {
          remotePlaybackActiveRef.current = true;
          setRemotePlaybackActive(true);
        }
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
      remoteInactiveStreakRef.current = 0;
      remoteOwnerLockRef.current = null;
      lastRemotePlayingSeenAtRef.current = 0;
      remoteServerPlayingRef.current = false;
      suspendPlaybackPushRef.current = false;
      return;
    }
    const REMOTE_UI_INACTIVE_GRACE_MS = 1100;
    const syncRemote = async () => {
      try {
        const st = await playback.get();
        ownerEpochRef.current = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : ownerEpochRef.current;
        const mine = getPlaybackClientId();
        const stEpoch = Number.isFinite(st?.ownerEpoch) ? Number(st.ownerEpoch) : 0;
        const stCid = (st?.clientId && String(st.clientId)) || "";
        const activeRemote = !!(st?.isPlaying && stCid && mine && stCid !== mine);

        remoteProgressBaseMsRef.current = Math.max(0, Number(st.positionMs) || 0);
        remoteProgressUpdatedAtRef.current = Date.parse(st.updatedAt || "") || Date.now();
        remoteServerPlayingRef.current = !!(stCid && mine && stCid !== mine && st?.isPlaying);

        if (mine && stCid && stCid === mine) {
          remoteOwnerLockRef.current = null;
          lastRemotePlayingSeenAtRef.current = 0;
          remoteInactiveStreakRef.current = 0;
          suspendPlaybackPushRef.current = false;
          if (remotePlaybackActiveRef.current) {
            remotePlaybackActiveRef.current = false;
            setRemotePlaybackActive(false);
          }
          return;
        }

        if (activeRemote) {
          remoteOwnerLockRef.current = { epoch: stEpoch, clientId: stCid };
          lastRemotePlayingSeenAtRef.current = Date.now();
          remoteInactiveStreakRef.current = 0;
          suspendPlaybackForRemoteSession();
          if (!remotePlaybackActiveRef.current) {
            remotePlaybackActiveRef.current = true;
            setRemotePlaybackActive(true);
          }
        } else {
          const lock = remoteOwnerLockRef.current;
          const sameLock = !!(lock && stEpoch === lock.epoch && stCid && lock.clientId && stCid === lock.clientId);
          const withinGrace = Date.now() - lastRemotePlayingSeenAtRef.current < REMOTE_UI_INACTIVE_GRACE_MS;
          if (sameLock && withinGrace) {
            // Ignore brief gaps in isPlaying / network while session identity matches.
          } else {
            remoteInactiveStreakRef.current += 1;
            if (remoteInactiveStreakRef.current >= 3) {
              remotePlaybackActiveRef.current = false;
              setRemotePlaybackActive(false);
              remoteOwnerLockRef.current = null;
              lastRemotePlayingSeenAtRef.current = 0;
              suspendPlaybackPushRef.current = false;
            }
          }
        }

        if (!activeRemote || !Array.isArray(st?.trackIds) || !st.trackIds.length) return;
        const remoteTrackId = st.trackIds[st.currentIndex];
        if (!remoteTrackId) return;
        const q = Array.isArray(queueRef.current) ? queueRef.current : [];
        const remoteIdx = q.findIndex((x) => x?.id === remoteTrackId);
        if (remoteIdx >= 0 && remoteIdx !== indexRef.current) {
          skipAutoplayOnceRef.current = true;
          jumpToRef.current(remoteIdx);
        }
      } catch (_) {}
    };
    const id = window.setInterval(syncRemote, 1000);
    syncRemote();
    return () => clearInterval(id);
  }, [p.current?.id, suspendPlaybackForRemoteSession]);

  React.useEffect(() => {
    if (!remotePlaybackActive) return;
    const tick = () => {
      const baseMs = remoteProgressBaseMsRef.current;
      const updatedAt = remoteProgressUpdatedAtRef.current || Date.now();
      if (!remoteServerPlayingRef.current) {
        setCurT(Math.max(0, baseMs / 1000));
        return;
      }
      const nextSec = Math.max(0, (baseMs + Math.max(0, Date.now() - updatedAt)) / 1000);
      setCurT(nextSec);
    };
    tick();
    const id = window.setInterval(tick, 500);
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

  // Sync UI language from server profile (one-way) after auth.
  React.useEffect(() => {
    const serverLang = normalizeLang(me?.uiLang);
    if (!getToken() || !serverLang) return;
    if (serverLang !== normalizeLang(lang)) {
      setLang(serverLang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.uiLang, !!getToken()]);

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
      if (mobileScrollRafRef.current) return;
      mobileScrollRafRef.current = window.requestAnimationFrame(() => {
        mobileScrollRafRef.current = 0;
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
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (mobileScrollRafRef.current) {
        window.cancelAnimationFrame(mobileScrollRafRef.current);
        mobileScrollRafRef.current = 0;
      }
    };
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

  const setMobilePagesTransformPx = React.useCallback((xPx) => {
    const el = mobilePlayerPagesRef.current;
    if (!el) return;
    el.style.transform = `translateX(${xPx}px)`;
  }, []);

  const clearMobilePagesInlineTransform = React.useCallback(() => {
    const el = mobilePlayerPagesRef.current;
    if (!el) return;
    el.style.transform = "";
  }, []);

  const getMobilePagesStepPx = React.useCallback(() => {
    // Pages are exactly 1 screen wide each. Visual "gap" is done via inner padding.
    return mobilePlayerSheetRef.current?.getBoundingClientRect?.().width || window.innerWidth;
  }, []);

  React.useEffect(() => {
    if (!showMobilePlayer) return;
    const step = getMobilePagesStepPx();
    setMobilePagesTransformPx(-mobilePlayerPage * step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMobilePlayer, mobilePlayerPage]);

  const endMobilePlayerDrag = React.useCallback(
    (finalDyPx) => {
      const dy = Math.max(0, Number.isFinite(finalDyPx) ? finalDyPx : 0);
      const threshold = Math.max(100, Math.round(window.innerHeight * 0.18));
      setMobilePlayerIsDragging(false);
      mobilePlayerDragRef.current.active = false;
      mobilePlayerDragRef.current.dy = 0;
      if (dy > threshold) {
        setMobilePlayerIsClosing(true);
        setMobilePlayerTransform(window.innerHeight);
        window.setTimeout(() => {
          setMobilePlayerIsClosing(false);
          setMobilePlayerPage(0);
          setShowMobilePlayer(false);
          setMobilePlayerTransform(0);
        }, 180);
      } else setMobilePlayerTransform(0);
    },
    [setMobilePlayerTransform]
  );

  React.useEffect(() => {
    if (!mobilePlayerIsDragging) return undefined;
    // Prevent iOS from scrolling the page underneath while dragging.
    const onTouchMove = (e) => {
      if (!mobilePlayerDragRef.current.active) return;
      try {
        e.preventDefault();
      } catch (_) {}
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", onTouchMove);
  }, [mobilePlayerIsDragging]);

  React.useEffect(() => {
    if (!mobilePlayerIsClosing) return undefined;
    // Disable background scroll during closing animation.
    const onTouchMove = (e) => {
      if (!mobilePlayerIsClosing) return;
      try {
        e.preventDefault();
      } catch (_) {}
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", onTouchMove);
  }, [mobilePlayerIsClosing]);

  React.useEffect(() => {
    if (!showMobilePlayer) return undefined;
    // Block background scroll while the fullscreen player is open.
    const prevOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const onTouchMove = (e) => {
      // Allow scrolling inside the queue list if user is on that page.
      const t = e.target;
      const inQueueScroll = t && typeof t.closest === "function" && t.closest(".mobile-queue-page-list");
      if (inQueueScroll) return;
      if (e.cancelable) e.preventDefault();
    };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      document.documentElement.style.overflow = prevOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [showMobilePlayer]);

  React.useEffect(() => {
    const el = p.ref.current;
    if (!el) return;
    localProgressUiLastRef.current = 0;

    const onPause = () => {
      try {
        flushPlaybackRef.current();
      } catch (_) {}
    };
    const onTime = () => {
      // When remote playback is active, we drive progress from server-updated base+updatedAt.
      // Prevent audio timeupdate events from fighting and causing UI "jitter".
      if (remotePlaybackActiveRef.current) return;
      const t = el.currentTime || 0;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - localProgressUiLastRef.current < 220) return;
      localProgressUiLastRef.current = now;
      setCurT(t);
    };
    const onMeta = () => setDur(el.duration || 0);
    const onError = async () => {
      // Don't auto-skip: browsers can mark the media as ended after a failed load.
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

    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    // initial
    onMeta();
    onTime();
    setPlayErr("");

    return () => {
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
    const seekForId = pendingSeekTrackIdRef.current;
    if (seekForId != null && seekForId !== p.current.id) {
      pendingSeekSecRef.current = null;
      pendingSeekTrackIdRef.current = null;
      return;
    }
    const apply = () => {
      try {
        el.currentTime = Math.max(0, sec);
      } catch (_) {}
      pendingSeekSecRef.current = null;
      pendingSeekTrackIdRef.current = null;
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
      ms.playbackState = p.isPlaying ? "playing" : "paused";
    } catch (_) {}

    return () => {
      // Avoid keeping stale handlers when logging out / switching tracks.
      try { ms.setActionHandler("play", null); } catch (_) {}
      try { ms.setActionHandler("pause", null); } catch (_) {}
      try { ms.setActionHandler("nexttrack", null); } catch (_) {}
      try { ms.setActionHandler("previoustrack", null); } catch (_) {}
      try { ms.setActionHandler("seekto", null); } catch (_) {}
    };
  }, [p.current?.id, p.current?.coverUrl, p.current?.title, p.current?.label, p.current?.artist, p.current?.album, p.isPlaying, dur]);

  // Lock-screen position: low frequency so we don’t couple Media Session updates to every progress tick.
  React.useEffect(() => {
    if (!getToken()) return;
    if (typeof navigator === "undefined") return;
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState) return;
    if (!Number.isFinite(dur) || dur <= 0) return;

    const readPositionSec = () => {
      if (remotePlaybackActiveRef.current) {
        const baseMs = remoteProgressBaseMsRef.current;
        const updatedAt = remoteProgressUpdatedAtRef.current || Date.now();
        if (!remoteServerPlayingRef.current) {
          return Math.max(0, baseMs / 1000);
        }
        return Math.max(0, (baseMs + Math.max(0, Date.now() - updatedAt)) / 1000);
      }
      const el = p.ref.current;
      return el ? Math.max(0, el.currentTime || 0) : 0;
    };

    const push = () => {
      try {
        ms.setPositionState({
          duration: dur,
          playbackRate: 1,
          position: Math.max(0, Math.min(dur, readPositionSec())),
        });
      } catch (_) {}
    };

    if (!p.isPlaying) {
      push();
      return undefined;
    }
    push();
    const id = window.setInterval(push, 3000);
    return () => clearInterval(id);
  }, [p.current?.id, p.isPlaying, dur, p.ref]);

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
              aria-label={t("menu.toggleNav")}
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
                title={t("menu.profile")}
                aria-label={t("menu.profile")}
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
              <NavLink to="/" end onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.home")}</NavLink>
              <NavLink to="/songs" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.songs")}</NavLink>
              <NavLink to="/artists" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.artists")}</NavLink>
              <NavLink to="/albums" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.albums")}</NavLink>
              <NavLink to="/genres" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.genres")}</NavLink>
              <NavLink to="/playlists" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.playlists")}</NavLink>
              <NavLink to="/likes" onClick={() => setMobileNavOpen(false)} className={({ isActive }) => (isActive ? "is-active" : "")}>{t("nav.likes")}</NavLink>
            </nav>
          </aside>
        ) : null}
        <main className="main">
          {getToken() ? <GlobalSearch /> : null}
          {children}
        </main>
      </div>
      {p.current && getToken() && !isMobile ? (
        <div className={"player" + (p.isPlaying ? " player--playing" : "")}>
          <button
            className="player-skip"
            type="button"
            onClick={() => {
              claimPlaybackSync();
              p.prev();
            }}
            title={t("player.rewind")}
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
                    try {
                      el.pause();
                    } catch (_) {}
                    setPlayErr("Playback blocked or failed.");
                  });
                }
              }
              else el.pause();
            }}
            title={p.isPlaying ? t("player.pause") : t("player.play")}
          >
            {p.isPlaying ? <IPause /> : <IPlay />}
          </button>

          <button
            className="player-skip"
            type="button"
            onClick={() => {
              claimPlaybackSync();
              p.next();
            }}
            title={t("player.fastForward")}
          >
            <IFastForward />
          </button>

          <button
            className="player-skip"
            type="button"
            onClick={p.toggleMute}
            title={p.muted ? t("player.unmute") : t("player.mute")}
          >
            {p.muted ? <ISpeakerOff /> : <ISpeaker />}
          </button>

          <input
            className="range mono vol"
            aria-label={t("player.volume")}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
          />

          <div
            ref={desktopNowplayingRef}
            className="nowplaying"
            onMouseEnter={onDesktopNowplayingDiscEnter}
            onMouseLeave={onDesktopNowplayingDiscLeave}
          >
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
            className={"player-icon-btn" + (liked ? " is-liked" : "")}
            type="button"
            title={liked ? t("player.unlike") : t("player.like")}
            onClick={async () => {
              try {
                if (!p.current?.id) return;
                if (liked) await lib.unlike(p.current.id);
                else await lib.like(p.current.id);
                setLiked(!liked);
              } catch (_) {}
            }}
          >
            <IHeart />
          </button>

          <button className="player-icon-btn" type="button" title={t("player.addToPlaylist")} onClick={() => setShowPlModal(true)}>
            <IPlus />
          </button>

          <div className="player-remote-slot" aria-hidden={!remotePlaybackActive}>
            {remotePlaybackActive ? (
              <span className="player-remote-indicator" title={t("player.playingOnAnotherDevice")} aria-label={t("player.playingOnAnotherDevice")}>
                <IRemoteDevice />
              </span>
            ) : null}
          </div>

          <div className="muted" style={{ minWidth: 64, textAlign: "right" }}>
            {fmtTime(curT)}
          </div>

          <div className="player-progress-wrap">
            <input
              className="range mono progress"
              aria-label={t("player.seek")}
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
            title={t("player.queue")}
            aria-label={t("player.queue")}
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
          <div
            className="player player--mobile-mini"
            onClick={() => {
              if (mobileMiniSwipeRef.current.suppressClick) {
                mobileMiniSwipeRef.current.suppressClick = false;
                return;
              }
              setMobilePlayerPage(0);
              setShowMobilePlayer(true);
            }}
            onTouchStart={(e) => {
              const t = e.touches?.[0];
              if (!t) return;
              mobileMiniSwipeRef.current.startX = t.clientX;
              mobileMiniSwipeRef.current.startY = t.clientY;
              mobileMiniSwipeRef.current.dx = 0;
              mobileMiniSwipeRef.current.dy = 0;
              mobileMiniSwipeRef.current.moved = false;
              mobileMiniSwipeRef.current.suppressClick = false;
            }}
            onTouchMove={(e) => {
              const t = e.touches?.[0];
              if (!t) return;
              const dx = t.clientX - mobileMiniSwipeRef.current.startX;
              const dy = t.clientY - mobileMiniSwipeRef.current.startY;
              mobileMiniSwipeRef.current.dx = dx;
              mobileMiniSwipeRef.current.dy = dy;
              if (Math.abs(dx) > 10 || Math.abs(dy) > 10) mobileMiniSwipeRef.current.moved = true;
            }}
            onTouchEnd={() => {
              const dx = mobileMiniSwipeRef.current.dx;
              const dy = mobileMiniSwipeRef.current.dy;
              const moved = mobileMiniSwipeRef.current.moved;
              if (!moved) return;
              // Swipe right-to-left (dx < 0) opens queue page.
              if (dx < -70 && Math.abs(dx) > Math.abs(dy) + 20) {
                setMobilePlayerPage(1);
                setShowMobilePlayer(true);
                mobileMiniSwipeRef.current.suppressClick = true;
                window.setTimeout(() => {
                  mobileMiniSwipeRef.current.suppressClick = false;
                }, 280);
              }
            }}
          >
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
              <div className="player-remote-slot player-remote-slot--mini" aria-hidden={!remotePlaybackActive}>
                {remotePlaybackActive ? (
                  <span className="player-remote-indicator player-remote-indicator--mini" title={t("player.playingOnAnotherDevice")} aria-label={t("player.playingOnAnotherDevice")}>
                    <IRemoteDevice />
                  </span>
                ) : null}
              </div>
              <button
                className="player-skip"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  claimPlaybackSync();
                  p.prev();
                }}
                title={t("player.prev")}
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
                title={p.isPlaying ? "Pause" : "Play"}
              >
                {p.isPlaying ? <IPause /> : <IPlay />}
              </button>
              <button
                className="player-skip"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  claimPlaybackSync();
                  p.next();
                }}
                title={t("player.next")}
              >
                <IFastForward />
              </button>
            </div>
          </div>
          {showMobilePlayer ? (
            <div
              className="mobile-player-overlay"
              onMouseDown={(e) => {
                if (e.target !== e.currentTarget) return;
                // Close with animation (avoid abrupt unmount).
                setMobilePlayerIsClosing(true);
                setMobilePlayerPage(0);
                setMobilePlayerTransform(window.innerHeight);
                window.setTimeout(() => {
                  setMobilePlayerIsClosing(false);
                  setShowMobilePlayer(false);
                  setMobilePlayerTransform(0);
                }, 180);
              }}
              onTouchStart={(e) => {
                if (e.target !== e.currentTarget) return;
                setMobilePlayerIsClosing(true);
                setMobilePlayerPage(0);
                setMobilePlayerTransform(window.innerHeight);
                window.setTimeout(() => {
                  setMobilePlayerIsClosing(false);
                  setShowMobilePlayer(false);
                  setMobilePlayerTransform(0);
                }, 180);
              }}
            >
              <div
                className={`mobile-player-sheet${
                  mobilePlayerIsDragging ? " mobile-player-sheet--dragging" : ""
                }${mobilePlayerIsPaging ? " mobile-player-sheet--paging" : ""}${mobilePlayerIsClosing ? " mobile-player-sheet--closing" : ""}${mobilePlayerPage === 1 ? " mobile-player-sheet--queuepage" : ""}`}
                ref={mobilePlayerSheetRef}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <div
                  className="mobile-player-drag-zone"
                  aria-hidden="true"
                  onTouchStart={(e) => {
                    if (!e.touches || e.touches.length !== 1) return;
                    const t = e.touches[0];
                    mobilePlayerGestureRef.current.active = true;
                    mobilePlayerGestureRef.current.startX = t.clientX;
                    mobilePlayerGestureRef.current.startY = t.clientY;
                    mobilePlayerGestureRef.current.startT = Date.now();
                    mobilePlayerGestureRef.current.lastX = t.clientX;
                    mobilePlayerGestureRef.current.lastT = Date.now();
                    mobilePlayerGestureRef.current.dx = 0;
                    mobilePlayerGestureRef.current.dy = 0;
                    mobilePlayerGestureRef.current.mode = "";
                    mobilePlayerDragRef.current.active = true;
                    mobilePlayerDragRef.current.startY = t.clientY;
                    mobilePlayerDragRef.current.dy = 0;
                    setMobilePlayerIsDragging(true);
                    setMobilePlayerIsPaging(false);
                  }}
                  onTouchMove={(e) => {
                    if (!mobilePlayerGestureRef.current.active) return;
                    if (!e.touches || e.touches.length !== 1) return;
                    const t = e.touches[0];
                    const dx = t.clientX - mobilePlayerGestureRef.current.startX;
                    const dy = t.clientY - mobilePlayerGestureRef.current.startY;
                    mobilePlayerGestureRef.current.dx = dx;
                    mobilePlayerGestureRef.current.dy = dy;
                    mobilePlayerGestureRef.current.lastX = t.clientX;
                    mobilePlayerGestureRef.current.lastT = Date.now();

                    // Decide gesture direction once.
                    if (!mobilePlayerGestureRef.current.mode) {
                      if (Math.abs(dx) > Math.abs(dy) + 6 && Math.abs(dx) > 10) {
                        mobilePlayerGestureRef.current.mode = "h";
                      } else if (dy > 10 && Math.abs(dy) > Math.abs(dx) + 6) {
                        mobilePlayerGestureRef.current.mode = "v";
                      }
                    }

                    // Horizontal: iOS-style paging (follow finger + snap).
                    if (mobilePlayerGestureRef.current.mode === "h") {
                      setMobilePlayerIsDragging(false);
                      setMobilePlayerIsPaging(true);
                      // keep gesture active; disable vertical drag bookkeeping only
                      mobilePlayerDragRef.current.active = false;
                      mobilePlayerDragRef.current.dy = 0;
                      setMobilePlayerTransform(0);
                      const w = mobilePlayerSheetRef.current?.getBoundingClientRect?.().width || window.innerWidth;
                      const step = getMobilePagesStepPx();
                      const baseX = -mobilePlayerPage * step;
                      const off = Math.max(-w, Math.min(w, dx));
                      // Clamp within [0..-step]
                      const nextX = Math.max(-step, Math.min(0, baseX + off));
                      setMobilePagesTransformPx(nextX);
                      if (e.cancelable) e.preventDefault();
                      return;
                    }

                    // Vertical: drag down to collapse.
                    if (mobilePlayerGestureRef.current.mode === "v") {
                      setMobilePlayerIsPaging(false);
                      const ddy = Math.max(0, t.clientY - mobilePlayerDragRef.current.startY);
                      mobilePlayerDragRef.current.dy = ddy;
                      setMobilePlayerTransform(Math.min(ddy, 260));
                      if (e.cancelable) e.preventDefault();
                    }
                  }}
                  onTouchEnd={() => {
                    const mode = mobilePlayerGestureRef.current.mode;
                    mobilePlayerGestureRef.current.active = false;
                    if (mode === "h") {
                      const step = getMobilePagesStepPx();
                      const w = mobilePlayerSheetRef.current?.getBoundingClientRect?.().width || window.innerWidth;
                      const dx = mobilePlayerGestureRef.current.dx;
                      const dt = Math.max(1, Date.now() - (mobilePlayerGestureRef.current.startT || Date.now()));
                      const vx = dx / dt; // px/ms
                      let target = mobilePlayerPage;
                      const thresh = w * 0.22;
                      if (dx < -thresh || vx < -0.65) target = 1;
                      else if (dx > thresh || vx > 0.65) target = 0;
                      setMobilePlayerPage(target);
                      clearMobilePagesInlineTransform();
                      setMobilePlayerIsPaging(false);
                      return;
                    }
                    if (mode === "v") {
                      const dy = mobilePlayerDragRef.current.dy || 0;
                      endMobilePlayerDrag(dy);
                      return;
                    }
                    // Non-vertical gestures: reset.
                    setMobilePlayerIsDragging(false);
                    setMobilePlayerIsPaging(false);
                    mobilePlayerDragRef.current.active = false;
                    mobilePlayerDragRef.current.dy = 0;
                    setMobilePlayerTransform(0);
                  }}
                  onTouchCancel={() => {
                    const mode = mobilePlayerGestureRef.current.mode;
                    mobilePlayerGestureRef.current.active = false;
                    if (mode === "h") {
                      const w = mobilePlayerSheetRef.current?.getBoundingClientRect?.().width || window.innerWidth;
                      const dx = mobilePlayerGestureRef.current.dx;
                      const dt = Math.max(1, Date.now() - (mobilePlayerGestureRef.current.startT || Date.now()));
                      const vx = dx / dt;
                      let target = mobilePlayerPage;
                      const thresh = w * 0.22;
                      if (dx < -thresh || vx < -0.65) target = 1;
                      else if (dx > thresh || vx > 0.65) target = 0;
                      setMobilePlayerPage(target);
                      clearMobilePagesInlineTransform();
                      setMobilePlayerIsPaging(false);
                      return;
                    }
                    endMobilePlayerDrag(mobilePlayerDragRef.current.dy || 0);
                  }}
                >
                  <div className="mobile-player-handle" />
                </div>
                <div
                  className="mobile-player-pages"
                  ref={mobilePlayerPagesRef}
                  // transform is driven in px (step = width + gap) for exact alignment
                  style={undefined}
                >
                  <section className="mobile-player-page mobile-player-page--main" aria-label="Player">
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
                        aria-label={t("player.seek")}
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
                        title={t("player.prev")}
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
                        title={p.isPlaying ? t("player.pause") : t("player.play")}
                      >
                        {p.isPlaying ? <IPause /> : <IPlay />}
                      </button>
                      <button
                        className="player-skip"
                        type="button"
                        onClick={() => {
                          claimPlaybackSync();
                          p.next();
                        }}
                        title={t("player.next")}
                      >
                        <IFastForward />
                      </button>
                    </div>
                  </section>

                  <section className="mobile-player-page mobile-player-page--queue" aria-label="Queue">
                    <div className="mobile-queue-page-head">{t("player.upNext")}</div>
                    <div
                      className="mobile-queue-page-list"
                      onTouchStart={(e) => {
                        const t = e.touches?.[0];
                        if (!t) return;
                        mobileQueueTapRef.current.x = t.clientX;
                        mobileQueueTapRef.current.y = t.clientY;
                        mobileQueueTapRef.current.moved = false;
                      }}
                      onTouchMove={(e) => {
                        const t = e.touches?.[0];
                        if (!t) return;
                        const dx = t.clientX - mobileQueueTapRef.current.x;
                        const dy = t.clientY - mobileQueueTapRef.current.y;
                        // Horizontal swipe on queue page: go back to main.
                        if (dx > 14 && Math.abs(dx) > Math.abs(dy) + 10) {
                          mobileQueueTapRef.current.moved = true;
                          if (e.cancelable) e.preventDefault();
                        }
                      }}
                      onTouchEnd={(e) => {
                        // If user swiped right, return to main page.
                        if (!mobileQueueTapRef.current.moved) return;
                        const changed = e.changedTouches?.[0];
                        if (!changed) return;
                        const dx = changed.clientX - mobileQueueTapRef.current.x;
                        const dy = changed.clientY - mobileQueueTapRef.current.y;
                        if (dx > 70 && Math.abs(dx) > Math.abs(dy) + 20) {
                          setMobilePlayerPage(0);
                        }
                      }}
                    >
                      {(() => {
                        const q = Array.isArray(p.queue) ? p.queue : [];
                        const start = typeof p.index === "number" && p.index >= 0 ? p.index : 0;
                        const view = q.slice(start);
                        if (!view.length) return <div className="muted" style={{ padding: 10 }}>{t("player.emptyQueue")}</div>;
                        return view.map((it, i) => {
                          const actualIdx = start + i;
                          const active = actualIdx === p.index;
                          const title = it.title || it.label || t("common.track");
                          const sub = [it.artist, it.album].filter(Boolean).join(" • ");
                          return (
                            <button
                              key={it.id + ":" + actualIdx}
                              type="button"
                              className="mobile-queue-item"
                              style={{ background: active ? "rgba(255,255,255,0.08)" : "transparent" }}
                              onTouchStart={(e) => {
                                const t = e.touches?.[0];
                                if (!t) return;
                                mobileQueueTapRef.current.x = t.clientX;
                                mobileQueueTapRef.current.y = t.clientY;
                                mobileQueueTapRef.current.moved = false;
                              }}
                              onTouchMove={(e) => {
                                const t = e.touches?.[0];
                                if (!t) return;
                                const dx = Math.abs(t.clientX - mobileQueueTapRef.current.x);
                                const dy = Math.abs(t.clientY - mobileQueueTapRef.current.y);
                                if (dx > 10 || dy > 10) mobileQueueTapRef.current.moved = true;
                              }}
                              onTouchEnd={(e) => {
                                if (mobileQueueTapRef.current.moved) return;
                                if (e.cancelable) e.preventDefault();
                                e.stopPropagation();
                                claimPlaybackSync();
                                p.jumpTo(actualIdx);
                                try {
                                  const el = p.ref.current;
                                  if (el && it?.url) {
                                    if (el.src !== it.url) el.src = it.url;
                                    const pr = el.play?.();
                                    if (pr && typeof pr.catch === "function") pr.catch(() => {});
                                  }
                                } catch (_) {}
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                claimPlaybackSync();
                                p.jumpTo(actualIdx);
                                try {
                                  const el = p.ref.current;
                                  if (el && it?.url) {
                                    if (el.src !== it.url) el.src = it.url;
                                    const pr = el.play?.();
                                    if (pr && typeof pr.catch === "function") pr.catch(() => {});
                                  }
                                } catch (_) {}
                              }}
                            >
                              <div className="mobile-queue-item-title">{title}</div>
                              {sub ? <div className="mobile-queue-item-sub muted">{sub}</div> : null}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </section>
                </div>

                <div className="mobile-player-tabs" role="tablist" aria-label="Player screens">
                  <button
                    type="button"
                    className={`mobile-player-tab-dot${mobilePlayerPage === 0 ? " is-active" : ""}`}
                    aria-label="Main"
                    role="tab"
                    aria-selected={mobilePlayerPage === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobilePlayerPage(0);
                    }}
                  />
                  <button
                    type="button"
                    className={`mobile-player-tab-dot${mobilePlayerPage === 1 ? " is-active" : ""}`}
                    aria-label="Queue"
                    role="tab"
                    aria-selected={mobilePlayerPage === 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobilePlayerPage(1);
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {getToken() ? (
        <audio
          autoPlay={false}
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
          historyUX={!isMobile}
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
          lang={lang}
          onLangChange={async (nextLang) => {
            const l = normalizeLang(nextLang);
            setLang(l);
            try {
              await auth.setUILang(l);
              setMe((prev) => (prev ? { ...prev, uiLang: l } : prev));
            } catch (_) {}
          }}
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
    // Legacy: saved video backgrounds are no longer supported.
    if (typeof bg.mime === "string" && bg.mime.startsWith("video/")) {
      return null;
    }
    return <div className="bg-layer bg-custom" aria-hidden="true" style={{ backgroundImage: `url(${bg.url})` }} />;
  }
  return null;
}

function UserMenu({ anchorRef, name, onClose, onOpenProfile, onLogout }) {
  const { t } = useI18n();
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
        {t("menu.profileSettings")}
      </button>
      <button type="button" className="ghost menu-btn" onClick={onLogout}>
        {t("menu.logout")}
      </button>
    </div>,
    document.body
  );
}

function ProfileModal({ me, avatarUrl, bg, lang, onLangChange, onBgChange, onClose, onAvatarUpdated, onLogout }) {
  const { t } = useI18n();
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>{t("profile.title")}</h3>
          <button className="ghost" type="button" onClick={onClose}>
            {t("profile.close")}
          </button>
        </div>

        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          {avatarUrl ? <img src={avatarUrl} alt="" className="profile-avatar" /> : <div className="profile-avatar placeholder" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>{me?.displayName || me?.username || me?.email || t("common.user")}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {me?.email || ""}
            </div>
            <div style={{ marginTop: 8 }}>
              <label className="ghost" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
                {t("profile.uploadAvatar")}
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
          <h4 style={{ margin: "0 0 8px" }}>{t("profile.language")}</h4>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select
              className="lang-select"
              value={normalizeLang(lang)}
              disabled={busy}
              onChange={(e) => onLangChange?.(e.target.value)}
              aria-label={t("profile.language")}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("profile.background")}</h4>
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
                title={t("profile.bg.none")}
              >
                {t("profile.bg.none")}
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
                title={t("profile.bg.lava")}
              >
                <span className="bg-thumb bg-thumb--lava" aria-hidden="true" />
                {t("profile.bg.lava")}
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
                title={t("profile.bg.grain")}
              >
                <span className="bg-thumb bg-thumb--grain" aria-hidden="true" />
                {t("profile.bg.grain")}
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
                title={t("profile.bg.grid")}
              >
                <span className="bg-thumb bg-thumb--grid" aria-hidden="true" />
                {t("profile.bg.grid")}
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
                title={t("profile.bg.waves")}
              >
                <span className="bg-thumb bg-thumb--waves" aria-hidden="true" />
                {t("profile.bg.waves")}
              </button>

              <label className={`bg-preset ${bg?.type === "custom" ? "active" : ""}`} title={t("profile.bg.upload")}>
                <span className="bg-thumb bg-thumb--upload" aria-hidden="true">
                  +
                </span>
                {t("profile.bg.upload")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
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
              {t("profile.bg.hint")}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>{t("profile.password.title")}</h4>
          <div style={{ display: "grid", gap: 8 }}>
            <input type="password" placeholder={t("profile.password.current")} value={cur} onChange={(e) => setCur(e.target.value)} />
            <input type="password" placeholder={t("profile.password.new")} value={next} onChange={(e) => setNext(e.target.value)} />
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
                {t("profile.save")}
              </button>
              <button className="ghost" type="button" onClick={onLogout} disabled={busy}>
                {t("menu.logout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vertical offset from top of scrolling box content to top of `row` (via offsetParent chain; bbox fallback inside fixed popovers). */
function scrollContentYOffset(scroller, row) {
  if (!scroller || !row || !scroller.contains(row)) return 0;
  let y = 0;
  let el = row;
  while (el && el !== scroller) {
    y += el.offsetTop;
    const next = el.offsetParent;
    if (!next || !scroller.contains(next)) break;
    el = next;
  }
  if (el !== scroller) {
    return scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
  return y;
}

/** Adjust only `scroller.scrollTop` — never scrollIntoView (it climbs ancestor scroll containers). */
function scrollPopoverListToCenterRow(scroller, row) {
  if (!scroller || !row) return;
  const relTop = scrollContentYOffset(scroller, row);
  const rowH = row.offsetHeight || row.getBoundingClientRect().height || 1;
  const next = relTop + rowH / 2 - scroller.clientHeight / 2;
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.max(0, Math.min(next, max));
}

function QueuePopover({ anchorRef, items, currentIndex, onJump, onClose, historyUX = false }) {
  const { t } = useI18n();
  const popRef = React.useRef(null);
  const activeRowRef = React.useRef(null);
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
      const next = { left, top, width: w, maxHeight: maxH };
      setBox((prev) => {
        if (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight) {
          return prev;
        }
        return next;
      });
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

  React.useLayoutEffect(() => {
    if (!historyUX) return;
    if (currentIndex < 0 || currentIndex >= items.length) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const scroller = popRef.current;
      if (!scroller?.isConnected) return;
      const row =
        scroller.querySelector(`button[data-queue-index="${currentIndex}"]`) || activeRowRef.current;
      if (!row || !scroller.contains(row)) return;
      scrollPopoverListToCenterRow(scroller, row);
    };
    queueMicrotask(run);
    const t = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [historyUX, currentIndex, items.length]);

  if (!box) return null;

  /** Upcoming rows look “normal”; played rows ≈70% more muted (retain ~30% of base opacity). */
  const playedDim = 0.3;

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
        overscrollBehavior: "contain",
        background: "#111119",
        border: "1px solid #2a2a33",
        borderRadius: 12,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        zIndex: 5000,
        padding: 6,
      }}
      role="dialog"
      aria-label={t("player.queue")}
    >
      <div style={{ padding: "6px 8px", fontWeight: 800 }}>{t("player.queue")}</div>
      {items.length ? (
        items.map((it, i) => {
          const active = i === currentIndex;
          const isPast = historyUX && currentIndex >= 0 && i < currentIndex;
          const titleOpacity = active ? 1 : isPast ? 0.95 * playedDim : 0.95;
          const subExtraDim = isPast ? playedDim : 1;
          const title = it.title || it.label || t("common.track");
          const sub = [it.artist, it.album].filter(Boolean).join(" • ");
          return (
            <button
              ref={historyUX && active ? activeRowRef : undefined}
              key={it.id + ":" + i}
              type="button"
              className={"queue-item" + (isPast ? " queue-item--played" : "")}
              data-queue-index={i}
              aria-current={active ? "true" : undefined}
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
              <div style={{ fontWeight: 700, opacity: titleOpacity }}>{title}</div>
              {sub ? (
                <div className="muted" style={{ fontSize: 12, opacity: subExtraDim }}>
                  {sub}
                </div>
              ) : null}
            </button>
          );
        })
      ) : (
        <div className="muted" style={{ padding: 10 }}>
          {t("player.emptyQueue")}
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
    <I18nProvider>
      <Shell>
        <ErrorBoundary>
          <React.Suspense fallback={<div className="route-fallback" aria-hidden="true" />}>
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
            <Route path="/genres" element={!getToken() ? <Navigate to="/login" replace /> : <Genres />} />
            <Route path="/genre/:id" element={!getToken() ? <Navigate to="/login" replace /> : <Genre />} />
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
          </React.Suspense>
        </ErrorBoundary>
      </Shell>
    </I18nProvider>
  );
}
