import { useState } from "react";
import { Link } from "react-router-dom";
import { auth, setToken } from "../api";

export function Login() {
  const [email, setE] = useState("");
  const [pw, setP] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await auth.login(email, pw);
      setToken(r.accessToken);
      window.location.hash = "#/";
    } catch (x) {
      setErr(x.message);
    }
  };
  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 360, margin: "2rem auto" }}>
      <h2>Log in</h2>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <p>
        <label>Email</label>
        <input value={email} onChange={(e) => setE(e.target.value)} type="email" required />
      </p>
      <p>
        <label>Password</label>
        <input value={pw} onChange={(e) => setP(e.target.value)} type="password" required />
      </p>
      <button type="submit">Log in</button>
      <p className="muted">
        No account? <Link to="/register">Register</Link>
      </p>
    </form>
  );
}
