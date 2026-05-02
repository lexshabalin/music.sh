/** In-memory ring buffer for client-side diagnostics (playback, console, globals). */

const DEFAULT_MAX = 400;
let maxEntries = DEFAULT_MAX;
let entries = [];
const listeners = new Set();
let appendDepth = 0;

/** True while `appendDebugFeed` runs (avoids console patch feedback loops). */
export function debugFeedIsAppending() {
  return appendDepth > 0;
}

/** @typedef {{ ts: number, level?: string, tag?: string, message: string, detail?: string }} DebugFeedEntry */

/**
 * @param {string | Partial<DebugFeedEntry>} line
 */
export function appendDebugFeed(line) {
  appendDepth++;
  try {
    /** @type {DebugFeedEntry} */
    const entry =
      typeof line === "string"
        ? { ts: Date.now(), level: "info", tag: "", message: line, detail: "" }
        : {
            ts: Date.now(),
            level: "info",
            tag: "",
            message: "",
            detail: "",
            ...line,
            message: line.message != null ? String(line.message) : "",
          };
    entries = [...entries, entry].slice(-maxEntries);
    const snap = entries.slice();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch (_) {}
    }
  } finally {
    appendDepth--;
  }
}

export function clearDebugFeed() {
  entries = [];
  for (const fn of listeners) {
    try {
      fn([]);
    } catch (_) {}
  }
}

export function subscribeDebugFeed(fn) {
  listeners.add(fn);
  try {
    fn(entries.slice());
  } catch (_) {}
  return () => listeners.delete(fn);
}

export function getDebugFeedSnapshot() {
  return entries.slice();
}

export function setDebugFeedMax(n) {
  const v = Number(n);
  if (Number.isFinite(v) && v > 10 && v < 10000) maxEntries = Math.floor(v);
}
