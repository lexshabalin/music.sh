import React from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { VIEW_MODES } from "../viewPrefs";

function labelFor(t, mode) {
  if (mode === "grid") return t("view.grid");
  if (mode === "table") return t("view.table");
  return mode;
}

function iconFor(mode) {
  if (mode === "grid") return "▦";
  if (mode === "table") return "▤";
  return "▤";
}

export function ViewModeControl({ value, onChange, modes, compact = false, ariaLabel }) {
  const { t } = useI18n();
  const allowed = Array.isArray(modes) && modes.length ? modes : VIEW_MODES;
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);

  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect?.();
      if (!r) {
        setPos(null);
        return;
      }
      const w = 220;
      const pad = 8;
      const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
      const top = r.bottom + 8;
      setPos({ left, top, width: w });
    };
    place();
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
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const cur = allowed.includes(value) ? value : allowed[0];
  if (!allowed.length || allowed.length <= 1) return null;

  return (
    <div className="viewmode">
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
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              className="viewmode-menu"
              role="menu"
              aria-label={t("view.title")}
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                width: pos.width,
                zIndex: 20000,
              }}
            >
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

