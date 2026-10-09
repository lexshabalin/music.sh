import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { auth, effectiveTrackCoverUrl, getToken, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { AlbumTile } from "./Library";
import { formatLocalYMD, homeStatsPeriodRange } from "./homeStatsPeriod";

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

const PERIODS = ["day", "week", "month", "custom"];

function periodLabel(t, period) {
  if (period === "day") return t("home.period.day");
  if (period === "week") return t("home.period.week");
  if (period === "month") return t("home.period.month");
  if (period === "custom") return t("home.period.custom");
  return period;
}

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

function StatsPeriodControl({ period, onPeriodChange, customFrom, customTo, onCustomChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(customFrom);
  const [draftTo, setDraftTo] = useState(customTo);
  const btnRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    setDraftFrom(customFrom);
    setDraftTo(customTo);
  }, [customFrom, customTo]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect?.();
      if (!r) {
        setPos(null);
        return;
      }
      const w = 260;
      const pad = 8;
      const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
      const top = r.bottom + 8;
      setPos({ left, top, width: w });
    };
    place();
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <div className="home-period">
      <button
        ref={btnRef}
        type="button"
        className="ghost viewmode-btn home-period-btn"
        aria-label={t("home.period.aria")}
        title={t("home.period.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="viewmode-label">{periodLabel(t, period)}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              className="viewmode-menu home-period-menu"
              role="menu"
              aria-label={t("home.period.title")}
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                width: pos.width,
                zIndex: 20000,
              }}
            >
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p === period}
                  className={`ghost viewmode-item${p === period ? " is-active" : ""}`}
                  onClick={() => {
                    if (p !== "custom") {
                      onPeriodChange?.(p);
                      setOpen(false);
                      return;
                    }
                    onPeriodChange?.("custom");
                  }}
                >
                  <span style={{ flex: 1, textAlign: "left" }}>{periodLabel(t, p)}</span>
                </button>
              ))}
              {period === "custom" ? (
                <div className="home-period-custom" onMouseDown={(e) => e.stopPropagation()}>
                  <label className="home-period-custom__field">
                    <span className="muted">{t("home.period.from")}</span>
                    <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
                  </label>
                  <label className="home-period-custom__field">
                    <span className="muted">{t("home.period.to")}</span>
                    <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="ghost home-period-apply"
                    onClick={() => {
                      onCustomChange?.({ from: draftFrom, to: draftTo });
                      onPeriodChange?.("custom");
                      setOpen(false);
                    }}
                  >
                    {t("home.period.apply")}
                  </button>
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function Home() {
  const { t } = useI18n();
  const player = usePlayer();
  const [me, setMe] = useState(null);
  const [dash, setDash] = useState(null);
  const [msg, setMsg] = useState("");
  const [period, setPeriod] = useState("week");
  const [customFrom, setCustomFrom] = useState(() => {
    const r = homeStatsPeriodRange("week");
    return r.from;
  });
  const [customTo, setCustomTo] = useState(() => formatLocalYMD(new Date()));

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

  const range = useMemo(() => {
    if (period === "custom") return homeStatsPeriodRange("custom", new Date(), { from: customFrom, to: customTo });
    return homeStatsPeriodRange(period);
  }, [period, customFrom, customTo]);

  const loadDash = React.useCallback(() => {
    if (!getToken()) return;
    auth
      .home({ period, from: range.from, to: range.to })
      .then((d) => {
        setDash(d);
        setMsg("");
      })
      .catch((e) => setMsg(e?.message || "error"));
  }, [period, range.from, range.to]);

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
        format: trackFormatForPlayback(t2),
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
        <div className="home-stats-banner__head">
          <h2 className="home-stats-banner__title">{t("home.statsTitle")}</h2>
          <StatsPeriodControl
            period={period}
            onPeriodChange={setPeriod}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={({ from, to }) => {
              setCustomFrom(from);
              setCustomTo(to);
            }}
          />
        </div>
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
