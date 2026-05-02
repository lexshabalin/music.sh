import React from "react";

/** Modal for confirming removal of stale library rows from the Postgres DB only (not filesystem). */
export function MissingLibraryItemDialog({ variant, stripCount = 0, onYes, onNo, busy, t }) {
  const title = t("missingFile.title");
  let body;
  if (variant === "stripTracks") {
    body = (
      <p className="muted" style={{ lineHeight: 1.45 }}>
        <span>{t("missingFile.stripLead")}</span>
        <strong style={{ margin: "0 4px", color: "var(--text)" }}>{stripCount}</strong>
        <span>{t("missingFile.stripTail")}</span>
      </p>
    );
  } else {
    const key =
      variant === "album" ? "missingFile.albumBody" : variant === "artist" ? "missingFile.artistBody" : "missingFile.trackBody";
    body = (
      <p className="muted" style={{ lineHeight: 1.45 }}>
        {t(key)}
      </p>
    );
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => (!busy ? onNo() : null)} role="presentation">
      <div
        className="modal"
        style={{ maxWidth: 460 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-library-dlg-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }} id="missing-library-dlg-title">
          {title}
        </h3>
        {body}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 16 }}>
          <button type="button" className="ghost" disabled={busy} onClick={() => (!busy ? onNo() : null)}>
            {t("missingFile.no")}
          </button>
          <button type="button" disabled={busy} onClick={() => (!busy ? onYes() : null)}>
            {t("missingFile.yes")}
          </button>
        </div>
      </div>
    </div>
  );
}
