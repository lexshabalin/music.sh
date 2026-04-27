import { useState } from "react";
import { Link } from "react-router-dom";
import { auth, setToken } from "../api";

export function Login() {
  const [login, setLogin] = useState("");
  const [pw, setP] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await auth.login(login, pw);
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
        <label>Username or email</label>
        <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
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
