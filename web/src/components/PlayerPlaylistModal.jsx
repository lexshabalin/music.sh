import { useEffect, useState } from "react";
import { lib } from "../api";
import { useI18n } from "../i18n";

export function PlayerPlaylistModal({ trackId, onClose }) {
  const { t } = useI18n();
  const [pls, setPls] = useState([]);
  const [sel, setSel] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    lib
      .playlists()
      .then((x) => setPls(Array.isArray(x) ? x : []))
      .catch(() => setPls([]));
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{t("plmodal.title")}</h3>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

        <p className="muted">{t("plmodal.help")}</p>

        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <label className="muted">{t("plmodal.existing")}</label>
          <select
            value={sel}
            onChange={(e) => setSel(e.target.value)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "#12121a",
              color: "var(--text)",
            }}
          >
            <option value="">{t("plmodal.select")}</option>
            {pls.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              disabled={busy || !sel}
              onClick={async () => {
                setBusy(true);
                setErr("");
                try {
                  await lib.addToPl(sel, trackId);
                  onClose();
                } catch (e) {
                  setErr(e.message || "error");
                }
                setBusy(false);
              }}
            >
              {t("plmodal.add")}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 10 }}>
          <label className="muted">{t("plmodal.new")}</label>
          <p style={{ marginTop: 10 }}>
            <label>{t("plmodal.name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("plmodal.myPlaylist")} />
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ghost" type="button" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setErr("");
                try {
                  const pl = await lib.createPl(name.trim());
                  await lib.addToPl(pl.id, trackId);
                  onClose();
                } catch (e) {
                  setErr(e.message || "error");
                }
                setBusy(false);
              }}
            >
              {t("plmodal.createAdd")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

