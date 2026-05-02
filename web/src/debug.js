import { appendDebugFeed, debugFeedIsAppending } from "./debugFeed";

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

  const joinArgs = (args) => {
    try {
      return args
        .map((x) => {
          if (typeof x === "string") return x;
          if (x instanceof Error) return x.stack || x.message;
          try {
            return JSON.stringify(x);
          } catch (_) {
            return String(x);
          }
        })
        .join(" ");
    } catch (_) {
      return String(args);
    }
  };

  window.addEventListener("error", (e) => {
    console.error("[MusicSH][error]", e?.message, e?.error);
    appendDebugFeed({
      level: "error",
      tag: "window",
      message: e?.message || "window error",
      detail: fmt(e?.error || e?.message),
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    console.error("[MusicSH][unhandledrejection]", e?.reason);
    appendDebugFeed({
      level: "error",
      tag: "promise",
      message: "Unhandled promise rejection",
      detail: fmt(e?.reason),
    });
  });

  const origErr = console.error.bind(console);
  console.error = (...args) => {
    origErr(...args);
    if (debugFeedIsAppending()) return;
    appendDebugFeed({
      level: "error",
      tag: "console.error",
      message: joinArgs(args).slice(0, 4000),
    });
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    origWarn(...args);
    if (debugFeedIsAppending()) return;
    appendDebugFeed({
      level: "warn",
      tag: "console.warn",
      message: joinArgs(args).slice(0, 4000),
    });
  };

  console.info("[MusicSH] debug logging installed (console + feed)");
}
