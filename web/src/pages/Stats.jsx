import React from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";

/** Placeholder listening-stats page; filled in later. */
export function Stats() {
  const { t } = useI18n();
  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link to="/" className="muted">
          ← {t("nav.home")}
        </Link>
      </p>
      <h2 className="home-page-title" style={{ marginTop: 0 }}>
        {t("stats.title")}
      </h2>
      <p className="muted">{t("stats.placeholder")}</p>
    </div>
  );
}
