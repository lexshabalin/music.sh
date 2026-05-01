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
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("genres.browseIntro")}
      </p>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {!err && !list.length ? <p className="muted">{t("genres.emptyLibrary")}</p> : null}
      <div className="pill-row">
        {list.map((g) => (
          <Link key={g.id} to={"/genre/" + g.id} className="pill">
            <span style={{ fontWeight: 800 }}>{g.label}</span>
            {typeof g.trackCount === "number" ? <span className="muted">({g.trackCount})</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
