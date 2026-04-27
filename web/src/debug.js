export function installDebugLogging() {
  const fmt = (x) => {
    try {
      if (x instanceof Error) return x.stack || x.message;
      if (typeof x === "string") return x;
      return JSON.stringify(x);
    } catch (_) {
      return String(x);
    }
  };

  window.addEventListener("error", (e) => {
    console.error("[MusicSH][error]", e?.message, e?.error);
    renderFatal("JS error", fmt(e?.error || e?.message));
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("[MusicSH][unhandledrejection]", e?.reason);
    renderFatal("Unhandled promise rejection", fmt(e?.reason));
  });

  console.info("[MusicSH] debug logging installed");
}

function renderFatal(title, detail) {
  // Don’t clobber the app if it already rendered an error boundary UI
  const root = document.getElementById("root");
  if (!root) return;
  if (root.dataset.fatal === "1") return;
  root.dataset.fatal = "1";
  root.innerHTML = `
    <div style="max-width:900px;margin:32px auto;padding:16px;border:1px solid #2a2a33;border-radius:10px;background:#18181f;color:#f3f3f4;font-family:system-ui,sans-serif;">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <p style="margin:0 0 12px 0;color:#9a9aa3;">Open DevTools Console for full details.</p>
      <pre style="white-space:pre-wrap;color:tomato;margin:0;">${escapeHtml(detail || "")}</pre>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

