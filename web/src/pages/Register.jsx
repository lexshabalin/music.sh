import { useState } from "react";
import { Link } from "react-router-dom";
import { auth, setToken } from "../api";

export function Register() {
  const [username, setU] = useState("");
  const [email, setE] = useState("");
  const [pw, setP] = useState("");
  const [name, setN] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await auth.register(username, email, pw, name);
      setToken(r.accessToken);
      window.location.hash = "#/";
    } catch (x) {
      setErr(x.message);
    }
  };
  return (
    <form onSubmit={submit} className="card" style={{ maxWidth: 360, margin: "2rem auto" }}>
      <h2>Register</h2>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <p>
        <label>Username</label>
        <input
          value={username}
          onChange={(e) => setU(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="e.g. rh"
          required
        />
      </p>
      <p>
        <label>Display name (optional)</label>
        <input value={name} onChange={(e) => setN(e.target.value)} />
      </p>
      <p>
        <label>Email</label>
        <input value={email} onChange={(e) => setE(e.target.value)} type="email" required />
      </p>
      <p>
        <label>Password (8+)</label>
        <input value={pw} onChange={(e) => setP(e.target.value)} type="password" minLength={8} required />
      </p>
      <button type="submit">Create account</button>
      <p className="muted">
        <Link to="/login">Back to login</Link>
      </p>
    </form>
  );
}
