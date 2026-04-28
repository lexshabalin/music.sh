import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { IHeart } from "./icons";

function fmtDur(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function TrackRow({
  track,
  index,
  onPlayAt,
  onPlayNext,
  isLiked,
  onToggleLike,
  label,
  isNowPlaying,
  isPlaying,
}) {
  const [open, setOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const btnRef = useRef(null);

  const metaParts = [];
  if (track?.format) metaParts.push(String(track.format).toUpperCase());
  if (typeof track?.bitrateKbps === "number") metaParts.push(`${track.bitrateKbps} kbps`);
  const d = fmtDur(track?.durationMs);
  if (d) metaParts.push(d);

  return (
    <>
      <li className={`track-row${isNowPlaying ? " track-row--now" : ""}${isNowPlaying && isPlaying ? " track-row--playing" : ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="track-title"
            role="button"
            tabIndex={0}
            onClick={() => onPlayAt(index)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onPlayAt(index);
            }}
          >
            {isNowPlaying ? (
              <span className="np-eq" aria-hidden="true">
                <span className="np-eq__bar" />
                <span className="np-eq__bar" />
                <span className="np-eq__bar" />
              </span>
            ) : (
              <span className="np-eq np-eq--off" aria-hidden="true" />
            )}
            <span className="track-title-text">{label}</span>
          </span>
          <div className="muted" style={{ fontSize: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {track?.artist?.id ? (
              <Link to={"/artist/" + track.artist.id} className="muted" style={{ textDecoration: "none" }}>
                {track.artist.name || "Unknown Artist"}
              </Link>
            ) : track?.artist?.name ? (
              <span>{track.artist.name}</span>
            ) : null}
            {metaParts.length ? <span>{metaParts.join(" · ")}</span> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {typeof onToggleLike === "function" ? (
            <button
              className="ghost"
              type="button"
              onClick={() => onToggleLike(track.id)}
              title="Like"
              style={{
                color: isLiked ? "tomato" : undefined,
                borderColor: isLiked ? "tomato" : undefined,
              }}
            >
              <IHeart />
            </button>
          ) : null}
          <button
            className="ghost"
            type="button"
            ref={btnRef}
            onClick={() => setOpen((v) => !v)}
            title="More"
          >
            ⋯
          </button>
        </div>
      </li>
      {open ? (
        <Menu
          anchorRef={btnRef}
          onClose={() => setOpen(false)}
          onPlayNow={() => {
            onPlayAt(index);
            setOpen(false);
          }}
          onPlayNext={() => {
            setShowAdd(false);
            setOpen(false);
            onPlayNext(track, index);
          }}
          onAddToPlaylist={() => {
            setShowAdd(true);
            setOpen(false);
          }}
        />
      ) : null}
      {showAdd ? (
        <AddToPlaylistModal
          trackId={track.id}
          onClose={() => setShowAdd(false)}
        />
      ) : null}
    </>
  );
}

function Menu({ anchorRef, onClose, onPlayNow, onPlayNext, onAddToPlaylist }) {
  useEffect(() => {
    const onDoc = (e) => {
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [onClose, anchorRef]);

  const r = anchorRef.current?.getBoundingClientRect?.();
  const style = r
    ? {
        position: "fixed",
        top: r.bottom + 6,
        left: Math.min(window.innerWidth - 240, r.left - 160),
        width: 220,
        background: "#18181f",
        border: "1px solid #2a2a33",
        borderRadius: 10,
        padding: 6,
        zIndex: 999,
      }
    : {};

  return (
    <div style={style} role="menu" aria-label="Track actions">
      <MenuItem onClick={onPlayNow}>Play now</MenuItem>
      <MenuItem onClick={onPlayNext}>Play next</MenuItem>
      <MenuItem onClick={onAddToPlaylist}>Add to playlist</MenuItem>
    </div>
  );
}

function MenuItem({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      className="ghost"
      onClick={disabled ? undefined : onClick}
      style={{
        width: "100%",
        justifyContent: "flex-start",
        display: "flex",
        padding: "8px 10px",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function AddToPlaylistModal({ trackId, onClose }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Add to playlist</h3>
        {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
        <p className="muted">Create a new playlist and add this track.</p>
        <p>
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
  );
}

