import React, { useEffect, useMemo, useState } from "react";
import { clearDebugFeed, subscribeDebugFeed } from "../debugFeed";
import { useI18n } from "../i18n";

function BugIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 10V8a4 4 0 0 1 8 0v2" strokeLinecap="round" />
      <path d="M4 12h3l-1 5h4M20 12h-3l1 5h-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 5v3M9 4l1.5 2M15 4l-1.5 2" strokeLinecap="round" />
      <path d="M10 17h4" strokeLinecap="round" />
    </svg>
  );
}

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return "";
  }
}

export function DebugLogPanel({ abovePlayer }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => subscribeDebugFeed(setItems), []);

  const errorish = useMemo(() => items.some((e) => e.level === "error" || e.level === "warn"), [items]);

  return (
    <>
      <button
        type="button"
        className={
          "debug-log-fab ghost" + (abovePlayer ? " debug-log-fab--above-player" : "") + (errorish ? " debug-log-fab--has-warn" : "")
        }
        aria-label={t("debug.fabAria")}
        aria-expanded={open}
        title={t("debug.fabTitle")}
        onClick={() => setOpen((v) => !v)}
      >
        <BugIcon />
        {items.length > 0 ? (
          <span className="debug-log-fab__badge" aria-hidden="true">
            {items.length > 99 ? "99+" : items.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <div className="debug-log-scrim" role="presentation" onClick={() => setOpen(false)} />
          <div
            className={"debug-log-panel" + (abovePlayer ? " debug-log-panel--above-player" : "")}
            role="dialog"
            aria-label={t("debug.title")}
          >
            <div className="debug-log-panel__head">
              <h3 className="debug-log-panel__title">{t("debug.title")}</h3>
              <div className="debug-log-panel__actions">
                <button type="button" className="ghost" onClick={() => clearDebugFeed()}>
                  {t("debug.clear")}
                </button>
                <button type="button" className="ghost" onClick={() => setOpen(false)}>
                  {t("debug.close")}
                </button>
              </div>
            </div>
            <p className="debug-log-panel__hint muted">{t("debug.hint")}</p>
            <div className="debug-log-panel__scroll" tabIndex={0}>
              {[...items]
                .slice()
                .reverse()
                .map((e, i) => (
                  <div
                    key={`${e.ts}-${i}`}
                    className={
                      "debug-log-line" +
                      (e.level === "error" ? " debug-log-line--error" : "") +
                      (e.level === "warn" ? " debug-log-line--warn" : "")
                    }
                  >
                    <div className="debug-log-line__meta">
                      <span className="debug-log-line__time">{fmtTime(e.ts)}</span>
                      {e.tag ? (
                        <span className="debug-log-line__tag muted">
                          [{e.tag}]
                        </span>
                      ) : null}
                      {e.level && e.level !== "info" ? (
                        <span className={`debug-log-line__lvl debug-log-line__lvl--${e.level}`}>{e.level}</span>
                      ) : null}
                    </div>
                    <div className="debug-log-line__msg">{e.message}</div>
                    {e.detail ? (
                      <pre className="debug-log-line__detail">{e.detail}</pre>
                    ) : null}
                  </div>
                ))}
              {!items.length ? <div className="muted debug-log-empty">{t("debug.empty")}</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
