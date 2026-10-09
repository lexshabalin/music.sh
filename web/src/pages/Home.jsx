import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth, effectiveTrackCoverUrl, getToken, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { AlbumTile } from "./Library";

function fmtListenMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const GENRE_COLORS = [
  "#ff6347",
  "#6c9eeb",
  "#7bc96f",
  "#daa520",
  "#b291f2",
  "#5fd4c8",
  "#ff8abf",
  "#c9c94a",
];

function buildGenreSlices(genres) {
  const total = genres.reduce((s, g) => s + Math.max(0, g.listenMs || 0), 0);
  if (!total) return { total: 0, slices: [] };
  let deg = 0;
  const slices = [];
  genres.forEach((g, i) => {
    const ms = Math.max(0, g.listenMs || 0);
    if (ms <= 0) return;
    const frac = ms / total;
    const w = frac * 360;
    slices.push({
      label: g.label || "—",
      listenMs: ms,
      pct: Math.round(frac * 1000) / 10,
      color: GENRE_COLORS[i % GENRE_COLORS.length],
      startDeg: deg,
      endDeg: deg + w,
      index: i,
    });
    deg += w;
  });
  return { total, slices };
}

function GenreDonut({ slices, emptyLabel }) {
  const [hoverIdx, setHoverIdx] = React.useState(-1);
  if (!slices.length) {
    return <p className="muted" style={{ margin: 0 }}>{emptyLabel}</p>;
  }
  const hover = hoverIdx >= 0 ? slices[hoverIdx] : null;
  const stops = slices.map((s, i) => {
    const active = hoverIdx < 0 || hoverIdx === i;
    const c = active ? s.color : `color-mix(in srgb, ${s.color} 28%, #18181f)`;
    return `${c} ${s.startDeg}deg ${s.endDeg}deg`;
  });
  const pickSlice = (clientX, clientY, el) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const r = Math.hypot(dx, dy);
    const maxR = rect.width / 2;
    const holeR = maxR * 0.44; // matches ::after inset 28%
    if (r < holeR || r > maxR) return -1;
    // CSS conic from 0deg: 12 o'clock, clockwise
    const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const deg = (ang + 360) % 360;
    const last = slices.length - 1;
    return slices.findIndex((s, idx) =>
      idx === last ? deg >= s.startDeg : deg >= s.startDeg && deg < s.endDeg
    );
  };
  return (
    <div
      className="home-genre-donut-wrap"
      onMouseLeave={() => setHoverIdx(-1)}
      onMouseMove={(e) => {
        const i = pickSlice(e.clientX, e.clientY, e.currentTarget);
        setHoverIdx(i);
      }}
    >
      <div
        className={"home-genre-donut" + (hover ? " home-genre-donut--hover" : "")}
        style={{ background: `conic-gradient(from 0deg, ${stops.join(", ")})` }}
        role="img"
        aria-label={hover ? `${hover.label} ${hover.pct}%` : emptyLabel}
      />
      <div className="home-genre-donut-center" aria-hidden={!hover}>
        {hover ? (
          <>
            <div className="home-genre-donut-center__pct">{hover.pct}%</div>
            <div className="home-genre-donut-center__label">{hover.label}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Home() {
  const { t } = useI18n();
  const player = usePlayer();
  const [me, setMe] = useState(null);
  const [dash, setDash] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await auth.me();
        if (!cancelled) setMe(u);
      } catch (_) {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadDash = React.useCallback(() => {
    if (!getToken()) return;
    auth
      .home()
      .then((d) => {
        setDash(d);
        setMsg("");
      })
      .catch((e) => setMsg(e?.message || "error"));
  }, []);

  useEffect(() => {
    loadDash();
  }, [loadDash]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") loadDash();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadDash]);

  const displayName =
    me?.displayName?.trim?.() ||
    me?.username ||
    me?.email ||
    "";

  const playAlbumTiles = async (a, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      const tr = await lib.tracks("", { albumId: a.id });
      const items = (Array.isArray(tr) ? tr : []).map((t2) => ({
        id: t2.id,
        label: (t2.artist ? t2.artist.name + " — " : "") + (t2.title || t("common.track")),
        url: lib.streamUrl(t2.id),
        artist: t2.artist?.name || "",
        artistId: t2.artist?.id || a.artistId || "",
        title: t2.title || t("common.track"),
        album: t2.album?.title || a.title || "",
        albumId: t2.album?.id || a.id || "",
        coverUrl: effectiveTrackCoverUrl(t2) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
        format: trackFormatForPlayback(t2),
      }));
      if (items.length) player.playQueue(items, 0);
    } catch (err) {
      setMsg(err?.message || "error");
    }
  };

  const genres = dash?.listeningByGenre && Array.isArray(dash.listeningByGenre) ? dash.listeningByGenre : [];
  const recent = dash?.recentlyPlayedAlbums && Array.isArray(dash.recentlyPlayedAlbums) ? dash.recentlyPlayedAlbums : [];

  const { slices } = useMemo(() => buildGenreSlices(genres), [genres]);
  const topGenres = useMemo(() => {
    // API is usually listen-desc; re-sort so top 5 is correct either way.
    return slices
      .slice()
      .sort((a, b) => b.listenMs - a.listenMs || String(a.label).localeCompare(String(b.label)))
      .slice(0, 5);
  }, [slices]);

  return (
    <div className="home-dashboard">
      <h1 className="home-greeting">
        <span className="home-greeting__lead">{t("home.greetingLead")}</span>
        <span className="home-greeting__name">{displayName || "—"}</span>
      </h1>

      {msg ? <p className="muted">{msg}</p> : null}

      <section className="card home-stats-banner">
        <div className="home-stats-grid">
          <Link to="/stats" className="home-stat-card">
            <div className="home-stat-value">{fmtListenMs(dash?.listenMsTotal ?? 0)}</div>
            <div className="home-stat-label muted">{t("home.statListen")}</div>
          </Link>
          <Link to="/albums" className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryAlbums ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statAlbums")}</div>
          </Link>
          <Link to="/artists" className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryArtists ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statArtists")}</div>
          </Link>
          <Link to="/songs" className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryTracks ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statTracks")}</div>
          </Link>
        </div>

        <div className="home-genre-block">
          <div className="home-genre-donut-col">
            <h3 className="home-stats-sub home-genre-donut-title">{t("home.genresTitle")}</h3>
            <GenreDonut slices={slices} emptyLabel={t("home.genresEmpty")} />
          </div>
          {topGenres.length > 0 ? (
            <div className="home-genre-top">
              <h3 className="home-stats-sub home-genre-top-title">{t("home.topGenresTitle")}</h3>
              <ul className="home-genre-legend plain-list">
                {topGenres.map((g) => (
                  <li key={g.label + g.index} className="home-genre-legend__row">
                    <span className="home-genre-legend__sw" style={{ background: g.color }} aria-hidden />
                    <span className="home-genre-legend__name">{g.label}</span>
                    <span className="home-genre-legend__ms muted">{fmtListenMs(g.listenMs)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      <section className="home-recent-section">
        <h2 className="home-recent-section__title">{t("home.recentTitle")}</h2>
        {!recent.length ? <p className="muted">{t("home.recentEmpty")}</p> : null}
        <div className="grid">
          {recent.map((a) => (
            <AlbumTile
              key={a.id}
              a={a}
              playTitle={t("library.playAlbum")}
              onPlay={(e) => playAlbumTiles(a, e)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
