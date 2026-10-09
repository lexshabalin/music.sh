import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { auth, getToken } from "../api";
import { useI18n } from "../i18n";
import { formatLocalYMD, statsPeriodRange } from "./statsPeriod";

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
const ARTIST_TOP_N = 12;

function periodLabel(t, period) {
  if (period === "day") return t("home.period.day");
  if (period === "week") return t("home.period.week");
  if (period === "month") return t("home.period.month");
  if (period === "custom") return t("home.period.custom");
  return period;
}

function GenreDonut({ genres, emptyLabel }) {
  const total = genres.reduce((s, g) => s + Math.max(0, g.listenMs || 0), 0);
  if (!total) {
    return <p className="muted" style={{ margin: 0 }}>{emptyLabel}</p>;
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
    return <p className="muted" style={{ margin: 0 }}>{emptyLabel}</p>;
  }
  return (
    <div className="home-genre-donut-wrap" aria-hidden="true">
      <div className="home-genre-donut" style={{ background: `conic-gradient(from 0deg, ${stops.join(", ")})` }} />
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
      setPos({ left, top: r.bottom + 8, width: w });
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
              style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 20000 }}
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

function collapseArtists(list, topN, othersLabel) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (arr.length <= topN) return arr;
  const head = arr.slice(0, topN);
  const restMs = arr.slice(topN).reduce((s, a) => s + (Number(a.listenMs) || 0), 0);
  if (restMs > 0) head.push({ id: "__others", name: othersLabel, listenMs: restMs });
  return head;
}

export function Stats() {
  const { t } = useI18n();
  const [period, setPeriod] = useState("week");
  const [customFrom, setCustomFrom] = useState(() => statsPeriodRange("week").from);
  const [customTo, setCustomTo] = useState(() => formatLocalYMD(new Date()));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (period === "custom") return statsPeriodRange("custom", new Date(), { from: customFrom, to: customTo });
    return statsPeriodRange(period);
  }, [period, customFrom, customTo]);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    setLoading(true);
    auth
      .stats({ period, from: range.from, to: range.to })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setErr("");
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.message || "error");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, range.from, range.to]);

  const genres = Array.isArray(data?.listeningByGenre) ? data.listeningByGenre : [];
  const genreTotal = genres.reduce((s, g) => s + Math.max(0, g.listenMs || 0), 0);
  const genreLegend = useMemo(
    () =>
      genres.map((g, i) => ({
        ...g,
        color: GENRE_COLORS[i % GENRE_COLORS.length],
        pct: genreTotal > 0 ? Math.round((100 * (g.listenMs || 0)) / genreTotal) : 0,
      })),
    [genres, genreTotal]
  );

  const artists = useMemo(
    () => collapseArtists(data?.listeningByArtist, ARTIST_TOP_N, t("stats.others")),
    [data?.listeningByArtist, t]
  );
  const artistMax = artists.reduce((m, a) => Math.max(m, Number(a.listenMs) || 0), 0);
  const totalMs = Number(data?.listenMsTotal) || 0;
  const empty = !loading && !err && totalMs <= 0;

  return (
    <div className="stats-page">
      <div className="stats-page__head">
        <div>
          <p style={{ margin: "0 0 8px" }}>
            <Link to="/" className="muted">
              ← {t("nav.home")}
            </Link>
          </p>
          <h2 className="home-page-title" style={{ margin: 0 }}>
            {t("stats.title")}
          </h2>
        </div>
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

      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      <div className="stats-kpi card">
        <div className="stats-kpi__value">{loading ? "…" : fmtListenMs(totalMs)}</div>
        <div className="stats-kpi__label muted">{t("stats.listenTotal")}</div>
      </div>

      {empty ? <p className="muted">{t("stats.emptyPeriod")}</p> : null}

      {!empty ? (
        <div className="stats-panels">
          <section className="card stats-panel">
            <h3 className="stats-panel__title">{t("stats.genres")}</h3>
            <div className="stats-genre-block">
              <GenreDonut genres={genres} emptyLabel={t("stats.emptySlice")} />
              {genreLegend.length ? (
                <ul className="home-genre-legend plain-list">
                  {genreLegend.map((g) => (
                    <li key={g.label} className="home-genre-legend__row">
                      <span className="home-genre-legend__sw" style={{ background: g.color }} aria-hidden />
                      <span className="home-genre-legend__name">{g.label}</span>
                      <span className="home-genre-legend__ms muted">
                        {fmtListenMs(g.listenMs)} · {g.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  {t("stats.emptySlice")}
                </p>
              )}
            </div>
          </section>

          <section className="card stats-panel">
            <h3 className="stats-panel__title">{t("stats.artists")}</h3>
            {artists.length ? (
              <ul className="stats-bars plain-list">
                {artists.map((a) => {
                  const ms = Number(a.listenMs) || 0;
                  const pct = artistMax > 0 ? Math.max(4, Math.round((100 * ms) / artistMax)) : 0;
                  return (
                    <li key={a.id} className="stats-bars__row">
                      <div className="stats-bars__meta">
                        <span className="stats-bars__name">{a.name}</span>
                        <span className="muted stats-bars__ms">{fmtListenMs(ms)}</span>
                      </div>
                      <div className="stats-bars__track" aria-hidden>
                        <div className="stats-bars__fill" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {t("stats.emptySlice")}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
