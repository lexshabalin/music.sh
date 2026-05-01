import React from "react";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import { useI18n } from "../i18n";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";
import { IPlay } from "../components/icons";
import { FinderSplit, FinderLeft, FinderItem } from "../components/FinderSplit";

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
  const [splitTab, setSplitTab] = React.useState("artists"); // artists | albums | genres
  const [splitQ, setSplitQ] = React.useState("");
  const [splitLeftErr, setSplitLeftErr] = React.useState("");
  const [splitSel, setSplitSel] = React.useState(null);
  const [splitTracks, setSplitTracks] = React.useState([]);
  const [splitTracksErr, setSplitTracksErr] = React.useState("");
  const [splitArtists, setSplitArtists] = React.useState([]);
  const [splitAlbums, setSplitAlbums] = React.useState([]);
  const [splitGenres, setSplitGenres] = React.useState([]);

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
    }));
  }, [tracks]);

  const playItems = React.useCallback(
    (srcTracks, startIdx) => {
      const list = Array.isArray(srcTracks) ? srcTracks : [];
      const items = list.map((t2) => ({
        id: t2.id,
        label: (t2.artist ? t2.artist.name + " — " : "") + (t2.title || t("common.track")),
        url: lib.streamUrl(t2.id),
        artist: t2.artist?.name || "",
        title: t2.title || t("common.track"),
        album: t2.album?.title || "",
        coverUrl: effectiveTrackCoverUrl(t2),
      }));
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
    },
    [p, t]
  );

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

  React.useEffect(() => {
    if (mode !== "split") return;
    let cancelled = false;
    setSplitLeftErr("");
    // Load left catalogs (fast enough for now; can be optimized later)
    Promise.allSettled([
      lib.artists("").then((x) => (Array.isArray(x) ? x : [])),
      lib.albums("").then((x) => (Array.isArray(x) ? x : [])),
      lib.libraryGenresCatalog(500).then((x) => (Array.isArray(x) ? x : [])),
    ]).then((all) => {
      if (cancelled) return;
      const a = all[0].status === "fulfilled" ? all[0].value : [];
      const b = all[1].status === "fulfilled" ? all[1].value : [];
      const g = all[2].status === "fulfilled" ? all[2].value : [];
      setSplitArtists(a);
      setSplitAlbums(b);
      setSplitGenres(g);
      if (!splitSel) {
        const first =
          splitTab === "artists"
            ? a?.[0]?.id
            : splitTab === "albums"
              ? b?.[0]?.id
              : g?.[0]?.id;
        if (first) setSplitSel(first);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  React.useEffect(() => {
    if (mode !== "split") return;
    // When switching tabs, pick a default selection.
    const pick = () => {
      if (splitTab === "artists") return splitArtists?.[0]?.id || null;
      if (splitTab === "albums") return splitAlbums?.[0]?.id || null;
      return splitGenres?.[0]?.id || null;
    };
    setSplitSel((prev) => prev || pick());
    setSplitTracks([]);
    setSplitTracksErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitTab, mode]);

  React.useEffect(() => {
    if (mode !== "split") return;
    if (!splitSel) return;
    let cancelled = false;
    setSplitTracksErr("");
    const filters =
      splitTab === "artists"
        ? { artistId: splitSel }
        : splitTab === "albums"
          ? { albumId: splitSel }
          : { genreId: splitSel };
    lib
      .tracks("", filters)
      .then((x) => {
        if (cancelled) return;
        setSplitTracks(Array.isArray(x) ? x : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setSplitTracksErr(e?.message || "error");
        setSplitTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, splitTab, splitSel]);

  const splitLeftList = React.useMemo(() => {
    const qq = String(splitQ || "").trim().toLowerCase();
    const filterBy = (arr, getter) => {
      const base = Array.isArray(arr) ? arr : [];
      if (!qq) return base;
      return base.filter((x) => String(getter(x) || "").toLowerCase().includes(qq));
    };
    if (splitTab === "artists") {
      return filterBy(splitArtists, (x) => x?.name).sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" }));
    }
    if (splitTab === "albums") {
      return filterBy(splitAlbums, (x) => x?.title).sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || ""), undefined, { sensitivity: "base" }));
    }
    return filterBy(splitGenres, (x) => x?.label).sort((a, b) => String(a?.label || "").localeCompare(String(b?.label || ""), undefined, { sensitivity: "base" }));
  }, [splitTab, splitQ, splitArtists, splitAlbums, splitGenres]);

  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t("nav.songs")}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ViewModeControl value={mode} onChange={setMode} modes={["table", "list", "split", "grid"]} />
          <button type="button" className="ghost" onClick={shuffle} disabled={!items.length} title={t("tracks.shuffle")}>
            {t("tracks.shuffle")}
          </button>
        </div>
      </div>

      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

      {mode === "split" ? (
        <FinderSplit
          minHeight={620}
          left={
            <FinderLeft
              tabs={[
                { id: "artists", label: t("nav.artists") },
                { id: "albums", label: t("nav.albums") },
                { id: "genres", label: t("nav.genres") },
              ]}
              activeTab={splitTab}
              onTab={setSplitTab}
              searchValue={splitQ}
              onSearch={setSplitQ}
              error={splitLeftErr}
            >
              <div style={{ display: "grid", gap: 6 }}>
                {splitLeftList.map((x) => {
                  const id = x?.id;
                  const label = splitTab === "artists" ? x?.name : splitTab === "albums" ? x?.title : x?.label;
                  const subtitle =
                    splitTab === "albums"
                      ? [x?.artistName, x?.year ? String(x.year) : ""].filter(Boolean).join(" • ")
                      : "";
                  const rightMeta =
                    splitTab === "genres" && typeof x?.trackCount === "number" ? String(x.trackCount) : "→";
                  return (
                    <FinderItem
                      key={id}
                      active={id && id === splitSel}
                      title={label}
                      subtitle={subtitle}
                      rightMeta={rightMeta}
                      onClick={() => setSplitSel(id)}
                    />
                  );
                })}
              </div>
            </FinderLeft>
          }
          right={
            <>
              {splitTracksErr ? <p style={{ color: "tomato" }}>{splitTracksErr}</p> : null}
              {!splitSel ? <p className="muted">{t("common.loading")}</p> : null}
              {!splitTracks.length && splitSel && !splitTracksErr ? <p className="muted">{t("search.noMatches")}</p> : null}
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
                {sortTracks(splitTracks, sortKey, sortDir).map((tr) => (
                  <TrackRow
                    key={tr.id}
                    track={tr}
                    index={0}
                    onPlayAt={() => {
                      const idx = splitTracks.findIndex((x) => x.id === tr.id);
                      playItems(splitTracks, Math.max(0, idx));
                    }}
                    onPlayNext={(trk) => playNext(trk)}
                    isLiked={liked.has(tr.id)}
                    onToggleLike={(id2) => toggleLike(id2)}
                    label={`${tr.title || t("common.untitled")}`}
                    isNowPlaying={p.current?.id === tr.id}
                    isPlaying={p.isPlaying}
                    columns="full"
                  />
                ))}
              </ul>
            </>
          }
        />
      ) : (
        mode === "grid" ? (
          <div className="grid">
            {sortedTracks.map((tr, i) => {
              const cover = effectiveTrackCoverUrl(tr);
              const title = tr?.title || t("common.untitled");
              const artist = tr?.artist?.name || t("common.unknownArtist");
              const album = tr?.album?.title || "";
              return (
                <div key={tr.id} className="card album-tile" style={{ cursor: "pointer" }} onClick={() => playAt(i)} role="button" tabIndex={0}>
                  <div className="tile-media">
                    {cover ? <img className="album-art" src={cover} alt="" /> : <div className="album-art" />}
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
        ) : mode === "list" ? (
          <ul className="plain-list">
            {sortedTracks.map((tr) => {
              const title = tr?.title || t("common.untitled");
              const artist = tr?.artist?.name || t("common.unknownArtist");
              const album = tr?.album?.title || "";
              const cover = effectiveTrackCoverUrl(tr);
              const active = p.current?.id === tr.id;
              return (
                <li key={tr.id} style={{ padding: "10px 6px" }}>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const idx = tracks.findIndex((x) => x.id === tr.id);
                      playAt(Math.max(0, idx));
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderRadius: 12,
                      padding: "10px 10px",
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      borderColor: active ? "rgba(255,255,255,0.14)" : "transparent",
                    }}
                  >
                    <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: 1 }}>
                      {cover ? (
                        <img src={cover} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: "#222", border: "1px solid var(--border)" }} />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {title}
                        </div>
                        <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[artist, album].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                    </div>
                    <span className="muted" style={{ fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>
                      {tr?.durationMs ? `${Math.floor(tr.durationMs / 60000)}:${String(Math.floor((tr.durationMs / 1000) % 60)).padStart(2, "0")}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="plain-list">
            {mode === "table" ? (
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
            ) : null}
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
        )
      )}
    </div>
  );
}

