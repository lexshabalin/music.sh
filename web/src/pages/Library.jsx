import React from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { useI18n } from "../i18n";
import { IPlay } from "../components/icons";
import { useSectionViewMode } from "../viewPrefs";
import { ViewModeControl } from "../components/ViewModeControl";

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

function AlbumListRow({ a, onPlay, playTitle }) {
  return (
    <li key={a.id} style={{ padding: "10px 6px" }}>
      <Link to={"/album/" + a.id} style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0 }}>
        {a.coverUrl ? (
          <img src={lib.coverUrl(a.id)} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "#222", border: "1px solid var(--border)" }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
          <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(a.artistName || "—") + (a.year ? ` • ${a.year}` : "")}
          </div>
        </div>
      </Link>
      <button type="button" className="ghost" onClick={onPlay} title={playTitle} aria-label={playTitle} style={{ marginLeft: 10, width: 36, height: 36, padding: 0, borderRadius: 999 }}>
        <IPlay size={16} />
      </button>
    </li>
  );
}

export function Library({ section = "home", titleKey = "nav.home" }) {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode(section);
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
        <ViewModeControl value={mode} onChange={setMode} modes={["grid", "list"]} />
      </div>
      {msg ? <p className="muted">{msg}</p> : null}
      {mode === "list" ? (
        <ul className="plain-list">
          {albums.map((a) => (
            <AlbumListRow
              key={a.id}
              a={a}
              playTitle={t("library.playAlbum")}
              onPlay={async (e) => {
                e.preventDefault?.();
                e.stopPropagation?.();
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
        </ul>
      ) : (
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
      )}
    </div>
  );
}
