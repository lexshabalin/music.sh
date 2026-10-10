import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { useI18n } from "../i18n";
import { MediaCover } from "../components/MediaCover";
import { ViewModeControl } from "../components/ViewModeControl";
import { useSectionListCols, useSectionViewMode } from "../viewPrefs";

export function Artists() {
  const { t } = useI18n();
  const { mode, setMode } = useSectionViewMode("artists");
  const { cols, setCols } = useSectionListCols("artists");
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
      <div className="search-row">
        <div className="search" style={{ flex: 1, margin: 0 }}>
          <input placeholder={t("artists.searchArtists")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ViewModeControl
          value={mode}
          onChange={setMode}
          modes={["table", "list", "grid"]}
          columns={cols}
          onColumnsChange={setCols}
          compact
        />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      {mode === "table" ? (
        <ul className="plain-list">
          {sortedArtists.map((a) => (
            <li key={a.id} className="entity-list-row">
              <Link to={"/artist/" + a.id} className="entity-row">
                <MediaCover src={lib.artistImageUrl(a.id)} className="entity-row-art" alt="" loading="lazy" decoding="async" />
                <div className="entity-row-meta">
                  <div className="entity-row-title">{a.name}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : mode === "list" ? (
        <ul className="plain-list entity-list-cols" style={{ "--cols": String(cols) }}>
          {sortedArtists.map((a) => (
            <li key={a.id} className="entity-list-row">
              <Link to={"/artist/" + a.id} className="entity-row">
                <MediaCover src={lib.artistImageUrl(a.id)} className="entity-row-art" alt="" loading="lazy" decoding="async" />
                <div className="entity-row-meta">
                  <div className="entity-row-title">{a.name}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid">
          {sortedArtists.map((a) => (
            <Link key={a.id} to={"/artist/" + a.id} style={{ textDecoration: "none", color: "inherit" }}>
              <div className="card album-tile" style={{ height: "100%" }}>
                <div className="tile-media">
                  <MediaCover src={lib.artistImageUrl(a.id)} className="album-art" alt="" loading="lazy" decoding="async" />
                </div>
                <div className="album-meta">
                  <div className="album-title" style={{ fontWeight: 900, letterSpacing: 0.2 }}>
                    {a.name}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
