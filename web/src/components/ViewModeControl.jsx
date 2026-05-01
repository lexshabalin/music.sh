import React from "react";
import { useI18n } from "../i18n";
import { VIEW_MODES } from "../viewPrefs";

function labelFor(t, mode) {
  if (mode === "grid") return t("view.grid");
  if (mode === "list") return t("view.list");
  if (mode === "table") return t("view.table");
  if (mode === "split") return t("view.split");
  return mode;
}

function iconFor(mode) {
  if (mode === "grid") return "▦";
  if (mode === "list") return "≡";
  if (mode === "table") return "▤";
  if (mode === "split") return "⎚";
  return "▤";
}

export function ViewModeControl({ value, onChange, modes, compact = false, ariaLabel }) {
  const { t } = useI18n();
  const allowed = Array.isArray(modes) && modes.length ? modes : VIEW_MODES;
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const panelRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const cur = allowed.includes(value) ? value : allowed[0];

  return (
    <div className="viewmode" style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        className="ghost viewmode-btn"
        aria-label={ariaLabel || t("view.aria")}
        title={t("view.title")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="viewmode-icon" aria-hidden="true">
          {iconFor(cur)}
        </span>
        {compact ? null : <span className="viewmode-label">{labelFor(t, cur)}</span>}
      </button>
      {open ? (
        <div ref={panelRef} className="viewmode-menu" role="menu" aria-label={t("view.title")}>
          {allowed.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === cur}
              className={`ghost viewmode-item${m === cur ? " is-active" : ""}`}
              onClick={() => {
                onChange?.(m);
                setOpen(false);
              }}
            >
              <span className="viewmode-icon" aria-hidden="true">
                {iconFor(m)}
              </span>
              <span style={{ flex: 1, textAlign: "left" }}>{labelFor(t, m)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

