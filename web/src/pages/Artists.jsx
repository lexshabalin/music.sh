import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { lib } from "../api";

export function Artists() {
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

  return (
    <div>
      <div className="search">
        <input placeholder="Search artists…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <ul className="plain-list">
        {list.map((a) => (
          <li key={a.id}>
            <Link to={"/artist/" + a.id} style={{ textDecoration: "none", color: "inherit", flex: 1 }}>
              {a.name}
            </Link>
            <span className="muted">Albums →</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

