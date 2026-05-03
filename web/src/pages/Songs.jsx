import React from "react";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
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
      return r !== 0 ? r * mult : (x.i - y.i);
    })
    .map((x) => x.t);
}

export function Songs() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("songs");
  const [tracks, setTracks] = React.useState([]);
  const [err, setErr] = React.useState("");
  const [liked, setLiked] = React.useState(new Set());
  const [sortKey, setSortKey] = React.useState("title");
  const [sortDir, setSortDir] = React.useState("asc");
  const [shuffleBusy, setShuffleBusy] = React.useState(false);
  const p = usePlayer();
  // split/list modes removed (desktop-only simplification)

  const load = React.useCallback(() => {
    lib
      .tracks("", {}, { limit: SONGS_PAGE_SIZE })
      .then((x) => {
        setErr("");
        setTracks(Array.isArray(x) ? x : []);
      })
      .catch((e) => setErr(e?.message || "error"));

    lib
      .likeIds()
      .then((r) => setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : [])))
      .catch(() => setLiked(new Set()));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const sortedTracks = React.useMemo(() => sortTracks(tracks, sortKey, sortDir), [tracks, sortKey, sortDir]);

  const buildQueueItem = React.useCallback(
    (trk) => ({
      id: trk.id,
      label: (trk.artist ? trk.artist.name + " — " : "") + (trk.title || t("common.track")),
      url: lib.streamUrl(trk.id),
      artist: trk.artist?.name || "",
      title: trk.title || t("common.track"),
      album: trk.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(trk),
      format: trackFormatForPlayback(trk),
    }),
    [t]
  );

  const items = React.useMemo(() => {
    // Playback order should follow the original (unsorted) library order.
    return tracks.map((tr) => buildQueueItem(tr));
  }, [tracks, buildQueueItem]);

  const playAt = (startIdx) => {
    if (!items.length) return;
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    p.playQueue(items, idx);
    // iOS Safari sometimes ignores audio.play() when called after render.
    // Trigger it right from the click handler to guarantee the first tap.
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
      const ids = await lib.trackIdsOnly("", {});
      if (!ids.length) return;
      const shuffledIds = shuffleCopy(ids);
      const rows = await lib.tracksByIds(shuffledIds, { concurrency: 8 });
      const queue = rows.map((trk) => buildQueueItem(trk));
      if (queue.length) p.playQueue(queue, 0);
    } catch (e) {
      setErr(e?.message || "error");
    } finally {
      setShuffleBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
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

      {mode === "grid" ? (
          <div className="grid">
            {sortedTracks.map((tr) => {
              const cover = effectiveTrackCoverUrl(tr);
              const title = tr?.title || t("common.untitled");
              const artist = tr?.artist?.name || t("common.unknownArtist");
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
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artist}</span>
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
      ) : (
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
              onMetaSaved={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

