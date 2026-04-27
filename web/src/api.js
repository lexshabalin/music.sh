const LS = "musicsh_token";
export const getToken = () => localStorage.getItem(LS) || "";
export const setToken = (t) => (t ? localStorage.setItem(LS, t) : localStorage.removeItem(LS));
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
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type");
  if (ct && ct.includes("application/json")) return r.json();
  return r;
}

export const auth = {
  register: (email, password, name) => req("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName: name || undefined }) }),
  login: (email, password) => req("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => req("/api/me"),
};

export const lib = {
  artists: (q) => req("/api/artists?" + new URLSearchParams({ query: q || "" })),
  albums: (q, artistId) => req("/api/albums?" + new URLSearchParams({ query: q || "", ...(artistId && { artistId }) })),
  album: (id) => req("/api/albums/" + id),
  tracks: (q, albumId) => req("/api/tracks?" + new URLSearchParams({ query: q || "", ...(albumId && { albumId }) })),
  track: (id) => req("/api/tracks/" + id),
  scan: () => req("/api/library/scan", { method: "POST", body: "{}" }),
  streamUrl: (id) => {
    const t = getToken();
    return base() + "/api/tracks/" + id + "/stream" + (t ? "?token=" + encodeURIComponent(t) : "");
  },
  coverUrl: (id) => {
    const t = getToken();
    return base() + "/api/albums/" + id + "/cover" + (t ? "?token=" + encodeURIComponent(t) : "");
  },
  playlists: () => req("/api/playlists"),
  playlist: (id) => req("/api/playlists/" + id),
  createPl: (name, description) =>
    req("/api/playlists", { method: "POST", body: JSON.stringify({ name, description: description || undefined }) }),
  addToPl: (plId, trackId) => req("/api/playlists/" + plId + "/tracks", { method: "POST", body: JSON.stringify({ trackId }) }),
  likeIds: () => req("/api/likes"),
  like: (trackId) => req("/api/likes", { method: "POST", body: JSON.stringify({ trackId }) }),
  unlike: (trackId) => req("/api/likes/" + trackId, { method: "DELETE" }),
};
