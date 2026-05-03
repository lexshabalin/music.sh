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
  const p = usePlayer();
  // split/list modes removed (desktop-only simplification)

  const load = React.useCallback(() => {
    lib
      .tracks("", {})
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

  const items = React.useMemo(() => {
    // Playback order should follow the original (unsorted) library order.
    return tracks.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    }));
  }, [tracks]);

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

  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    };
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

  const shuffle = () => {
    const shuffled = shuffleCopy(items);
    if (shuffled.length) p.playQueue(shuffled, 0);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
        <button
          type="button"
          className="ghost icon-btn"
          onClick={shuffle}
          disabled={!items.length}
          title={t("tracks.shuffle")}
          aria-label={t("tracks.shuffle")}
        >
          ⇄
        </button>
      </div>

      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      {mode === "grid" ? (
          <div className="grid">
            {sortedTracks.map((tr, i) => {
              const cover = effectiveTrackCoverUrl(tr);
              const title = tr?.title || t("common.untitled");
              const artist = tr?.artist?.name || t("common.unknownArtist");
              const album = tr?.album?.title || "";
              return (
                <div key={tr.id} className="card album-tile" style={{ cursor: "pointer" }} onClick={() => playAt(i)} role="button" tabIndex={0}>
                  <div className="tile-media">
                    <MediaCover src={cover || ""} className="album-art" alt="" />
                    <button type="button" className="tile-play-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); playAt(i); }} title={t("tracks.playAria")} aria-label={t("tracks.playAria")}>
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

