import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { useI18n } from "../i18n";

export function Artist() {
  const { t } = useI18n();
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [albums, setAlbums] = useState([]);
  const [err, setErr] = useState("");
  const player = usePlayer();

  useEffect(() => {
    const t = setTimeout(() => {
      lib
        .albums(q, id)
        .then((x) => {
          setErr("");
          setAlbums(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(t);
  }, [q, id]);

  return (
    <div>
      <p>
        <Link to="/artists" className="muted">
          {t("artists.back")}
        </Link>
      </p>
      <div className="search">
        <input placeholder={t("artists.searchAlbums")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
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
                      const tr = await lib.tracks("", { albumId: a.id });
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
                    } catch (x) {}
                  }}
                >
                  <IPlay size={16} />
                </button>
              </div>
              <div className="album-meta">
                <div className="album-title">{a.title}</div>
                <div className="album-sub">
                  <span>{a.artistName || t("common.unknown")}</span>
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

