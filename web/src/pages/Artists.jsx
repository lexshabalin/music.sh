import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { useI18n } from "../i18n";

export function Artists() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      lib
        .artists(q)
        .then((x) => {
          setErr("");
          setList(Array.isArray(x) ? x : []);
        })
        .catch((e) => setErr(e.message || "error"));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const sortedArtists = useMemo(() => {
    const arr = Array.isArray(list) ? list.slice() : [];
    return arr.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" }));
  }, [list]);

  return (
    <div>
      <div className="search">
        <input placeholder={t("artists.searchArtists")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <div className="grid">
        {sortedArtists.map((a) => (
          <Link key={a.id} to={"/artist/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 92, justifyContent: "center" }}>
              <div style={{ fontWeight: 900, fontSize: "1.02rem", letterSpacing: 0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.name}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t("artists.albumsArrow")}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

