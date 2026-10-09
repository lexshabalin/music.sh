import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
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
      Promise.allSettled([lib.tracks(qq, {}), lib.albums(qq), lib.artists(qq), lib.playlists(qq)]).then((all) => {
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
          placeholder={t("search.placeholder")}
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
          title={t("search.rescan")}
          aria-label={t("search.rescan")}
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
            {t("search.scannedFiles")}: <b>{scanState.scannedFiles}</b> • {t("search.foundTracks")}: <b>{scanState.foundTracks}</b>
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
          aria-label={t("search.results")}
          onMouseDown={(e) => {
            // keep focus on input when clicking inside
            e.preventDefault();
          }}
        >
          {hasAny ? (
            <>
              <ResultSection title={t("search.songs")}>
                {res.songs.length ? (
                  res.songs.map((track) => (
                    <div key={track.id} className="search-item">
                      <button
                        type="button"
                        className="ghost search-play"
                        title={t("search.play")}
                        aria-label={t("search.play")}
                        onClick={() => {
                          const item = {
                            id: track.id,
                            label:
                              (track.artist ? track.artist.name + " — " : "") +
                              (track.title || t("common.track")),
                            url: lib.streamUrl(track.id),
                            artist: track.artist?.name || "",
                            artistId: track.artist?.id || "",
                            title: track.title || t("common.track"),
                            album: track.album?.title || "",
                            albumId: track.album?.id || "",
                            coverUrl: effectiveTrackCoverUrl(track),
                            format: trackFormatForPlayback(track),
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
                        <div className="search-item-title">{track.title || t("common.track")}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {track.artist?.name || "—"} {track.album?.title ? `• ${track.album.title}` : ""}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted">{t("search.noMatches")}</div>
                )}
              </ResultSection>
              <ResultSection title={t("search.albums")}>
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
                  <div className="muted">{t("search.noMatches")}</div>
                )}
              </ResultSection>
              <ResultSection title={t("search.artists")}>
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
                  <div className="muted">{t("search.noMatches")}</div>
                )}
              </ResultSection>
              <ResultSection title={t("search.playlists")}>
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
                  <div className="muted">{t("search.noMatches")}</div>
                )}
              </ResultSection>
            </>
          ) : (
            <div style={{ padding: 10 }} className="muted">
              {t("search.noMatches")}
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
              {t("search.clear")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

