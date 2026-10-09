import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { IPlay } from "../components/icons";
import { MediaCover } from "../components/MediaCover";
import { ViewModeControl } from "../components/ViewModeControl";
import { useSectionViewMode } from "../viewPrefs";

export function AlbumTile({ a, onPlay, playTitle }) {
  const artistId = a?.artistId;
  const artistName = a?.artistName || "—";
  return (
    <div className="card album-tile">
      <div className="tile-media">
        <Link to={"/album/" + a.id} className="album-tile-cover" aria-label={a.title || ""}>
          <MediaCover src={a.coverUrl ? lib.coverUrl(a.id) : ""} className="album-art" alt="" />
        </Link>
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
        <Link to={"/album/" + a.id} className="album-title album-title-link">
          {a.title}
        </Link>
        <div className="album-sub">
          {artistId ? (
            <Link to={"/artist/" + artistId} className="album-artist-link">
              {artistName}
            </Link>
          ) : (
            <span>{artistName}</span>
          )}
          {a.year ? <span className="album-year">{a.year}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function Library() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("albums");
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

  const playAlbum = async (e, a) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const tr = await lib.tracks("", { albumId: a.id });
      const items = (Array.isArray(tr) ? tr : []).map((t2) => ({
        id: t2.id,
        label: (t2.artist ? t2.artist.name + " — " : "") + (t2.title || t("common.track")),
        url: lib.streamUrl(t2.id),
        artist: t2.artist?.name || "",
        artistId: t2.artist?.id || a.artistId || "",
        title: t2.title || t("common.track"),
        album: t2.album?.title || a.title || "",
        albumId: t2.album?.id || a.id || "",
        coverUrl: effectiveTrackCoverUrl(t2) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
        format: trackFormatForPlayback(t2),
      }));
      if (items.length) player.playQueue(items, 0);
    } catch (err) {
      setMsg(err?.message || "error");
    }
  };

  return (
    <div>
      <div className="search-row">
        <div className="search" style={{ flex: 1, margin: 0 }}>
          <input placeholder={t("albums.searchAlbums")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
      </div>
      {msg ? <p className="muted">{msg}</p> : null}
      {mode === "table" ? (
        <ul className="plain-list">
          {albums.map((a) => (
            <li key={a.id} className="entity-list-row">
              <div className="entity-row">
                <Link to={"/album/" + a.id} className="entity-row-art-link" aria-label={a.title || ""}>
                  <MediaCover src={a.coverUrl ? lib.coverUrl(a.id) : ""} className="entity-row-art" alt="" />
                </Link>
                <div className="entity-row-meta">
                  <Link to={"/album/" + a.id} className="entity-row-title album-title-link">
                    {a.title}
                  </Link>
                  <div className="entity-row-sub muted">
                    {a.artistId ? (
                      <Link to={"/artist/" + a.artistId} className="album-artist-link">
                        {a.artistName || "—"}
                      </Link>
                    ) : (
                      <span>{a.artistName || "—"}</span>
                    )}
                    {a.year != null && a.year !== "" ? ` • ${a.year}` : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="tile-play-btn"
                title={t("library.playAlbum")}
                aria-label={t("library.playAlbum")}
                onClick={(e) => playAlbum(e, a)}
              >
                <IPlay size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid">
          {albums.map((a) => (
            <AlbumTile key={a.id} a={a} playTitle={t("library.playAlbum")} onPlay={(e) => playAlbum(e, a)} />
          ))}
        </div>
      )}
    </div>
  );
}
