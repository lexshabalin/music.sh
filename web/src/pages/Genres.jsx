import React from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { useI18n } from "../i18n";

export function Genres() {
  const { t } = useI18n();
  const [list, setList] = React.useState([]);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    lib
      .libraryGenresCatalog(500)
      .then((x) => {
        setErr("");
        setList(Array.isArray(x) ? x : []);
      })
      .catch((e) => {
        setErr(e?.message || "error");
        setList([]);
      });
  }, []);

  return (
    <div>
      <p style={{ marginBottom: 12 }}>
        <Link to="/" className="muted">
          ← {t("nav.home")}
        </Link>
      </p>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>{t("nav.genres")}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {t("genres.browseIntro")}
        </p>
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {!err && !list.length ? <p className="muted">{t("genres.emptyLibrary")}</p> : null}
      <ul className="plain-list">
        {list.map((g) => (
          <li key={g.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--glass-border)" }}>
            <Link to={"/genre/" + g.id} style={{ fontWeight: 600 }}>
              {g.label}
            </Link>
            {typeof g.trackCount === "number" ? (
              <span className="muted" style={{ marginLeft: 8, fontSize: "0.9rem" }}>
                ({g.trackCount})
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
