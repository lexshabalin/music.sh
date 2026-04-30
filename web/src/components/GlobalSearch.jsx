import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "./icons";

function ResultSection({ title, children }) {
  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontWeight: 800, marginBottom: 8, color: "var(--text)" }}>{title}</div>
      {children}
    </div>
  );
}

export function GlobalSearch() {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [res, setRes] = React.useState({ songs: [], albums: [], artists: [], playlists: [] });
  const [scanning, setScanning] = React.useState(false);
  const [scanState, setScanState] = React.useState(null);
  const player = usePlayer();
  const nav = useNavigate();

  React.useEffect(() => {
    const qq = (q || "").trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (!qq) {
        setRes({ songs: [], albums: [], artists: [], playlists: [] });
        setOpen(false);
        return;
      }
      setOpen(true);
      Promise.allSettled([lib.tracks(qq), lib.albums(qq), lib.artists(qq), lib.playlists(qq)]).then((all) => {
        if (cancelled) return;
        const songs = all[0].status === "fulfilled" && Array.isArray(all[0].value) ? all[0].value : [];
        const albs = all[1].status === "fulfilled" && Array.isArray(all[1].value) ? all[1].value : [];
        const arts = all[2].status === "fulfilled" && Array.isArray(all[2].value) ? all[2].value : [];
        const pls = all[3].status === "fulfilled" && Array.isArray(all[3].value) ? all[3].value : [];
        setRes({
          songs: songs.slice(0, 6),
          albums: albs.slice(0, 6),
          artists: arts.slice(0, 6),
          playlists: pls.slice(0, 6),
        });
      });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  React.useEffect(() => {
    if (!scanning) return;
    let stop = false;
    const tick = async () => {
      try {
        const st = await lib.scanStatus();
        if (stop) return;
        setScanState(st);
        if (!st.running) setScanning(false);
      } catch (_) {}
      if (!stop) setTimeout(tick, 500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [scanning]);

  const hasAny =
    res.songs.length || res.albums.length || res.artists.length || res.playlists.length;

  return (
    <div className="gsearch">
      <div className="gsearch-row">
        <input
          className="gsearch-input"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if ((q || "").trim()) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              e.currentTarget.blur();
            }
            if (e.key === "Enter") setOpen(true);
          }}
        />

        <button
          type="button"
          className={`rescan-icon-btn${scanning ? " rescan-icon-btn--scanning" : ""}`}
          disabled={scanning}
          title="Rescan library"
          aria-label="Rescan library"
          onClick={async () => {
            setScanning(true);
            try {
              await lib.scan();
            } catch (_) {
              setScanning(false);
            }
          }}
        >
          <svg className="rescan-ecg" viewBox="0 0 48 14" aria-hidden>
            <path className="rescan-ecg__base" d="M1 7 L47 7" />
            <path className="rescan-ecg__pulse" d="M1 7 L18 7 L22.2 0.9 L25.2 13.1 L28.4 4.8 L31 7 L47 7" />
          </svg>
        </button>
      </div>

      {scanning && scanState ? (
        <div className="gsearch-scan">
          <div className="muted" style={{ marginBottom: 6 }}>
            Scanned files: <b>{scanState.scannedFiles}</b> • Found tracks: <b>{scanState.foundTracks}</b>
          </div>
          <div style={{ height: 6, background: "#2a2a33", borderRadius: 999 }}>
            <div
              style={{
                height: 6,
                width: `${Math.min(100, (scanState.scannedFiles / Math.max(1, scanState.foundTracks || 1)) * 100)}%`,
                background: "#cfcfd6",
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      ) : null}

      {open ? (
        <div
          className="gsearch-popover"
          role="dialog"
          aria-label="Search results"
          onMouseDown={(e) => {
            // keep focus on input when clicking inside
            e.preventDefault();
          }}
        >
          {hasAny ? (
            <>
              <ResultSection title="Songs">
                {res.songs.length ? (
                  res.songs.map((t) => (
                    <div key={t.id} className="search-item">
                      <button
                        type="button"
                        className="ghost search-play"
                        title="Play"
                        aria-label="Play"
                        onClick={() => {
                          const item = {
                            id: t.id,
                            label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
                            url: lib.streamUrl(t.id),
                            artist: t.artist?.name || "",
                            title: t.title || "Track",
                            album: t.album?.title || "",
                            coverUrl: effectiveTrackCoverUrl(t),
                          };
                          player.playQueue([item], 0);
                          // iOS Safari: call play() from the click handler to avoid "needs 2 taps".
                          try {
                            const el = player.ref.current;
                            if (el && item.url) {
                              if (el.src !== item.url) el.src = item.url;
                              const pr = el.play?.();
                              if (pr && typeof pr.catch === "function") pr.catch(() => {});
                            }
                          } catch (_) {}
                          setOpen(false);
                        }}
                      >
                        <IPlay size={16} />
                      </button>
                      <div className="search-item-main">
                        <div className="search-item-title">{t.title || "Track"}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t.artist?.name || "—"} {t.album?.title ? `• ${t.album.title}` : ""}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted">No matches</div>
                )}
              </ResultSection>
              <ResultSection title="Albums">
                {res.albums.length ? (
                  <div className="pill-row">
                    {res.albums.map((a) => (
                      <Link
                        key={a.id}
                        to={"/album/" + a.id}
                        className="pill"
                        onClick={() => setOpen(false)}
                      >
                        {a.title}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No matches</div>
                )}
              </ResultSection>
              <ResultSection title="Artists">
                {res.artists.length ? (
                  <div className="pill-row">
                    {res.artists.map((a) => (
                      <Link
                        key={a.id}
                        to={"/artist/" + a.id}
                        className="pill"
                        onClick={() => setOpen(false)}
                      >
                        {a.name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No matches</div>
                )}
              </ResultSection>
              <ResultSection title="Playlists">
                {res.playlists.length ? (
                  <div className="pill-row">
                    {res.playlists.map((p) => (
                      <Link
                        key={p.id}
                        to={"/playlist/" + p.id}
                        className="pill"
                        onClick={() => setOpen(false)}
                      >
                        {p.name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No matches</div>
                )}
              </ResultSection>
            </>
          ) : (
            <div style={{ padding: 10 }} className="muted">
              No matches
            </div>
          )}

          <div style={{ padding: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setOpen(false);
                setQ("");
                nav("/");
              }}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

