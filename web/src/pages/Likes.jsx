import { useEffect, useMemo, useState } from "react";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackRow } from "../components/TrackMenu";
import { useI18n } from "../i18n";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";
import { IPlay } from "../components/icons";
import { MediaCover } from "../components/MediaCover";

export function Likes() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("likes");
  const [q, setQ] = useState("");
  const [tracks, setT] = useState([]);
  const p = usePlayer();
  const likedSet = new Set(tracks.map((t) => t.id));
  const filtered = useMemo(() => {
    const qq = (q || "").trim().toLowerCase();
    if (!qq) return tracks;
    return tracks.filter((tr) => {
      const hay = [tr?.title, tr?.artist?.name, tr?.album?.title].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(qq);
    });
  }, [tracks, q]);
  const load = async () => {
    const res = await lib.likeIds();
    const trackIds = Array.isArray(res?.trackIds) ? res.trackIds : [];
    const t = await Promise.all(trackIds.map((id) => lib.track(id).catch(() => null)));
    setT(t.filter(Boolean));
  };
  useEffect(() => {
    load();
  }, []);

  const playAt = (startIdx, list = filtered) => {
    const items = list.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
      format: trackFormatForPlayback(t),
    }));
    p.playQueue(items, startIdx);
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
    if (!p.current) {
      p.playQueue([item], 0);
      return;
    }
    p.playNext(item);
  };

  const unlike = async (trackId) => {
    await lib.unlike(trackId);
    setT((prev) => prev.filter((x) => x.id !== trackId));
  };

  return (
    <div>
      <div className="search">
        <input placeholder={t("likes.searchLikes")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
      </div>
      {mode === "grid" ? (
        <div className="grid">
          {filtered.map((tr, i) => {
            const title = tr?.title || t("common.untitled");
            const artist = tr?.artist?.name || t("common.unknownArtist");
            const cover = effectiveTrackCoverUrl(tr);
            return (
              <div key={tr.id} className="card album-tile" style={{ cursor: "pointer" }} onClick={() => playAt(i)} role="button" tabIndex={0}>
                <div className="tile-media">
                  <MediaCover src={cover || ""} className="album-art" alt="" />
                  <button type="button" className="tile-play-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); playAt(i); }} title={t("tracks.playAria")} aria-label={t("tracks.playAria")}>
                    <IPlay size={16} />
                  </button>
                </div>
                <div className="album-meta" style={{ minHeight: 80 }}>
                  <div className="album-title">{title}</div>
                  <div className="album-sub" style={{ justifyContent: "flex-start" }}>
                    <span>{artist}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="plain-list">
          {filtered.map((t2, i) => (
            <TrackRow
              key={t2.id}
              track={t2}
              index={i}
              onPlayAt={(idx) => playAt(idx)}
              onPlayNext={(trk) => playNext(trk)}
              isLiked={likedSet.has(t2.id)}
              onToggleLike={() => unlike(t2.id)}
              label={`${t2.title || t("common.untitled")}`}
              isNowPlaying={p.current?.id === t2.id}
              isPlaying={p.isPlaying}
              onMetaSaved={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
