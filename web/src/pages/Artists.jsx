import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";
import { useI18n } from "../i18n";

function ArtistCardImage({ artistId }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return <div className="album-art" aria-hidden />;
  }
  return (
    <img
      className="album-art"
      src={lib.artistImageUrl(artistId)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setHidden(true)}
    />
  );
}

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
            <div className="card album-tile" style={{ height: "100%" }}>
              <div className="tile-media">
                <ArtistCardImage artistId={a.id} />
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
    </div>
  );
}
