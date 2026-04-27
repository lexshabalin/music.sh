import React from "react";
import { Routes, Route, Link, Navigate } from "react-router-dom";
import { getToken } from "./api";
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
import {
  IFastForward,
  IHeart,
  IPause,
  IPlay,
  IPlus,
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

function Shell({ children }) {
  const p = usePlayer();
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [curT, setCurT] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [liked, setLiked] = React.useState(false);
  const [showPlModal, setShowPlModal] = React.useState(false);

  React.useEffect(() => {
    const el = p.ref.current;
    if (!el) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurT(el.currentTime || 0);
    const onMeta = () => setDur(el.duration || 0);
    const onEnded = () => p.next();

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnded);

    // initial
    onMeta();
    onTime();
    setIsPlaying(!el.paused);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnded);
    };
  }, [p.current?.id]);

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
            <div className="brand">MusicSH</div>
            <nav className="side-nav">
              <Link to="/">Home</Link>
              <Link to="/artists">Artists</Link>
              <Link to="/albums">Albums</Link>
              <Link to="/playlists">Playlists</Link>
              <Link to="/likes">Likes</Link>
            </nav>
            <div style={{ marginTop: "auto" }}>
              <button
                className="ghost"
                type="button"
                style={{ width: "100%" }}
                onClick={() => {
                  localStorage.removeItem("musicsh_token");
                  window.location.hash = "#/login";
                }}
              >
                Log out
              </button>
            </div>
          </aside>
        ) : null}
        <main className="main">{children}</main>
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

          <div className="muted" style={{ minWidth: 64 }}>
            {fmtTime(dur)}
          </div>

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
    </>
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
