import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, Link } from "react-router-dom";
import { effectiveTrackCoverUrl, getToken, lib } from "../api";
import { usePlayer } from "../usePlayer";
import { TrackHeader, TrackRow } from "../components/TrackMenu";
import GenreSuggestInput, {
  genresToInputValue,
  parseGenreInput,
} from "../components/GenreSuggestInput";
import { useI18n } from "../i18n";

function ResetPinButton({ onClick, busy }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="ghost"
      style={{ fontSize: "0.75rem", marginLeft: 8, padding: "2px 6px" }}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {t("album.meta.reset")}
    </button>
  );
}

function AlbumMetaModal({ albumId, album, onClose, onRefresh }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState(album?.title || "");
  const [artist, setArtist] = useState(album?.artistName || "");
  const [year, setYear] = useState(album?.year != null ? String(album.year) : "");
  const [genreStr, setGenreStr] = useState(() => genresToInputValue(album?.genres));
  const [genreOpts, setGenreOpts] = useState([]);
  const [coverUrlInput, setCoverUrlInput] = useState("");

  useEffect(() => {
    lib
      .libraryGenres(500)
      .then((x) => setGenreOpts(Array.isArray(x) ? x : []))
      .catch(() => setGenreOpts([]));
  }, []);

  useEffect(() => {
    setTitle(album?.title || "");
    setArtist(album?.artistName || "");
    setYear(album?.year != null ? String(album.year) : "");
    setGenreStr(genresToInputValue(album?.genres));
  }, [album]);

  const m = album?.meta || {};

  const resetField = async (field) => {
    setBusy(true);
    setErr("");
    try {
      await lib.patchAlbumMeta(albumId, { clear: [field] });
      onRefresh();
    } catch (e) {
      setErr(e.message || t("common.error"));
    }
    setBusy(false);
  };

  const save = async () => {
    if (!title.trim()) {
      setErr(t("album.meta.needTitle"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const clear = [];
      if (!year.trim() && m.year) clear.push("year");
      if (!genreStr.trim() && m.genre) clear.push("genres");
      const body = {
        title: title.trim(),
        artistName: artist.trim(),
        clear,
      };
      const gParsed = parseGenreInput(genreStr);
      if (gParsed.length) body.genres = gParsed;
      if (year.trim()) {
        const y = parseInt(year, 10);
        if (!Number.isFinite(y)) throw new Error(t("album.meta.badYear"));
        body.year = y;
      }
      await lib.patchAlbumMeta(albumId, body);
      onRefresh();
      onClose();
    } catch (e) {
      setErr(e.message || t("album.meta.saveError"));
    }
    setBusy(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t("album.editTitle")}</h3>
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: "-0.5rem" }}>
          {t("album.meta.help")}
        </p>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        <p>
          <label>
            {t("album.meta.title")} {m.title ? <ResetPinButton onClick={() => resetField("title")} busy={busy} /> : null}
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </p>
        <p>
          <label>
            {t("album.meta.artist")} {m.artist ? <ResetPinButton onClick={() => resetField("artist")} busy={busy} /> : null}
          </label>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </p>
        <p>
          <label>
            {t("album.meta.year")} {m.year ? <ResetPinButton onClick={() => resetField("year")} busy={busy} /> : null}
          </label>
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder={t("album.meta.yearExample")} />
        </p>
        <p>
          <label>
            {t("album.meta.genre")}{" "}
            {m.genre ? <ResetPinButton onClick={() => resetField("genres")} busy={busy} /> : null}
          </label>
          <GenreSuggestInput
            datalistId={`album-meta-genres-${albumId}`}
            suggestions={genreOpts}
            value={genreStr}
            onChange={setGenreStr}
            disabled={busy}
            hint={`${t("album.meta.genreSuggestHint")} ${t("album.meta.genreRolloutHint")}`}
          />
        </p>
        <p>
          <label>
            {t("album.meta.cover")} {m.cover ? <ResetPinButton onClick={() => resetField("cover")} busy={busy} /> : null}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
            {album?.coverUrl || m.cover ? (
              <img
                src={lib.coverUrl(albumId)}
                alt=""
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8 }}
              />
            ) : (
              <div style={{ width: 96, height: 96, background: "#222", borderRadius: 8 }} />
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,.gif"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setErr("");
                try {
                  await lib.uploadAlbumCover(albumId, file);
                  onRefresh();
                } catch (ex) {
                  setErr(ex.message || t("album.meta.uploadError"));
                }
                setBusy(false);
              }}
            />
            <span className="muted" style={{ fontSize: "0.85rem", width: "100%" }}>
              {t("album.meta.coverUrlHint")}
            </span>
            <input
              type="url"
              value={coverUrlInput}
              onChange={(e) => setCoverUrlInput(e.target.value)}
              placeholder={t("album.meta.coverUrlPlaceholder")}
              disabled={busy}
              style={{ minWidth: 220, flex: "1 1 200px", maxWidth: "100%" }}
            />
            <button
              type="button"
              disabled={busy || !coverUrlInput.trim()}
              onClick={async () => {
                setBusy(true);
                setErr("");
                try {
                  await lib.uploadAlbumCoverFromUrl(albumId, coverUrlInput);
                  setCoverUrlInput("");
                  onRefresh();
                } catch (ex) {
                  let msg = ex.message || t("album.meta.uploadError");
                  if (ex.httpStatus === 502) msg = t("album.meta.coverUrlFetchFailed");
                  if (msg === "bad url" || msg === "json") msg = t("album.meta.coverUrlInvalid");
                  if (msg === "image") msg = t("album.meta.coverUrlNotImage");
                  setErr(msg);
                }
                setBusy(false);
              }}
            >
              {t("album.meta.coverFromUrl")}
            </button>
            {(album?.coverUrl || m.cover) && (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr("");
                  try {
                    await lib.deleteAlbumCover(albumId);
                    onRefresh();
                  } catch (ex) {
                    setErr(ex.message || "Ошибка");
                  }
                  setBusy(false);
                }}
              >
                {t("common.deleteFile")}
              </button>
            )}
          </div>
        </p>
        <p style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" disabled={busy} onClick={save}>
            {t("common.save")}
          </button>
        </p>
      </div>
    </div>
  );
}

