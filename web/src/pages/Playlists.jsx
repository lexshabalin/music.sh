import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { effectiveTrackCoverUrl, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { IPlay } from "../components/icons";
import { useI18n } from "../i18n";

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

export function Playlists() {
  const { t } = useI18n();
  const [list, setList] = useState([]);
  const [name, setN] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [covers, setCovers] = useState({});
  const [menu, setMenu] = useState(null); // { id, left, top }
  const [confirmId, setConfirmId] = useState("");
  const [busyDelete, setBusyDelete] = useState(false);
  const player = usePlayer();
  const load = () =>
    lib
      .playlists("")
      .then((x) => {
        setErr("");
        setList(Array.isArray(x) ? x : []);
      })
      .catch((e) => setErr(e.message || "error"));
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onDoc = () => setMenu(null);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menu]);

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

  return (
    <div>
      <h2>{t("playlist.playlists")}</h2>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input placeholder={t("playlist.newPlaylist")} value={name} onChange={(e) => setN(e.target.value)} />
        <input placeholder={t("playlist.descriptionOptional")} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            if (!name.trim()) return;
            try {
              await lib.createPl(name.trim(), desc.trim());
              setN("");
              setDesc("");
              load();
            } catch (e) {
              setErr(e.message || "error");
            }
          }}
        >
          {t("playlist.create")}
        </button>
      </div>
      <div className="grid">
        {list.map((p) => (
          <Link key={p.id} to={"/playlist/" + p.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card album-tile">
              <div className="tile-media">
                <div className={"pl-collage " + ((covers[p.id] || []).length <= 1 ? "one" : "four")}>
                  {(covers[p.id] || []).length ? (
                    (covers[p.id] || []).slice(0, 4).map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)
                  ) : (
                    <div className="pl-collage-empty" />
                  )}
                </div>
                <button
                  type="button"
                  className="ghost"
                  title={t("playlist.more")}
                  aria-label={t("playlist.more")}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    const w = 220;
                    const pad = 8;
                    const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
                    const top = r.bottom + 6;
                    setMenu({ id: p.id, left, top });
                  }}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: 8,
                    padding: "6px 10px",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.35)",
                    borderColor: "rgba(255,255,255,0.15)",
                    color: "var(--text)",
                  }}
                >
                  ⋯
                </button>
                <button
                  type="button"
                  className="tile-play-btn"
                  title={t("playlist.play")}
                  aria-label={t("playlist.play")}
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      const pl = await lib.playlist(p.id);
                      const tracks = Array.isArray(pl?.tracks) ? pl.tracks : [];
                      const items = tracks.map((t) => ({
                        id: t.id,
                        label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
                        url: lib.streamUrl(t.id),
                        artist: t.artist?.name || "",
                        title: t.title || t("common.track"),
                        album: t.album?.title || "",
                        coverUrl: effectiveTrackCoverUrl(t),
                      }));
                      if (items.length) player.playQueue(items, 0);
                    } catch (e2) {
                      setErr(e2?.message || "error");
                    }
                  }}
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
      {menu ? (
        <div
          style={{
            position: "fixed",
            left: menu.left,
            top: menu.top,
            width: 220,
            background: "#18181f",
            border: "1px solid #2a2a33",
            borderRadius: 10,
            padding: 6,
            zIndex: 2500,
          }}
          role="menu"
          aria-label={t("playlist.more")}
          onClick={(e) => {
            // keep clicks inside menu from bubbling to document (which closes it)
            try { e.stopPropagation(); } catch (_) {}
          }}
        >
          <button
            type="button"
            className="ghost"
            style={{ width: "100%", justifyContent: "flex-start", display: "flex", padding: "8px 10px", color: "tomato" }}
            onClick={() => {
              setMenu(null);
              setConfirmId(menu.id);
            }}
          >
            {t("playlist.delete")}
          </button>
        </div>
      ) : null}
      {confirmId ? (
        <ConfirmModal
          title={t("playlist.delete")}
          text={t("playlist.deleteConfirm")}
          dangerText={t("playlist.delete")}
          busy={busyDelete}
          onClose={() => setConfirmId("")}
          onConfirm={async () => {
            setBusyDelete(true);
            setErr("");
            try {
              await lib.deletePl(confirmId);
              setConfirmId("");
              await load();
            } catch (e) {
              setErr(e?.message || "error");
            }
            setBusyDelete(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ConfirmModal({ title, text, dangerText, busy, onClose, onConfirm }) {
  const { t } = useI18n();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted">{text}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} style={{ borderColor: "tomato", color: "tomato" }}>
            {dangerText}
          </button>
        </div>
      </div>
    </div>
  );
}
