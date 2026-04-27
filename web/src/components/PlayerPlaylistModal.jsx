import { useEffect, useState } from "react";
import { lib } from "../api";

export function PlayerPlaylistModal({ trackId, onClose }) {
  const [pls, setPls] = useState([]);
  const [sel, setSel] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
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
        <h3 style={{ marginTop: 0 }}>Add to playlist</h3>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}

        <p className="muted">Pick an existing playlist, or create a new one.</p>

        <div className="card" style={{ padding: 10, marginBottom: 10 }}>
          <label className="muted">Existing</label>
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
            <option value="">— Select —</option>
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
              Add
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 10 }}>
          <label className="muted">New playlist</label>
          <p style={{ marginTop: 10 }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My playlist" />
          </p>
          <p>
            <label>Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Optional" />
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setErr("");
                try {
                  const pl = await lib.createPl(name.trim(), desc.trim());
                  await lib.addToPl(pl.id, trackId);
                  onClose();
                } catch (e) {
                  setErr(e.message || "error");
                }
                setBusy(false);
              }}
            >
              Create & add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

