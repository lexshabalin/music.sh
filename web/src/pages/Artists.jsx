import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { useI18n } from "../i18n";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { FinderSplit, FinderLeft, FinderItem } from "../components/FinderSplit";

function AlbumTile({ a, onPlay, playTitle }) {
  return (
    <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card album-tile">
        <div className="tile-media">
          {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
          <button type="button" className="tile-play-btn" title={playTitle} aria-label={playTitle} onClick={onPlay}>
            <IPlay size={16} />
          </button>
        </div>
        <div className="album-meta">
          <div className="album-title">{a.title}</div>
          <div className="album-sub">
            <span>{a.artistName || "—"}</span>
            {a.year ? <span className="album-year">{a.year}</span> : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function Artists() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("artists");
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [albumsErr, setAlbumsErr] = useState("");
  const player = usePlayer();

  useEffect(() => {
    const t = setTimeout(() => {
      lib
        .artists(q)
        .then((x) => {
          setErr("");
          setList(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (mode !== "split") return;
    const first = list?.[0]?.id || null;
    setSel((prev) => prev || first);
  }, [mode, list]);

  useEffect(() => {
    if (mode !== "split") return;
    if (!sel) {
      setAlbums([]);
      return;
    }
    let cancelled = false;
    setAlbumsErr("");
    lib
      .albums("", sel)
      .then((x) => {
        if (cancelled) return;
        setAlbums(Array.isArray(x) ? x : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setAlbumsErr(e?.message || "error");
        setAlbums([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sel]);

  const sortedArtists = useMemo(() => {
    const arr = Array.isArray(list) ? list.slice() : [];
    return arr.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" }));
  }, [list]);

  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t("nav.artists")}</h2>
        <ViewModeControl value={mode} onChange={setMode} modes={["list", "grid", "split"]} />
      </div>
      <div className="search">
        <input placeholder={t("artists.searchArtists")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {mode === "grid" ? (
        <div className="grid">
          {sortedArtists.map((a) => (
            <Link key={a.id} to={"/artist/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 92, justifyContent: "center" }}>
                <div style={{ fontWeight: 900, fontSize: "1.02rem", letterSpacing: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("artists.albumsArrow")}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : mode === "split" ? (
        <FinderSplit
          minHeight={520}
          left={
            <FinderLeft title={t("nav.artists")}>
              <div style={{ display: "grid", gap: 6 }}>
                {sortedArtists.map((a) => (
                  <FinderItem
                    key={a.id}
                    active={a.id === sel}
                    title={a.name}
                    rightMeta="→"
                    onClick={() => setSel(a.id)}
                  />
                ))}
              </div>
            </FinderLeft>
          }
          right={
            <>
              {albumsErr ? <p style={{ color: "tomato" }}>{albumsErr}</p> : null}
              {!sel ? <p className="muted">{t("common.loading")}</p> : null}
              <div className="grid">
                {albums.map((a) => (
                  <AlbumTile
                    key={a.id}
                    a={a}
                    playTitle={t("library.playAlbum")}
                    onPlay={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
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
                      } catch (_) {}
                    }}
                  />
                ))}
              </div>
            </>
          }
        />
      ) : (
        <ul className="plain-list">
          {sortedArtists.map((a) => (
            <li key={a.id}>
              <Link to={"/artist/" + a.id} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
                {a.name}
              </Link>
              <span className="muted">{t("artists.albumsArrow")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

