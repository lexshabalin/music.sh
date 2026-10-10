import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackToQueueItem } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import { useI18n } from "../i18n";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";
import { IPlay } from "../components/icons";
import { MediaCover } from "../components/MediaCover";

function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SONGS_PAGE_SIZE = 100;
const SPINNER_DOT_COUNT = 8;

/** Dot ring like classic loading throbbers: head largest/darkest, tail fades (orbit rotates clockwise). */
function SongsLoadSpinner() {
  const orbit = 13;
  return (
    <div className="songs-load-spinner" aria-hidden>
      <div className="songs-load-spinner__orbit">
        {Array.from({ length: SPINNER_DOT_COUNT }, (_, i) => {
          const t = i / Math.max(SPINNER_DOT_COUNT - 1, 1);
          const opacity = 0.12 + 0.88 * Math.pow(1 - t, 1.65);
          const w = 2.15 + (1 - t) * 3.95;
          return (
            <div key={i} className="songs-load-spinner__arm" style={{ transform: `rotate(${i * 45}deg)` }}>
              <span
                className="songs-load-spinner__dot"
                style={{
                  opacity,
                  width: w,
                  height: w,
                  marginLeft: -(w / 2),
                  top: -(orbit + (1 - opacity) * 1.25),
                  backgroundColor: `rgba(243, 243, 244, ${0.55 + opacity * 0.45})`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sortTracks(list, key, dir) {
  const a = Array.isArray(list) ? list.slice() : [];
  const mult = dir === "desc" ? -1 : 1;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const get = (t) => {
    if (key === "title") return (t?.title || "").toString();
    if (key === "artist") return (t?.artist?.name || "").toString();
    if (key === "album") return (t?.album?.title || "").toString();
    return "";
  };
  return a
    .map((t, i) => ({ t, i }))
    .sort((x, y) => {
      const ax = get(x.t);
      const ay = get(y.t);
      const r = coll.compare(ax, ay);
      return r !== 0 ? r * mult : x.i - y.i;
    })
    .map((x) => x.t);
}

export function Songs() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("songs");
  const [q, setQ] = React.useState("");
  const [tracks, setTracks] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
  const [sortKey, setSortKey] = React.useState("title");
  const [sortDir, setSortDir] = React.useState("asc");
  const [shuffleBusy, setShuffleBusy] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingInitial, setLoadingInitial] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const p = usePlayer();

  const hasMoreRef = React.useRef(false);
  const loadingInitialRef = React.useRef(false);
  const loadingMoreRef = React.useRef(false);

  React.useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const sentinelRef = React.useRef(null);
  const tracksLenRef = React.useRef(0);
  React.useEffect(() => {
    tracksLenRef.current = tracks.length;
  }, [tracks]);

  const reload = React.useCallback(async () => {
    loadingInitialRef.current = true;
    setLoadingInitial(true);
    setErr("");
    try {
      const x = await lib.tracks(q, {}, { limit: SONGS_PAGE_SIZE, offset: 0, sort: sortKey, dir: sortDir });
      const safe = Array.isArray(x) ? x : [];
      setTracks(safe);
      const more = safe.length >= SONGS_PAGE_SIZE;
      setHasMore(more);
      hasMoreRef.current = more;
    } catch (e) {
      setErr(e?.message || "error");
      setTracks([]);
      setHasMore(false);
      hasMoreRef.current = false;
    } finally {
      loadingInitialRef.current = false;
      setLoadingInitial(false);
    }

    try {
      const r = await lib.likeIds();
      setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : []));
    } catch (_) {
      setLiked(new Set());
    }
  }, [q, sortKey, sortDir]);

  const loadMore = React.useCallback(async () => {
    if (!hasMoreRef.current || loadingMoreRef.current || loadingInitialRef.current) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);

    try {
      const offset = tracksLenRef.current;
      const batch = await lib.tracks(q, {}, { limit: SONGS_PAGE_SIZE, offset, sort: sortKey, dir: sortDir });
      const list = Array.isArray(batch) ? batch : [];

      if (!list.length) {
        setHasMore(false);
        hasMoreRef.current = false;
        return;
      }

      setTracks((prev) => {
        const seen = new Set(prev.map((tr) => tr.id));
        const merged = [...prev];
        for (const tr of list) {
          if (!seen.has(tr.id)) {
            seen.add(tr.id);
            merged.push(tr);
          }
        }
        return merged;
      });

      if (list.length < SONGS_PAGE_SIZE) {
        setHasMore(false);
        hasMoreRef.current = false;
      }
    } catch (e) {
      setErr(e?.message || "error");
      setHasMore(false);
      hasMoreRef.current = false;
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [q, sortKey, sortDir]);

  const loadMoreRef = React.useRef(loadMore);
  loadMoreRef.current = loadMore;

  React.useEffect(() => {
    const id = setTimeout(() => {
      void reload();
    }, 150);
    return () => clearTimeout(id);
  }, [reload]);

  React.useEffect(() => {
    if (loadingInitial || !hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((ent) => ent.isIntersecting)) return;
        if (!hasMoreRef.current || loadingMoreRef.current || loadingInitialRef.current) return;
        void loadMoreRef.current();
      },
      { root: null, rootMargin: "320px", threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadingInitial, hasMore, tracks.length]);

  const sortedTracks = React.useMemo(() => sortTracks(tracks, sortKey, sortDir), [tracks, sortKey, sortDir]);

  const buildQueueItem = React.useCallback(
    (trk) => trackToQueueItem(trk, { title: trk?.title || t("common.track") }),
    [t]
  );

  const items = React.useMemo(() => {
    return tracks.map((tr) => buildQueueItem(tr));
  }, [tracks, buildQueueItem]);

  const playAt = (startIdx) => {
    if (!items.length) return;
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
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

  const playNext = (trk) => {
    const item = buildQueueItem(trk);
    if (!p.current) p.playQueue([item], 0);
    else p.playNext(item);
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

  const shuffle = async () => {
    if (shuffleBusy) return;
    setShuffleBusy(true);
    setErr("");
    try {
      const ids = await lib.trackIdsOnly(q, {});
      if (!ids.length) return;
      // Match server maxPlaybackQueueTracks (5000); load only what we can put in the queue.
      const shuffledIds = shuffleCopy(ids).slice(0, 5000);
      const rows = await lib.tracksByIds(shuffledIds, { concurrency: 6 });
      const queue = rows.map((trk) => buildQueueItem(trk));
      if (queue.length) p.playQueue(queue, 0);
    } catch (e) {
      setErr(e?.message || "error");
    } finally {
      setShuffleBusy(false);
    }
  };

  const listFooter =
    loadingInitial && tracks.length === 0 ? (
      <div className="songs-load-footer songs-load-footer--initial" role="status" aria-live="polite">
        <SongsLoadSpinner />
        <span className="songs-load-footer__label">{t("tracks.loadingMore")}</span>
      </div>
    ) : (
      <>
        {loadingMore ? (
          <div className="songs-load-footer" role="status" aria-live="polite">
            <SongsLoadSpinner />
            <span className="songs-load-footer__label">{t("tracks.loadingMore")}</span>
          </div>
        ) : null}
        {hasMore ? <div ref={sentinelRef} className="songs-infinite-sentinel" aria-hidden /> : null}
      </>
    );

  return (
    <div>
      <div className="search-row">
        <div className="search" style={{ flex: 1, margin: 0 }}>
          <input placeholder={t("tracks.searchSongs")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => void shuffle()}
          disabled={shuffleBusy}
          title={shuffleBusy ? t("tracks.shuffleLoading") : t("tracks.shuffle")}
          aria-label={shuffleBusy ? t("tracks.shuffleLoading") : t("tracks.shuffle")}
          aria-busy={shuffleBusy}
        >
          ⇄
        </button>
      </div>

      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      {loadingInitial && tracks.length === 0 ? (
        listFooter
      ) : mode === "grid" ? (
        <>
          <div className="grid">
            {sortedTracks.map((tr) => {
              const cover = effectiveTrackCoverUrl(tr);
              const title = tr?.title || t("common.untitled");
              const artist = tr?.artist?.name || t("common.unknownArtist");
              const artistId = tr?.artist?.id;
              const album = tr?.album?.title || "";
              return (
                <div
                  key={tr.id}
                  className="card album-tile"
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    const idx = tracks.findIndex((x) => x.id === tr.id);
                    playAt(Math.max(0, idx));
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="tile-media">
                    <MediaCover src={cover || ""} className="album-art" alt="" />
                    <button
                      type="button"
                      className="tile-play-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const idx = tracks.findIndex((x) => x.id === tr.id);
                        playAt(Math.max(0, idx));
                      }}
                      title={t("tracks.playAria")}
                      aria-label={t("tracks.playAria")}
                    >
                      <IPlay size={16} />
                    </button>
                  </div>
                  <div className="album-meta" style={{ minHeight: 90 }}>
                    <div className="album-title">{title}</div>
                    <div className="album-sub" style={{ justifyContent: "flex-start" }}>
                      {artistId ? (
                        <Link
                          to={"/artist/" + artistId}
                          className="album-artist-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {artist}
                        </Link>
                      ) : (
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist}</span>
                      )}
                    </div>
                    {album ? (
                      <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {album}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {tracks.length ? listFooter : null}
        </>
      ) : (
        <>
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
            {sortedTracks.map((t2) => (
              <TrackRow
                key={t2.id}
                track={t2}
                index={0}
                onPlayAt={() => {
                  const idx = tracks.findIndex((x) => x.id === t2.id);
                  playAt(Math.max(0, idx));
                }}
                onPlayNext={(trk) => playNext(trk)}
                isLiked={liked.has(t2.id)}
                onToggleLike={(id2) => toggleLike(id2)}
                label={`${t2.title || t("common.untitled")}`}
                isNowPlaying={p.current?.id === t2.id}
                isPlaying={p.isPlaying}
                columns="full"
                onMetaSaved={reload}
              />
            ))}
          </ul>
          {tracks.length ? listFooter : null}
        </>
      )}
    </div>
  );
}
