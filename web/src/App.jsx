import React from "react";
import { Routes, Route, Link, Navigate } from "react-router-dom";
import { auth, getToken } from "./api";
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
import { lib } from "./api";
import { PlayerPlaylistModal } from "./components/PlayerPlaylistModal";
import { GlobalSearch } from "./components/GlobalSearch";
import {
  IFastForward,
  IHeart,
  IPause,
  IPlay,
  IPlus,
  IQueue,
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
  const p = usePlayer();
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [curT, setCurT] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [playErr, setPlayErr] = React.useState("");
  const [liked, setLiked] = React.useState(false);
  const [showPlModal, setShowPlModal] = React.useState(false);
  const [showQueue, setShowQueue] = React.useState(false);
  const queueBtnRef = React.useRef(null);
  const [me, setMe] = React.useState(null);
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [showProfile, setShowProfile] = React.useState(false);
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const userBtnRef = React.useRef(null);

  React.useEffect(() => {
    const el = p.ref.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurT(el.currentTime || 0);
    const onMeta = () => setDur(el.duration || 0);
    const onError = () => {
      // Don't auto-skip: browsers can mark the media as ended after a failed load.
      setIsPlaying(false);
      setPlayErr("Playback error (stream failed).");
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

  React.useEffect(() => {
    if (!getToken()) return;
    let stop = false;
    (async () => {
      try {
        const u = await auth.me();
        if (stop) return;
        setMe(u);
      } catch (_) {}
      try {
        const b = await auth.avatar();
        if (stop) return;
        const url = URL.createObjectURL(b);
        setAvatarUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (_) {
        // no avatar is fine
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

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

  return (
    <>
      <div className="layout">
        {getToken() ? (
          <aside className="sidebar">
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
                    localStorage.removeItem("musicsh_token");
                    window.location.hash = "#/login";
                  }}
                />
              ) : null}
            </div>
            <nav className="side-nav">
              <Link to="/">Home</Link>
              <Link to="/artists">Artists</Link>
              <Link to="/albums">Albums</Link>
              <Link to="/playlists">Playlists</Link>
              <Link to="/likes">Likes</Link>
            </nav>
          </aside>
        ) : null}
        <main className="main">
          {getToken() ? <GlobalSearch /> : null}
          {children}
        </main>
      </div>
      {p.current && getToken() ? (
        <div className="player">
          <button className="player-skip" type="button" onClick={p.prev} title="Rewind">
            <IRewind />
          </button>

          <button
            className="player-play"
            type="button"
            onClick={() => {
              const el = p.ref.current;
              if (!el) return;
              if (el.paused) el.play();
              else el.pause();
            }}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <IPause /> : <IPlay />}
          </button>

          <button className="player-skip" type="button" onClick={p.next} title="Fast-forward">
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

          <div className="muted" style={{ minWidth: 64, textAlign: "right" }}>
            {fmtTime(curT)}
          </div>

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
              const v = Number(e.target.value);
              el.currentTime = v;
              setCurT(v);
            }}
          />

          <div style={{ position: "relative" }}>
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
            {showQueue ? (
              <QueuePopover
                anchorRef={queueBtnRef}
                items={Array.isArray(p.queue) ? p.queue : []}
                currentIndex={typeof p.index === "number" ? p.index : -1}
                onJump={(i) => p.jumpTo(i)}
                onClose={() => setShowQueue(false)}
              />
            ) : null}
          </div>

          <div className="muted" style={{ minWidth: 64 }}>
            {fmtTime(dur)}
          </div>

          {playErr ? (
            <div className="muted" style={{ color: "tomato", fontSize: 12, marginLeft: 8, maxWidth: 220 }}>
              {playErr}
            </div>
          ) : null}

          <audio
            key={p.current.id}
            autoPlay
            ref={(el) => {
              if (el) p.ref.current = el;
            }}
            src={p.current.url}
          />
        </div>
      ) : null}
      {showPlModal && p.current?.id ? (
        <PlayerPlaylistModal trackId={p.current.id} onClose={() => setShowPlModal(false)} />
      ) : null}
      {showProfile && getToken() ? (
        <ProfileModal
          me={me}
          avatarUrl={avatarUrl}
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
            localStorage.removeItem("musicsh_token");
            window.location.hash = "#/login";
          }}
        />
      ) : null}
    </>
  );
}

function UserMenu({ anchorRef, name, onClose, onOpenProfile, onLogout }) {
  React.useEffect(() => {
    const onDoc = (e) => {
      const el = anchorRef.current;
      if (el && el.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose, anchorRef]);

  const r = anchorRef.current?.getBoundingClientRect?.();
  const style = r
    ? {
        position: "fixed",
        top: r.bottom + 8,
        left: Math.min(window.innerWidth - 260, Math.max(8, r.left - 200)),
        width: 240,
        background: "#111119",
        border: "1px solid #2a2a33",
        borderRadius: 12,
        padding: 8,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        zIndex: 2500,
      }
    : {};

  return (
    <div style={style} role="menu" aria-label="Profile menu">
      <div style={{ padding: "6px 8px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
      </div>
      <button type="button" className="ghost menu-btn" onClick={onOpenProfile}>
        Profile settings
      </button>
      <button type="button" className="ghost menu-btn" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}

function ProfileModal({ me, avatarUrl, onClose, onAvatarUpdated, onLogout }) {
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
  React.useEffect(() => {
    const onDoc = (e) => {
      const el = anchorRef.current;
      if (el && el.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose, anchorRef]);

  const r = anchorRef.current?.getBoundingClientRect?.();
  const style = r
    ? {
        position: "fixed",
        left: Math.min(window.innerWidth - 360, Math.max(8, r.right - 340)),
        top: Math.max(8, r.top - 320),
        width: 340,
        maxHeight: 300,
        overflow: "auto",
        background: "#111119",
        border: "1px solid #2a2a33",
        borderRadius: 12,
        boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        zIndex: 2000,
        padding: 6,
      }
    : {};

  return (
    <div style={style} role="dialog" aria-label="Queue">
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
