import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { IPlay } from "../components/icons";

export function Library() {
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
      {msg ? <p className="muted">{msg}</p> : null}
      <div className="grid">
        {albums.map((a) => (
          <Link key={a.id} to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card album-tile">
              <div className="tile-media">
                {a.coverUrl ? <img className="album-art" src={lib.coverUrl(a.id)} alt="" /> : <div className="album-art" />}
                <button
                  type="button"
                  className="tile-play-btn"
                  title={t("library.playAlbum")}
                  aria-label={t("library.playAlbum")}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const tr = await lib.tracks("", a.id);
                      const items = (Array.isArray(tr) ? tr : []).map((t) => ({
                        id: t.id,
                        label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
                        url: lib.streamUrl(t.id),
                        artist: t.artist?.name || "",
                        title: t.title || t("common.track"),
                        album: t.album?.title || a.title || "",
                        coverUrl: effectiveTrackCoverUrl(t) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
                      }));
                      if (items.length) player.playQueue(items, 0);
                    } catch (err) {
                      setMsg(err?.message || "error");
                    }
                  }}
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
        ))}
      </div>
    </div>
  );
}
