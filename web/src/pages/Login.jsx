import { useState } from "react";
import { Link } from "react-router-dom";
import { auth, setToken } from "../api";
import { useI18n } from "../i18n";

export function Login() {
  const { t } = useI18n();
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
      <h2>{t("auth.login")}</h2>
      {err ? <p style={{ color: "tomato" }}>{err}</p> : null}
      <p>
        <label>{t("auth.usernameOrEmail")}</label>
        <input value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" autoCorrect="off" required />
      </p>
      <p>
        <label>{t("auth.password")}</label>
        <input value={pw} onChange={(e) => setP(e.target.value)} type="password" required />
      </p>
      <button type="submit">{t("auth.login")}</button>
      <p className="muted">
        {t("auth.noAccount")} <Link to="/register">{t("auth.register")}</Link>
      </p>
    </form>
  );
}