function imprintFieldLabel(t, field) {
  const key = `album.imprint.field.${field}`;
  const lbl = t(key);
  return lbl !== key ? lbl : field;
}

// Always listed per track without advanced mode (plus any field that differs from tags).
const IMPRINT_BASIC_FIELDS = new Set(["artist", "title", "album", "year"]);

function ImprintModal({ albumId, onClose }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dry, setDry] = useState(null);
  const [sel, setSel] = useState({}); // trackId -> field -> bool
  const [advanced, setAdvanced] = useState(false);
  // trackId -> field -> edited "after" string (text fields only)
  const [overrides, setOverrides] = useState({});
  const [genreOpts, setGenreOpts] = useState([]);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const [results, setResults] = useState(null);

  useEffect(() => {
    lib
      .libraryGenres(500)
      .then((x) => setGenreOpts(Array.isArray(x) ? x : []))
      .catch(() => setGenreOpts([]));
  }, []);

  const afterStr = (d) => {
    if (!d) return "";
    if (d.after == null) return "";
    return String(d.after);
  };

  const setOverride = (trackId, field, value) => {
    setOverrides((prev) => ({
      ...prev,
      [trackId]: { ...(prev[trackId] || {}), [field]: value },
    }));
  };

  const getOverride = (trackId, field, d) => {
    const v = overrides?.[trackId]?.[field];
    if (typeof v === "string") return v;
    return afterStr(d);
  };

  const visibleDiffs = (tr) => {
    const list = Array.isArray(tr?.diff) ? tr.diff : [];
    if (advanced) return list;
    return list.filter((d) => (d && IMPRINT_BASIC_FIELDS.has(d.field)) || !!d?.changed);
  };

  const defaultSelectionForTrack = (tr, adv, albumHasStoredCover) => {
    const m = {};
    for (const it of Array.isArray(tr?.diff) ? tr.diff : []) {
      if (!it?.supported) continue;
      const imprintCoverDefault = !adv && albumHasStoredCover && it.field === "cover";
      if (adv || it.changed || imprintCoverDefault) {
        m[it.field] = true;
      }
    }
    return m;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      setResults(null);
      try {
        const d = await lib.albumImprintDryRun(albumId);
        if (cancelled) return;
        setDry(d);
        const ah = !!d.albumHasStoredCover;
        const nextSel = {};
        const nextOv = {};
        for (const tr of Array.isArray(d?.tracks) ? d.tracks : []) {
          // Include cover when the album image exists on disk (embed into files by default).
          nextSel[tr.trackId] = defaultSelectionForTrack(tr, false, ah);
          const o = {};
          for (const it of Array.isArray(tr?.diff) ? tr.diff : []) {
            if (!it?.field) continue;
            o[it.field] = afterStr(it);
          }
          nextOv[tr.trackId] = o;
        }
        setSel(nextSel);
        setOverrides(nextOv);
      } catch (e) {
        if (!cancelled) setErr(e.message || "Ошибка dry-run");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  useEffect(() => {
    if (!dry?.tracks) return;
    const ah = !!dry.albumHasStoredCover;
    setSel((prev) => {
      const next = { ...prev };
      for (const tr of dry.tracks) {
        next[tr.trackId] = defaultSelectionForTrack(tr, advanced, ah);
      }
      return next;
    });
  }, [advanced, dry]);

  const toggle = (trackId, field) => {
    setSel((s) => ({ ...s, [trackId]: { ...(s[trackId] || {}), [field]: !(s?.[trackId]?.[field]) } }));
  };

  const apply = async () => {
    if (!dry?.tracks?.length) {
      setErr("Нет треков");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const tracks = [];
      for (const tr of dry.tracks) {
        const m = sel?.[tr.trackId] || {};
        const fields = Object.entries(m)
          .filter(([, v]) => !!v)
          .map(([k]) => k);
        if (!fields.length) continue;

        const ov = {};
        const o = overrides?.[tr.trackId] || {};
        const pickStr = (field) => {
          const v = o?.[field];
          return typeof v === "string" ? v : "";
        };

        const wants = (f) => fields.includes(f);
        if (wants("title")) ov.title = pickStr("title");
        if (wants("artist")) ov.artist = pickStr("artist");
        if (wants("album")) ov.album = pickStr("album");
        if (wants("albumArtist")) ov.albumArtist = pickStr("albumArtist");
        if (wants("genre")) ov.genre = pickStr("genre");
        if (wants("composer")) ov.composer = pickStr("composer");
        if (wants("comment")) ov.comment = pickStr("comment");

        if (wants("year")) {
          const s = pickStr("year").trim();
          if (!s) {
            // explicit JSON null (clear) — avoid Go omitempty dropping the field
            ov.year = null;
          } else {
            const y = parseInt(s, 10);
            if (!Number.isFinite(y)) throw new Error("Некорректный year");
            ov.year = y;
          }
        }
        if (wants("trackNo")) {
          const s = pickStr("trackNo").trim();
          if (!s) {
            ov.trackNo = null;
          } else {
            const n = parseInt(s, 10);
            if (!Number.isFinite(n)) throw new Error("Некорректный trackNo");
            ov.trackNo = n;
          }
        }
        if (wants("discNo")) {
          const s = pickStr("discNo").trim();
          if (!s) {
            ov.discNo = null;
          } else {
            const n = parseInt(s, 10);
            if (!Number.isFinite(n)) throw new Error("Некорректный discNo");
            ov.discNo = n;
          }
        }

        tracks.push({
          trackId: tr.trackId,
          fields,
          overrides: Object.keys(ov).length ? ov : undefined,
        });
      }
      if (!tracks.length) throw new Error("Ничего не выбрано");
      const r = await lib.albumImprintApply(albumId, { confirm: true, tracks });
      setJobId(r?.jobId || "");
    } catch (e) {
      setErr(e.message || "Ошибка imprint");
    }
    setBusy(false);
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setResults(null);
    setJob(null);
    const tick = async () => {
      try {
        const j = await lib.job(jobId);
        if (cancelled) return;
        setJob(j);
        if (j?.status === "done" || j?.status === "failed") {
          if (j?.result) setResults(j.result);
          return true;
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Ошибка статуса job");
        return true;
      }
      return false;
    };
    tick();
    const tmr = setInterval(async () => {
      const done = await tick();
      if (done) clearInterval(tmr);
    }, 800);
    return () => {
      cancelled = true;
      clearInterval(tmr);
    };
  }, [jobId]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        style={{
          maxWidth: 1100,
          width: "min(1100px, 96vw)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Imprint metadata</h3>
        <p className="muted" style={{ marginTop: "-0.5rem" }}>
          {t("album.imprint.intro")}
        </p>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        {!loading ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(!!e.target.checked)} disabled={busy || !!jobId} />
            <span>
              <strong>{t("album.imprint.advanced")}</strong>
              <span className="muted" style={{ display: "block", fontSize: "0.85rem", marginTop: 2 }}>
                {t("album.imprint.advancedHint")}
              </span>
            </span>
          </label>
        ) : null}
        {loading ? (
          <p className="muted">Загрузка…</p>
        ) : (
          <>
            {jobId ? (
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>Job</strong>
                  <span className="muted" style={{ fontSize: "0.9rem" }}>
                    {jobId}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Статус: {job?.status || "…"}
                  {typeof job?.progressDone === "number" && typeof job?.progressTotal === "number"
                    ? ` · ${job.progressDone}/${job.progressTotal}`
                    : ""}
                  {job?.progressMsg ? ` · ${job.progressMsg}` : ""}
                </div>
                {typeof job?.progressDone === "number" && typeof job?.progressTotal === "number" && job.progressTotal > 0 ? (
                  <div style={{ marginTop: 8, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999 }}>
                    <div
                      style={{
                        height: 8,
                        width: `${Math.min(100, Math.max(0, Math.round((job.progressDone / job.progressTotal) * 100)))}%`,
                        background: "rgba(255,255,255,0.35)",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                ) : null}
                {job?.lastError ? <div style={{ color: "tomato", marginTop: 8 }}>{job.lastError}</div> : null}
              </div>
            ) : null}
            <div
              style={{
                maxHeight: "55vh",
                overflowY: "auto",
                overflowX: "hidden",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
              }}
            >
              {(dry?.tracks || []).map((tr) => (
                <div key={tr.trackId} style={{ padding: 12, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "0.95rem" }}>{tr.fileName}</strong>
                    <span className="muted" style={{ fontSize: "0.85rem" }}>{tr.format}</span>
                  </div>
                  {Array.isArray(tr.warnings) && tr.warnings.length ? (
                    <div className="muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
                      {tr.warnings.join(" · ")}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    {visibleDiffs(tr).map((d) => {
                      const isCover = String(d.field) === "cover";
                      const disabledRow = busy || !d.supported || !!jobId;
                      const afterVal = getOverride(tr.trackId, d.field, d);
                      return (
                        <div
                          key={d.field}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "22px 140px minmax(0, 1fr) minmax(0, 1fr)",
                            gap: 8,
                            alignItems: "start",
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={disabledRow}
                            checked={!!(sel?.[tr.trackId]?.[d.field]) && !!d.supported}
                            onChange={() => toggle(tr.trackId, d.field)}
                          />
                          <div className="muted" style={{ paddingTop: 6 }}>
                            {imprintFieldLabel(t, d.field)}
                            {isCover ? (
                              <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4, lineHeight: 1.25 }}>
                                {t("album.imprint.coverEditHint")}
                              </div>
                            ) : null}
                          </div>
                          <div
                            style={{
                              opacity: d.changed ? 1 : 0.75,
                              minWidth: 0,
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              paddingTop: 6,
                            }}
                          >
                            {d.before ?? "—"}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            {d.supported && !isCover ? (
                              d.field === "genre" ? (
                                <GenreSuggestInput
                                  datalistId="imprint-genre-suggestions"
                                  suggestions={genreOpts}
                                  value={afterVal}
                                  onChange={(v) => setOverride(tr.trackId, d.field, v)}
                                  disabled={disabledRow || !sel?.[tr.trackId]?.[d.field]}
                                />
                              ) : (
                                <input
                                  value={afterVal}
                                  disabled={disabledRow || !sel?.[tr.trackId]?.[d.field]}
                                  onChange={(e) => setOverride(tr.trackId, d.field, e.target.value)}
                                />
                              )
                            ) : (
                              <div
                                style={{
                                  opacity: d.changed ? 1 : 0.75,
                                  minWidth: 0,
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                  paddingTop: 6,
                                }}
                              >
                                {d.after ?? "—"}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {results?.results ? (
              <div style={{ marginTop: 12 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Результаты</h4>
                <div className="muted" style={{ fontSize: "0.9rem" }}>
                  {results.results.map((r) => (
                    <div key={r.trackId}>
                      {r.fileName}: {r.error ? `ошибка: ${r.error}` : "ok"}
                      {Array.isArray(r.warnings) && r.warnings.length ? ` (${r.warnings.join("; ")})` : ""}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Закрыть
          </button>
          <button type="button" onClick={apply} disabled={busy || loading || !!jobId}>
            Apply imprint
          </button>
        </div>
      </div>
    </div>
    ,
    document.body
  );
}

function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortTracks(list, key, dir) {
  const a = Array.isArray(list) ? list.slice() : [];
  const mult = dir === "desc" ? -1 : 1;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const get = (t) => {
    if (key === "title") return (t?.title || "").toString();
    if (key === "artist") return (t?.artist?.name || "").toString();
    return "";
  };
  return a
    .map((t, i) => ({ t, i }))
    .sort((x, y) => {
      const ax = get(x.t);
      const ay = get(y.t);
      const r = coll.compare(ax, ay);
      return r !== 0 ? r * mult : (x.i - y.i);
    })
    .map((x) => x.t);
}

export function Album() {
  const { t } = useI18n();
  const { id } = useParams();
  const [tr, setTr] = useState([]);
  const [a, setA] = useState(null);
  const [editAlbum, setEditAlbum] = useState(false);
  const [imprintOpen, setImprintOpen] = useState(false);
  const [liked, setLiked] = useState(new Set());
  const [sortKey, setSortKey] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
  const p = usePlayer();
  const load = () => {
    lib
      .tracks("", id)
      .then((x) => setTr(Array.isArray(x) ? x : []))
      .catch(() => setTr([]));
    lib
      .album(id)
      .then(setA)
      .catch(() => setA(null));
    lib
      .likeIds()
      .then((r) => setLiked(new Set(Array.isArray(r?.trackIds) ? r.trackIds : [])))
      .catch(() => setLiked(new Set()));
  };
  useEffect(() => {
    load();
  }, [id]);

  const sortedTracks = sortTracks(tr, sortKey, sortDir);

  const playAt = (startIdx) => {
    // Playback order should follow album track order (unsorted).
    if (!tr.length) return;
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    }));
    const raw = typeof startIdx === "number" && Number.isFinite(startIdx) ? startIdx : 0;
    const idx = Math.max(0, Math.min(items.length - 1, raw));
    const it = items[idx];
    p.playQueue(items, idx);
    // iOS Safari: call play() from the click handler for guaranteed first tap.
    try {
      const el = p.ref.current;
      if (el && it?.url) {
        if (el.src !== it.url) el.src = it.url;
        const pr = el.play?.();
        if (pr && typeof pr.catch === "function") pr.catch(() => {});
      }
    } catch (_) {}
  };

  const shuffle = () => {
    const items = tr.map((t) => ({
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    }));
    const shuffled = shuffleCopy(items);
    if (shuffled.length) p.playQueue(shuffled, 0);
  };

  const playNext = (t) => {
    const item = {
      id: t.id,
      label: (t.artist ? t.artist.name + " — " : "") + (t.title || t("common.track")),
      url: lib.streamUrl(t.id),
      artist: t.artist?.name || "",
      title: t.title || t("common.track"),
      album: t.album?.title || "",
      coverUrl: effectiveTrackCoverUrl(t),
    };
    if (!p.current) {
      p.playQueue([item], 0);
      return;
    }
    p.playNext(item);
  };
  const toggleLike = async (trackId) => {
    const on = liked.has(trackId);
    try {
      if (on) await lib.unlike(trackId);
      else await lib.like(trackId);
      const next = new Set(liked);
      if (on) next.delete(trackId);
      else next.add(trackId);
      setLiked(next);
    } catch (_) {}
  };
  return (
    <div>
      <p>
        <Link to="/" className="muted">
          ← {t("nav.home")}
        </Link>
      </p>
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", minWidth: 0 }}>
        {a?.coverUrl ? (
          <img
            src={lib.coverUrl(a.id)}
            alt=""
            style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8 }}
          />
        ) : (
          <div style={{ width: 120, height: 120, background: "#222" }} />
        )}
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>
            {a?.title || t("album.editTitle")}
            {a?.year != null ? (
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                ({a.year})
              </span>
            ) : null}
          </h2>
          <div className="muted">{a?.artistName}</div>
          {Array.isArray(a?.genres) && a.genres.length ? (
            <div className="muted" style={{ marginTop: 4 }}>
              {a.genres.join(" · ")}
            </div>
          ) : null}
        </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {getToken() ? (
            <button type="button" className="ghost" onClick={() => setEditAlbum(true)}>
              {t("album.editButton")}
            </button>
          ) : null}
          {getToken() ? (
            <button type="button" className="ghost" onClick={() => setImprintOpen(true)}>
              Imprint metadata
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={shuffle} disabled={!tr.length} title={t("tracks.shuffle")}>
            {t("tracks.shuffle")}
          </button>
        </div>
      </div>
      {editAlbum && a ? (
        <AlbumMetaModal albumId={id} album={a} onClose={() => setEditAlbum(false)} onRefresh={load} />
      ) : null}
      {imprintOpen ? <ImprintModal albumId={id} onClose={() => setImprintOpen(false)} /> : null}
      <ul className="plain-list">
        <TrackHeader
          columns="album"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(k) => {
            if (k === "album") return;
            if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            else {
              setSortKey(k);
              setSortDir("asc");
            }
          }}
        />
        {sortedTracks.map((t) => (
          <TrackRow
            key={t.id}
            track={t}
            index={0}
            onPlayAt={() => {
              const idx = tr.findIndex((x) => x.id === t.id);
              playAt(Math.max(0, idx));
            }}
            onPlayNext={(trk) => playNext(trk)}
            isLiked={liked.has(t.id)}
            onToggleLike={(id2) => toggleLike(id2)}
            label={`${t.trackNo != null ? t.trackNo + ". " : ""}${t.title || t("common.untitled")}`}
            isNowPlaying={p.current?.id === t.id}
            isPlaying={p.isPlaying}
            columns="album"
            onMetaSaved={load}
          />
        ))}
      </ul>
    </div>
  );
}
