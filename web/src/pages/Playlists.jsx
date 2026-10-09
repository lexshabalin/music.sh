import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib, trackFormatForPlayback } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { CoverNoteIcon, MediaCover } from "../components/MediaCover";
import { useI18n } from "../i18n";
import { ViewModeControl } from "../components/ViewModeControl";
import { useSectionViewMode } from "../viewPrefs";

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickCoversForPlaylist(plId, tracks) {
  const albumIds = [];
  for (const t of tracks || []) {
    const id = t?.album?.id;
    if (id && !albumIds.includes(id)) albumIds.push(id);
  }
  if (albumIds.length === 0) return [];
  if (albumIds.length === 1) return albumIds;
  // deterministic pseudo-random based on playlist id
  let seed = hash32(plId);
  const arr = albumIds.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, 4);
}

function CreatePlaylistModal({ onClose, onCreated }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const qq = (q || "").trim();
    let cancelled = false;
    const id = setTimeout(() => {
      if (!qq) {
        setRes([]);
        return;
      }
      lib
        .tracks(qq, {})
        .then((x) => {
          if (cancelled) return;
          setRes(Array.isArray(x) ? x.slice(0, 30) : []);
        })
        .catch(() => {
          if (!cancelled) setRes([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const pl = await lib.createPl(name.trim());
      const id = pl?.id;
      if (id && selectedIds.length) {
        for (const tid of selectedIds) {
          // best-effort: keep going if a track fails to add
          try {
            // eslint-disable-next-line no-await-in-loop
            await lib.addToPl(id, tid);
          } catch (_) {}
        }
      }
      onCreated?.();
      onClose?.();
    } catch (e) {
      setErr(e?.message || "error");
    }
    setBusy(false);
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>{t("playlist.create")}</h3>
          <button type="button" className="ghost icon-btn" onClick={onClose} aria-label={t("common.cancel")} title={t("common.cancel")}>
            ×
          </button>
        </div>

        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input placeholder={t("playlist.newPlaylist")} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>

        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 900 }}>{t("search.results")}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {selectedIds.length ? `${selectedIds.length}` : "0"}
            </div>
          </div>
          <input
            placeholder={t("search.placeholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={busy}
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Введите запрос и нажимайте “+” чтобы набрать треки для нового плейлиста.
          </div>

          <div style={{ marginTop: 10, maxHeight: 320, overflow: "auto", border: "1px solid var(--glass-border)", borderRadius: 12 }}>
            {!q.trim() ? (
              <div className="muted" style={{ padding: 12 }}>
                {t("search.placeholder")}
              </div>
            ) : res.length ? (
              res.map((tr) => {
                const on = selected.has(tr.id);
                const title = tr?.title || t("common.untitled");
                const sub = [tr?.artist?.name, tr?.album?.title].filter(Boolean).join(" • ");
                return (
                  <div key={tr.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <button
                      type="button"
                      className="ghost icon-btn"
                      aria-label={on ? t("common.cancel") : t("common.save")}
                      title={on ? "Remove" : "Add"}
                      onClick={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(tr.id)) next.delete(tr.id);
                          else next.add(tr.id);
                          return next;
                        });
                      }}
                      disabled={busy}
                      style={{ width: 34, height: 34, borderRadius: 10 }}
                    >
                      {on ? "–" : "+"}
                    </button>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
                      <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub || "—"}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="muted" style={{ padding: 12 }}>
                {t("search.noMatches")}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={submit} disabled={busy || !name.trim()}>
            {t("playlist.create")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function Playlists() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("playlists");
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");
  const [covers, setCovers] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const player = usePlayer();
  useEffect(() => {
    const id = setTimeout(() => {
      lib
        .playlists(q)
        .then((x) => {
          setErr("");
          setList(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(id);
  }, [q]);
  const load = () =>
    lib
      .playlists(q)
      .then((x) => {
        setErr("");
        setList(Array.isArray(x) ? x : []);
      })
      .catch((e) => setErr(e.message || "error"));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        (Array.isArray(list) ? list : []).map(async (p) => {
          try {
            const pl = await lib.playlist(p.id);
            const ids = pickCoversForPlaylist(p.id, pl?.tracks || []);
            return [p.id, ids.map((aid) => lib.coverUrl(aid))];
          } catch (_) {
            return [p.id, []];
          }
        }),
      );
      if (cancelled) return;
      const next = {};
      for (const [id, urls] of entries) next[id] = urls;
      setCovers(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [list]);

  const playPlaylist = async (e, p) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const pl = await lib.playlist(p.id);
      const tracks = Array.isArray(pl?.tracks) ? pl.tracks : [];
      const items = tracks.map((t2) => ({
        id: t2.id,
        label: (t2.artist ? t2.artist.name + " — " : "") + (t2.title || t("common.track")),
        url: lib.streamUrl(t2.id),
        artist: t2.artist?.name || "",
        artistId: t2.artist?.id || "",
        title: t2.title || t("common.track"),
        album: t2.album?.title || "",
        albumId: t2.album?.id || "",
        coverUrl: effectiveTrackCoverUrl(t2),
        format: trackFormatForPlayback(t2),
      }));
      if (items.length) player.playQueue(items, 0);
    } catch (e2) {
      setErr(e2?.message || "error");
    }
  };

  const collage = (p) => (
    <div className={"pl-collage " + ((covers[p.id] || []).length <= 1 ? "one" : "four")}>
      {(covers[p.id] || []).length ? (
        (covers[p.id] || []).slice(0, 4).map((u, i) => (
          <MediaCover key={i} src={u} className="pl-collage-cell" alt="" loading="lazy" />
        ))
      ) : (
        <div className="pl-collage-empty cover-art-placeholder" aria-hidden>
          <CoverNoteIcon />
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="search-row">
        <div className="search" style={{ flex: 1, margin: 0 }}>
          <input placeholder={t("playlist.searchPlaylists")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ViewModeControl value={mode} onChange={setMode} modes={["table", "grid"]} compact />
        <button
          type="button"
          className="ghost icon-btn"
          onClick={() => setShowCreate(true)}
          title={t("playlist.create")}
          aria-label={t("playlist.create")}
        >
          +
        </button>
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {mode === "table" ? (
        <ul className="plain-list">
          {list.map((p) => (
            <li key={p.id} className="entity-list-row">
              <Link to={"/playlist/" + p.id} className="entity-row">
                <div className="entity-row-art" style={{ overflow: "hidden" }}>
                  {collage(p)}
                </div>
                <div className="entity-row-meta">
                  <div className="entity-row-title">{p.name}</div>
                  {p.description ? <div className="entity-row-sub muted">{p.description}</div> : null}
                </div>
              </Link>
              <button
                type="button"
                className="tile-play-btn"
                title={t("playlist.play")}
                aria-label={t("playlist.play")}
                onClick={(e) => playPlaylist(e, p)}
              >
                <IPlay size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid">
          {list.map((p) => (
            <Link key={p.id} to={"/playlist/" + p.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card album-tile">
                <div className="tile-media">
                  {collage(p)}
                  <button
                    type="button"
                    className="tile-play-btn"
                    title={t("playlist.play")}
                    aria-label={t("playlist.play")}
                    onClick={(e) => playPlaylist(e, p)}
                  >
                    <IPlay size={16} />
                  </button>
                </div>
                <div className="album-meta" style={{ minHeight: 80 }}>
                  <div className="album-title">{p.name}</div>
                  <div className="album-sub" style={{ justifyContent: "flex-start" }}>
                    <span>{p.description || ""}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {showCreate ? (
        <CreatePlaylistModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            load();
          }}
        />
      ) : null}
    </div>
  );
}
