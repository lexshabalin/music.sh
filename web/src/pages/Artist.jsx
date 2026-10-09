import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { effectiveTrackCoverUrl, getToken, lib, trackFormatForPlayback } from "../api";
import { MissingLibraryItemDialog } from "../components/MissingLibraryItemDialog";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { MediaCover } from "../components/MediaCover";
import { useI18n } from "../i18n";
import { ViewModeControl } from "../components/ViewModeControl";
import { useSectionViewMode } from "../viewPrefs";
import { AlbumTile } from "./Library";
import { sortAlbumsByYearAsc } from "./artistAlbumsSort";

export function Artist() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams();
  const { mode, setMode } = useSectionViewMode("artist");
  const [q, setQ] = useState("");
  const [albums, setAlbums] = useState([]);
  const [err, setErr] = useState("");
  const [missingIds, setMissingIds] = useState([]);
  const [missingRefresh, setMissingRefresh] = useState(0);
  const [missingDlg, setMissingDlg] = useState("");
  const [missingDlgBusy, setMissingDlgBusy] = useState(false);
  /** Artist row exists in DB but has no tracks (orphan after cleanup or bad data). */
  const [artistOrphanInDb, setArtistOrphanInDb] = useState(false);
  const player = usePlayer();

  useEffect(() => {
    const timer = setTimeout(() => {
      lib
        .albums(q, id)
        .then((x) => {
          setErr("");
          setAlbums(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(timer);
  }, [q, id]);

  useEffect(() => {
    let cancelled = false;
    if (!id || !getToken()) {
      setMissingIds([]);
      setArtistOrphanInDb(false);
      return undefined;
    }
    setArtistOrphanInDb(false);
    (async () => {
      try {
        const tr = await lib.tracks("", { artistId: id });
        const arr = Array.isArray(tr) ? tr : [];
        const ids = arr.map((x) => x?.id).filter(Boolean);
        if (!ids.length) {
          if (!cancelled) {
            setMissingIds([]);
            setArtistOrphanInDb(true);
          }
          return;
        }
        if (!cancelled) {
          setArtistOrphanInDb(false);
        }
        const r = await lib.tracksFileCheck(ids);
        const m = Array.isArray(r?.missingIds) ? r.missingIds.map(String) : [];
        if (!cancelled) setMissingIds(m);
      } catch {
        if (!cancelled) {
          setMissingIds([]);
          setArtistOrphanInDb(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, missingRefresh]);

  const sortedAlbums = useMemo(() => sortAlbumsByYearAsc(albums), [albums]);

  const albumLinkState = (a) => ({ fromArtistId: id, fromArtistName: a.artistName || "" });

  const playAlbum = async (e, a) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const tr = await lib.tracks("", { albumId: a.id });
      const items = (Array.isArray(tr) ? tr : []).map((trk) => ({
        id: trk.id,
        label: (trk.artist ? trk.artist.name + " — " : "") + (trk.title || t("common.track")),
        url: lib.streamUrl(trk.id),
        artist: trk.artist?.name || "",
        artistId: trk.artist?.id || id || "",
        title: trk.title || t("common.track"),
        album: trk.album?.title || a.title || "",
        albumId: trk.album?.id || a.id || "",
        coverUrl: effectiveTrackCoverUrl(trk) || (a.coverUrl ? lib.coverUrl(a.id) : ""),
        format: trackFormatForPlayback(trk),
      }));
      if (items.length) player.playQueue(items, 0);
    } catch (_) {}
  };

  return (
    <div>
      <p className="artist-page-back">
        <Link to="/artists" className="muted">
          {t("artists.back")}
        </Link>
      </p>
      <div className="search-row">
        <div className="search" style={{ flex: 1, margin: 0 }}>
          <input placeholder={t("artists.searchAlbums")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
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
      {getToken() && artistOrphanInDb && missingIds.length === 0 ? (
        <div className="card" style={{ marginBottom: "1rem", padding: "12px 14px", lineHeight: 1.45 }}>
          <p style={{ margin: "0 0 10px 0" }} className="muted">
            {t("missingFile.bannerArtistNoTracks")}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
      {mode === "table" ? (
        <ul className="plain-list">
          {sortedAlbums.map((a) => (
            <li key={a.id} className="entity-list-row">
              <div className="entity-row">
                <Link
                  to={"/album/" + a.id}
                  state={albumLinkState(a)}
                  className="entity-row-art-link"
                  aria-label={a.title || ""}
                >
                  <MediaCover src={a.coverUrl ? lib.coverUrl(a.id) : ""} className="entity-row-art" alt="" />
                </Link>
                <div className="entity-row-meta">
                  <Link to={"/album/" + a.id} state={albumLinkState(a)} className="entity-row-title album-title-link">
                    {a.title}
                  </Link>
                  <div className="entity-row-sub muted">
                    <span>{a.artistName || "—"}</span>
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
          {sortedAlbums.map((a) => (
            <AlbumTile
              key={a.id}
              a={a}
              playTitle={t("library.playAlbum")}
              onPlay={(e) => playAlbum(e, a)}
              linkState={albumLinkState(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
