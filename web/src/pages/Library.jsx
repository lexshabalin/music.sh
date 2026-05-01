import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { IPlay } from "../components/icons";

function AlbumTile({ a, onPlay, playTitle }) {
  return (
    <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card album-tile">
        <div className="tile-media">
          {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
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

export function Library({ section = "home", titleKey = "nav.home" }) {
  const { t } = useI18n();
  // Global search + rescan live in the app shell now.
  // Home page only shows the album grid.
  const [albums, setA] = React.useState([]);
  const [msg, setMsg] = React.useState("");
  const player = usePlayer();

  React.useEffect(() => {
    lib
      .albums("")
      .then((x) => setA(Array.isArray(x) ? x : []))
      .catch((e) => setMsg(e.message));
  }, []);
  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{t(titleKey)}</h2>
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
