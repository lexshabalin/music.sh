import React, { useEffect, useMemo, useState } from "react";
import { auth, effectiveTrackCoverUrl, getToken, lib } from "../api";
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

function GenreDonut({ genres, labels }) {
  const total = genres.reduce((s, g) => s + Math.max(0, g.listenMs || 0), 0);
  if (!total) {
    return <p className="muted" style={{ margin: 0 }}>{labels.empty}</p>;
  }
  let deg = 0;
  const stops = [];
  genres.forEach((g, i) => {
    const frac = Math.max(0, g.listenMs) / total;
    if (frac <= 0) return;
    const w = frac * 360;
    const c = GENRE_COLORS[i % GENRE_COLORS.length];
    stops.push(`${c} ${deg}deg ${deg + w}deg`);
    deg += w;
  });
  if (!stops.length) {
    return <p className="muted" style={{ margin: 0 }}>{labels.empty}</p>;
  }
  return (
    <div className="home-genre-donut-wrap" aria-hidden="true">
      <div
        className="home-genre-donut"
        style={{ background: `conic-gradient(from 0deg, ${stops.join(", ")})` }}
      />
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
        title: t2.title || t("common.track"),
        album: t2.album?.title || a.title || "",
        coverUrl: effectiveTrackCoverUrl(t2) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
      }));
      if (items.length) player.playQueue(items, 0);
    } catch (err) {
      setMsg(err?.message || "error");
    }
  };

  const genres = dash?.listeningByGenre && Array.isArray(dash.listeningByGenre) ? dash.listeningByGenre : [];
  const recent = dash?.recentlyPlayedAlbums && Array.isArray(dash.recentlyPlayedAlbums) ? dash.recentlyPlayedAlbums : [];

  const legend = useMemo(
    () =>
      genres.map((g, i) => ({
        ...g,
        color: GENRE_COLORS[i % GENRE_COLORS.length],
      })),
    [genres]
  );

  return (
    <div className="home-dashboard">
      <h1 className="home-greeting">
        <span className="home-greeting__lead">{t("home.greetingLead")}</span>
        <span className="home-greeting__name">{displayName || "—"}</span>
      </h1>

      {msg ? <p className="muted">{msg}</p> : null}

      <section className="card home-stats-banner">
        <h2 className="home-stats-banner__title">{t("home.statsTitle")}</h2>
        <div className="home-stats-grid">
          <div className="home-stat-card">
            <div className="home-stat-value">{fmtListenMs(dash?.listenMsTotal ?? 0)}</div>
            <div className="home-stat-label muted">{t("home.statListen")}</div>
          </div>
          <div className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryAlbums ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statAlbums")}</div>
          </div>
          <div className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryArtists ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statArtists")}</div>
          </div>
          <div className="home-stat-card">
            <div className="home-stat-value">{dash?.libraryTracks ?? "—"}</div>
            <div className="home-stat-label muted">{t("home.statTracks")}</div>
          </div>
        </div>

        <h3 className="home-stats-sub">{t("home.genresTitle")}</h3>
        <div className="home-genre-block">
          <GenreDonut
            genres={genres}
            labels={{ empty: t("home.genresEmpty") }}
          />
          {legend.length > 0 ? (
            <ul className="home-genre-legend plain-list">
              {legend.map((g) => (
                <li key={g.label} className="home-genre-legend__row">
                  <span className="home-genre-legend__sw" style={{ background: g.color }} aria-hidden />
                  <span className="home-genre-legend__name">{g.label}</span>
                  <span className="home-genre-legend__ms muted">{fmtListenMs(g.listenMs)}</span>
                </li>
              ))}
            </ul>
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
