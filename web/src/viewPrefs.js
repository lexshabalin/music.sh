import React from "react";

const LS_KEY = "musicsh_view_prefs_v1";

export const SECTIONS = /** @type {const} */ ([
  "home",
  "songs",
  "artists",
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
  albums: "grid",
  genres: "grid",
  playlists: "grid",
  likes: "table",
};

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
  if (s === "songs" || s === "likes") return ["table", "grid"];
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

export function readViewPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const def = { ...DEFAULT_VIEW_BY_SECTION };
      // Write defaults once so Profile can show consistent persisted state.
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(def));
      } catch (_) {}
      return def;
    }
    const obj = JSON.parse(raw);
    const out = { ...DEFAULT_VIEW_BY_SECTION };
    let changed = false;
    for (const s of SECTIONS) {
      const v = coerceModeForSection(s, obj?.[s]);
      if (out[s] !== v) changed = true;
      out[s] = v;
    }
    // Persist migration (removes split/list from old installs).
    if (changed) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(out));
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
    const out = { ...cur };
    for (const s of SECTIONS) {
      const v = coerceModeForSection(s, next?.[s]);
      out[s] = v;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(out));
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

  React.useEffect(() => {
    setMode(getSectionViewMode(s));
  }, [s]);

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

