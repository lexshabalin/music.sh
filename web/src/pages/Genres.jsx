import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { useI18n } from "../i18n";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import { usePlayer } from "../usePlayer";
import { FinderSplit, FinderLeft, FinderItem } from "../components/FinderSplit";

export function Genres() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("genres");
  const [list, setList] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [sel, setSel] = React.useState(null);
  const [tracks, setTracks] = React.useState([]);
  const [tracksErr, setTracksErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
  const [sortKey, setSortKey] = React.useState("title");
  const [sortDir, setSortDir] = React.useState("asc");
  const p = usePlayer();

  React.useEffect(() => {
    lib
      .libraryGenresCatalog(500)
      .then((x) => {
        setErr("");
        setList(Array.isArray(x) ? x : []);
      })
      .catch((e) => {
        setErr(e?.message || "error");
        setList([]);
      });
  }, []);

  React.useEffect(() => {
    if (mode !== "split") return;
    const first = list?.[0]?.id || null;
    setSel((prev) => prev || first);
  }, [mode, list]);

  React.useEffect(() => {
    if (mode !== "split") return;
    if (!sel) {
      setTracks([]);
      return;
    }
    let cancelled = false;
    setTracksErr("");
    lib
      .tracks("", { genreId: sel })
      .then((x) => {
        if (cancelled) return;
        setTracks(Array.isArray(x) ? x : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setTracksErr(e?.message || "error");
        setTracks([]);
      });
    lib
      .likeIds()
      .then((r) => {
        if (cancelled) return;
        setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : []));
      })
      .catch(() => {
        if (!cancelled) setLiked(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sel]);

  const playAt = (startIdx, forTracks) => {
    const src = Array.isArray(forTracks) ? forTracks : tracks;
    const items = src.map((tr) => ({
      id: tr.id,
      label: (tr.artist ? tr.artist.name + " — " : "") + (tr.title || t("common.track")),
      url: lib.streamUrl(tr.id),
      artist: tr.artist?.name || "",
      title: tr.title || t("common.track"),
      album: tr.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(tr),
    }));
    if (!items.length) return;
    const idx = Math.max(0, Math.min(items.length - 1, startIdx || 0));
    const it = items[idx];
    p.playQueue(items, idx);
    try {
      const el = p.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };

  const toggleLike = async (trackId) => {
    const on = liked.has(trackId);
    try {
      if (on) await lib.unlike(trackId);
      else await lib.like(trackId);
      const next = new Set(liked);
      if (on) next.delete(trackId);
      else next.add(trackId);
      setLiked(next);
    } catch (_) {}
  };

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link to="/" className="muted">
          ← {t("nav.home")}
        </Link>
      </p>
      <div className="card" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>{t("nav.genres")}</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("genres.browseIntro")}
          </p>
        </div>
        <ViewModeControl value={mode} onChange={setMode} modes={["list", "grid", "split"]} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {!err && !list.length ? <p className="muted">{t("genres.emptyLibrary")}</p> : null}
      {mode === "grid" ? (
        <div className="pill-row">
          {list.map((g) => (
            <Link key={g.id} to={"/genre/" + g.id} className="pill">
              <span style={{ fontWeight: 800 }}>{g.label}</span>
              {typeof g.trackCount === "number" ? <span className="muted">({g.trackCount})</span> : null}
            </Link>
          ))}
        </div>
      ) : mode === "split" ? (
        <FinderSplit
          minHeight={560}
          left={
            <FinderLeft title={t("nav.genres")}>
              <div style={{ display: "grid", gap: 6 }}>
                {list.map((g) => (
                  <FinderItem
                    key={g.id}
                    active={g.id === sel}
                    title={g.label}
                    rightMeta={typeof g.trackCount === "number" ? String(g.trackCount) : "→"}
                    onClick={() => setSel(g.id)}
                  />
                ))}
              </div>
            </FinderLeft>
          }
          right={
            <>
              {tracksErr ? <p style={{ color: "tomato" }}>{tracksErr}</p> : null}
              {!sel ? <p className="muted">{t("common.loading")}</p> : null}
              {!tracks.length && sel && !tracksErr ? <p className="muted">{t("genres.noTracks")}</p> : null}
              <ul className="plain-list">
                <TrackHeader
                  columns="full"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={(k) => {
                    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    else {
                      setSortKey(k);
                      setSortDir("asc");
                    }
                  }}
                />
                {(() => {
                  const arr = Array.isArray(tracks) ? tracks.slice() : [];
                  const mult = sortDir === "desc" ? -1 : 1;
                  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
                  const get = (tr) => {
                    if (sortKey === "title") return (tr?.title || "").toString();
                    if (sortKey === "artist") return (tr?.artist?.name || "").toString();
                    if (sortKey === "album") return (tr?.album?.title || "").toString();
                    return "";
                  };
                  arr.sort((a, b) => coll.compare(get(a), get(b)) * mult);
                  return arr.map((tr) => (
                    <TrackRow
                      key={tr.id}
                      track={tr}
                      index={0}
                      onPlayAt={() => {
                        const idx = tracks.findIndex((x) => x.id === tr.id);
                        playAt(Math.max(0, idx));
                      }}
                      onPlayNext={() => {}}
                      isLiked={liked.has(tr.id)}
                      onToggleLike={(id2) => toggleLike(id2)}
                      label={`${tr.title || t("common.untitled")}`}
                      isNowPlaying={p.current?.id === tr.id}
                      isPlaying={p.isPlaying}
                      columns="full"
                    />
                  ));
                })()}
              </ul>
            </>
          }
        />
      ) : (
        <ul className="plain-list">
          {list.map((g) => (
            <li key={g.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--glass-border)" }}>
              <Link to={"/genre/" + g.id} style={{ fontWeight: 600 }}>
                {g.label}
              </Link>
              {typeof g.trackCount === "number" ? (
                <span className="muted" style={{ marginLeft: 8, fontSize: "0.9rem" }}>
                  ({g.trackCount})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
