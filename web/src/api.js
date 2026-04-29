const LS = "musicsh_token";
export const getToken = () => {
  try {
    return localStorage.getItem(LS) || "";
  } catch (_) {
    return "";
  }
};
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(LS, t);
    else localStorage.removeItem(LS);
  } catch (_) {}
};
export const clearToken = () => setToken("");

const base = () => "";

async function req(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch(base() + path, { ...opts, headers });
  if (r.status === 401 && !path.startsWith("/api/auth")) {
    clearToken();
    window.location.hash = "#/login";
    throw new Error("unauthorized");
  }
  if (!r.ok) {
    let msg = "error";
    try {
      const j = await r.json();
      if (j.error) msg = j.error;
    } catch (_) {}
    const err = new Error(msg);
    err.httpStatus = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type");
  if (ct && ct.includes("application/json")) return r.json();
  return r;
}

export const auth = {
  register: (username, email, password, name) =>
    req("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password, displayName: name || undefined }),
    }),
  login: (login, password) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ login, password }) }),
  me: () => req("/api/me"),
  changePassword: (currentPassword, newPassword) =>
    req("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  avatar: async () => {
    const t = getToken();
    const r = await fetch(base() + "/api/me/avatar", { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error("avatar");
    return r.blob();
  },
  uploadAvatar: async (file) => {
    const t = getToken();
    const fd = new FormData();
    fd.append("avatar", file);
    const r = await fetch(base() + "/api/me/avatar", {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    });
    if (!r.ok) {
      let msg = "error";
      try {
        const j = await r.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    return r.json().catch(() => ({}));
  },
  backgroundSettings: () => req("/api/me/background/settings"),
  setBackgroundPreset: (preset) =>
    req("/api/me/background/settings", { method: "POST", body: JSON.stringify({ type: preset ? "preset" : "none", preset: preset || "" }) }),
  clearBackground: () => req("/api/me/background/settings", { method: "POST", body: JSON.stringify({ type: "none" }) }),
  uploadBackground: async (file) => {
    const t = getToken();
    const fd = new FormData();
    fd.append("background", file);
    const r = await fetch(base() + "/api/me/background/upload", {
      method: "POST",
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: fd,
    });
    if (!r.ok) {
      let msg = "error";
      try {
        const j = await r.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    return r.json().catch(() => ({}));
  },
};

export const lib = {
  artists: (q) => req("/api/artists?" + new URLSearchParams({ query: q || "" })),
  albums: (q, artistId) => req("/api/albums?" + new URLSearchParams({ query: q || "", ...(artistId && { artistId }) })),
  album: (id) => req("/api/albums/" + id),
  tracks: (q, albumId) => req("/api/tracks?" + new URLSearchParams({ query: q || "", ...(albumId && { albumId }) })),
  track: (id) => req("/api/tracks/" + id),
  scan: () => req("/api/library/scan", { method: "POST", body: "{}" }),
  scanStatus: () => req("/api/library/scan/status"),
  streamUrl: (id) => {
    // Audio tag requests cannot send Authorization headers; pass token via query param.
    const t = getToken();
    return base() + "/api/tracks/" + id + "/stream" + (t ? "?token=" + encodeURIComponent(t) : "");
  },
  coverUrl: (id) => {
    // Image requests cannot send Authorization headers; pass token via query param.
    const t = getToken();
    return base() + "/api/albums/" + id + "/cover" + (t ? "?token=" + encodeURIComponent(t) : "");
  },
  playlists: (q) => req("/api/playlists?" + new URLSearchParams({ query: q || "" })),
  playlist: (id) => req("/api/playlists/" + id),
  createPl: (name, description) =>
    req("/api/playlists", { method: "POST", body: JSON.stringify({ name, description: description || undefined }) }),
  addToPl: (plId, trackId) => req("/api/playlists/" + plId + "/tracks", { method: "POST", body: JSON.stringify({ trackId }) }),
  likeIds: () => req("/api/likes"),
  like: (trackId) => req("/api/likes", { method: "POST", body: JSON.stringify({ trackId }) }),
  unlike: (trackId) => req("/api/likes/" + trackId, { method: "DELETE" }),
  /** Ordered tracks matching `ids` (skips missing). Chunks long lists for URL limits. */
  tracksByIds: async (orderedIds) => {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return [];
    const chunk = 350;
    const out = [];
    for (let i = 0; i < orderedIds.length; i += chunk) {
      const part = orderedIds.slice(i, i + chunk);
      const list = await req("/api/tracks?ids=" + part.join(","));
      const m = new Map(list.map((t) => [t.id, t]));
      for (const id of part) {
        const t = m.get(id);
        if (t) out.push(t);
      }
    }
    return out;
  },
};

/** Player queue items from `/api/tracks` rows (same shape as playlist pages). */
export function tracksToQueueItems(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map((t) => ({
    id: t.id,
    label: (t.artist ? t.artist.name + " — " : "") + (t.title || "Track"),
    url: lib.streamUrl(t.id),
    artist: t.artist?.name || "",
    title: t.title || "Track",
    album: t.album?.title || "",
    coverUrl: t.album?.id ? lib.coverUrl(t.album.id) : "",
  }));
}

/** Dispatched when the user explicitly takes control (play / new queue / skip). */
export const PLAYBACK_SYNC_RELEASE_EVENT = "musicsh:release-playback-sync";

/** One id per browser tab (sessionStorage); used to detect playback on another device. */
export function getPlaybackClientId() {
  if (typeof window === "undefined") return "";
  const makeId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  };
  const k = "musicsh_pb_cid";
  try {
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = makeId();
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch (_) {
    try {
      let id = localStorage.getItem(k);
      if (!id) {
        id = makeId();
        localStorage.setItem(k, id);
      }
      return id;
    } catch (_) {
      if (!window.__musicshCid) window.__musicshCid = makeId();
      return window.__musicshCid;
    }
  }
}

export function releasePlaybackServerSync() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PLAYBACK_SYNC_RELEASE_EVENT));
  } catch (_) {}
}

/** Cross-device playback resume (server stores last queue + position). */
export const playback = {
  get: () => req("/api/me/playback"),
  put: (state) =>
    req("/api/me/playback", {
      method: "PUT",
      body: JSON.stringify(state),
    }),
  takeover: (state) =>
    req("/api/me/playback/takeover", {
      method: "POST",
      body: JSON.stringify(state),
    }),
  clear: () => req("/api/me/playback", { method: "DELETE" }),
};
