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
  return (
    <>
      <div className="layout">
        <div className="top">
          <h1 style={{ margin: 0, fontSize: "1.2rem" }}>MusicSH</h1>
          {getToken() ? (
            <nav>
              <Link to="/">Home</Link>
              <Link to="/playlists">Playlists</Link>
              <Link to="/likes">Likes</Link>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  localStorage.removeItem("musicsh_token");
                  window.location.hash = "#/login";
                }}
              >
                Log out
              </button>
            </nav>
          ) : null}
        </div>
        {children}
      </div>
      {p.current && getToken() ? (
        <div className="player">
          <button className="ghost" type="button" onClick={p.prev} title="Previous">
            ◀
          </button>
          <button className="ghost" type="button" onClick={p.next} title="Next">
            ▶
          </button>
          <div className="muted" style={{ maxWidth: "200px" }}>
            {p.current.label}
          </div>
          <div className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Vol
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={p.volume}
              onChange={(e) => p.setVolume(Number(e.target.value))}
              style={{ width: 120 }}
            />
          </div>
          <audio
            key={p.current.id}
            controls
            autoPlay
            ref={(el) => {
              if (el) p.ref.current = el;
            }}
            src={p.current.url}
            onEnded={() => p.next()}
          />
        </div>
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
            path="/playlists"
            element={!getToken() ? <Navigate to="/login" replace /> : <Playlists />}
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
