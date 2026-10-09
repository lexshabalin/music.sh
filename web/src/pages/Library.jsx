import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { IPlay } from "../components/icons";
import { MediaCover } from "../components/MediaCover";

export function AlbumTile({ a, onPlay, playTitle }) {
  return (
    <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card album-tile">
        <div className="tile-media">
          <MediaCover src={a.coverUrl ? lib.coverUrl(a.id) : ""} className="album-art" alt="" />
          <button
            type="button"
            className="tile-play-btn"
            title={playTitle}
            aria-label={playTitle}
            onClick={onPlay}
          >
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

export function Library({ pageTitleKey }) {
  const { t } = useI18n();
  // Rescan + omnibar live in the shell (Home). Albums page filters via local search.
  const [q, setQ] = React.useState("");
  const [albums, setA] = React.useState([]);
  const [msg, setMsg] = React.useState("");
  const player = usePlayer();

  React.useEffect(() => {
    const id = setTimeout(() => {
      lib
        .albums(q)
        .then((x) => {
          setMsg("");
          setA(Array.isArray(x) ? x : []);
        })
        .catch((e) => setMsg(e.message));
    }, 150);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <div>
      {pageTitleKey ? (
        <h2 className="home-page-title" style={{ marginTop: 0 }}>
          {t(pageTitleKey)}
        </h2>
      ) : null}
      <div className="search">
        <input placeholder={t("albums.searchAlbums")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {msg ? <p className="muted">{msg}</p> : null}
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
                  format: trackFormatForPlayback(t2),
                }));
                if (items.length) player.playQueue(items, 0);
              } catch (err) {
                setMsg(err?.message || "error");
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
