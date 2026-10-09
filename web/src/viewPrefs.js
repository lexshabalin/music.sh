import React from "react";

const LS_KEY_BASE = "musicsh_view_prefs_v1";
/** Legacy single-browser key (pre per-user). Migrated once into the current user's bucket. */
const LS_KEY_LEGACY = LS_KEY_BASE;
// Same key as api.js `LS` — read here so this module stays free of api import cycles.
const TOKEN_LS = "musicsh_token";

function readAccessToken() {
  try {
    return localStorage.getItem(TOKEN_LS) || "";
  } catch (_) {
    return "";
  }
}

export const SECTIONS = /** @type {const} */ ([
  "home",
  "songs",
  "artists",
  "artist",
  "albums",
  "genres",
  "playlists",
  "likes",
]);

export const VIEW_MODES = /** @type {const} */ ([
  "grid", // tiles
  "table", // track table / plain table-like list
]);

export const DEFAULT_VIEW_BY_SECTION = {
  home: "grid",
  songs: "table",
  artists: "grid",
  artist: "grid",
  albums: "grid",
  genres: "grid",
  playlists: "grid",
  likes: "table",
};

/** Decode JWT payload `userId` without verifying signature — only for localStorage scoping. */
export function userIdFromAccessToken(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  try {
    const part = t.split(".")[1];
    if (!part) return "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = JSON.parse(atob(b64 + pad));
    const id = json?.userId ?? json?.sub ?? "";
    return id ? String(id) : "";
  } catch (_) {
    return "";
  }
}

function prefsStorageKey() {
  const id = userIdFromAccessToken(readAccessToken());
  return id ? `${LS_KEY_BASE}:${id}` : `${LS_KEY_BASE}:anon`;
}

function normalizeSection(s) {
  const x = String(s || "").trim().toLowerCase();
  return SECTIONS.includes(x) ? x : "home";
}

function normalizeMode(m) {
  const x = String(m || "").trim().toLowerCase();
  return VIEW_MODES.includes(x) ? x : null;
}

export function allowedModesForSection(section) {
  const s = normalizeSection(section);
  if (s === "songs" || s === "artists" || s === "artist" || s === "albums" || s === "playlists" || s === "likes") {
    return ["table", "grid"];
  }
  return ["grid"];
}

function coerceModeForSection(section, mode) {
  const s = normalizeSection(section);
  const m = String(mode || "").trim().toLowerCase();
  const allowed = allowedModesForSection(s);
  if (allowed.includes(m)) return m;
  // Migrate old values (list/split/unknown) to a sane default per section.
  return DEFAULT_VIEW_BY_SECTION[s] || allowed[0] || "grid";
}

function normalizePrefsObject(obj) {
  const out = { ...DEFAULT_VIEW_BY_SECTION };
  for (const s of SECTIONS) {
    out[s] = coerceModeForSection(s, obj?.[s]);
  }
  return out;
}

export function readViewPrefs() {
  const key = prefsStorageKey();
  try {
    let raw = localStorage.getItem(key);
    // One-time migrate pre-user global prefs into this user's bucket.
    if (!raw && key !== LS_KEY_LEGACY) {
      const legacy = localStorage.getItem(LS_KEY_LEGACY);
      if (legacy) {
        raw = legacy;
        try {
          localStorage.setItem(key, legacy);
        } catch (_) {}
      }
    }
    if (!raw) {
      const def = { ...DEFAULT_VIEW_BY_SECTION };
      try {
        localStorage.setItem(key, JSON.stringify(def));
      } catch (_) {}
      return def;
    }
    const obj = JSON.parse(raw);
    const out = normalizePrefsObject(obj);
    let changed = false;
    for (const s of SECTIONS) {
      if (obj?.[s] !== out[s]) changed = true;
    }
    if (changed) {
      try {
        localStorage.setItem(key, JSON.stringify(out));
      } catch (_) {}
    }
    return out;
  } catch (_) {
    return { ...DEFAULT_VIEW_BY_SECTION };
  }
}

export function writeViewPrefs(next) {
  try {
    const cur = readViewPrefs();
    const out = normalizePrefsObject({ ...cur, ...(next || {}) });
    localStorage.setItem(prefsStorageKey(), JSON.stringify(out));
    try {
      window.dispatchEvent(new CustomEvent("musicsh:viewprefs", { detail: out }));
    } catch (_) {}
  } catch (_) {}
}

export function setSectionViewMode(section, mode) {
  const s = normalizeSection(section);
  const m = coerceModeForSection(s, mode);
  const cur = readViewPrefs();
  writeViewPrefs({ ...cur, [s]: m });
}

export function getSectionViewMode(section) {
  const s = normalizeSection(section);
  const cur = readViewPrefs();
  return normalizeMode(cur?.[s]) || DEFAULT_VIEW_BY_SECTION[s] || "grid";
}

export function useSectionViewMode(section) {
  const s = normalizeSection(section);
  const [mode, setMode] = React.useState(() => getSectionViewMode(s));
  const userKey = userIdFromAccessToken(readAccessToken()) || "anon";

  React.useEffect(() => {
    setMode(getSectionViewMode(s));
  }, [s, userKey]);

  React.useEffect(() => {
    const on = () => setMode(getSectionViewMode(s));
    window.addEventListener("storage", on);
    window.addEventListener("musicsh:viewprefs", on);
    return () => {
      window.removeEventListener("storage", on);
      window.removeEventListener("musicsh:viewprefs", on);
    };
  }, [s]);

  const set = React.useCallback(
    (next) => {
      setSectionViewMode(s, next);
      setMode(getSectionViewMode(s));
    },
    [s]
  );

  return { mode, setMode: set };
}
