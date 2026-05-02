import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { effectiveTrackCoverUrl, getToken, lib } from "../api";
import { MissingLibraryItemDialog } from "../components/MissingLibraryItemDialog";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { useI18n } from "../i18n";

function ArtistPagePortrait({ artistId }) {
  const [hidden, setHidden] = useState(false);
  if (!artistId || hidden) return null;
  return (
    <img
      src={lib.artistImageUrl(artistId)}
      alt=""
      loading="lazy"
      decoding="async"
      className="artist-page-portrait"
      onError={() => setHidden(true)}
    />
  );
}

export function Artist() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const [q, setQ] = useState("");
  const [albums, setAlbums] = useState([]);
  const [err, setErr] = useState("");
  const [missingIds, setMissingIds] = useState([]);
  const [missingRefresh, setMissingRefresh] = useState(0);
  const [missingDlg, setMissingDlg] = useState("");
  const [missingDlgBusy, setMissingDlgBusy] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    if (!id || !getToken()) {
      setMissingIds([]);
      return undefined;
    }
    (async () => {
      try {
        const tr = await lib.tracks("", { artistId: id });
        const arr = Array.isArray(tr) ? tr : [];
        const ids = arr.map((x) => x?.id).filter(Boolean);
        if (!ids.length) {
          if (!cancelled) setMissingIds([]);
          return;
        }
        const r = await lib.tracksFileCheck(ids);
        const m = Array.isArray(r?.missingIds) ? r.missingIds.map(String) : [];
        if (!cancelled) setMissingIds(m);
      } catch {
        if (!cancelled) setMissingIds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, missingRefresh]);

  return (
    <div>
      <div className="artist-page-head">
        <ArtistPagePortrait artistId={id} />
        <p className="artist-page-back">
          <Link to="/artists" className="muted">
            {t("artists.back")}
          </Link>
        </p>
      </div>
      <div className="search">
        <input placeholder={t("artists.searchAlbums")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {getToken() && missingIds.length > 0 ? (
        <div className="card" style={{ marginBottom: "1rem", padding: "12px 14px", lineHeight: 1.45 }}>
          <p style={{ margin: "0 0 10px 0" }} className="muted">
            {t("missingFile.bannerArtist")}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="ghost" onClick={() => setMissingDlg("strip")}>
              {t("missingFile.stripAlbumTracks")}
            </button>
            <button type="button" className="ghost" onClick={() => setMissingDlg("artist")}>
              {t("missingFile.deleteArtistDb")}
            </button>
          </div>
        </div>
      ) : null}
      {missingDlg === "strip"
        ? createPortal(
            <MissingLibraryItemDialog
              variant="stripTracks"
              stripCount={missingIds.length}
              busy={missingDlgBusy}
              t={t}
              onNo={() => (!missingDlgBusy ? setMissingDlg("") : null)}
              onYes={async () => {
                if (missingDlgBusy) return;
                setMissingDlgBusy(true);
                try {
                  for (const tid of missingIds) {
                    try {
                      await lib.deleteLibraryTrackRecord(tid);
                    } catch (_) {}
                  }
                  for (const tid of missingIds) {
                    if (typeof player.removeTrackFromQueueById === "function") {
                      player.removeTrackFromQueueById(tid);
                    }
                  }
                } finally {
                  setMissingDlgBusy(false);
                  setMissingDlg("");
                  setMissingRefresh((x) => x + 1);
                }
              }}
            />,
            document.body,
          )
        : null}
      {missingDlg === "artist"
        ? createPortal(
            <MissingLibraryItemDialog
              variant="artist"
              busy={missingDlgBusy}
              t={t}
              onNo={() => (!missingDlgBusy ? setMissingDlg("") : null)}
              onYes={async () => {
                if (missingDlgBusy || !id) return;
                setMissingDlgBusy(true);
                try {
                  await lib.deleteLibraryArtistRecord(id);
                  for (const tid of missingIds) {
                    if (typeof player.removeTrackFromQueueById === "function") {
                      player.removeTrackFromQueueById(tid);
                    }
                  }
                  navigate("/artists");
                } catch (_) {
                } finally {
                  setMissingDlgBusy(false);
                  setMissingDlg("");
                }
              }}
            />,
            document.body,
          )
        : null}
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
                      const items = (Array.isArray(tr) ? tr : []).map((trk) => ({
                        id: trk.id,
                        label:
                          (trk.artist ? trk.artist.name + " — " : "") + (trk.title || t("common.track")),
                        url: lib.streamUrl(trk.id),
                        artist: trk.artist?.name || "",
                        title: trk.title || t("common.track"),
                        album: trk.album?.title || a.title || "",
                        coverUrl: effectiveTrackCoverUrl(trk) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
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

