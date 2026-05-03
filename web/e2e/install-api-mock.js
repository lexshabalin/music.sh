import { Buffer } from "node:buffer";
import { silenceWavBuffer } from "./silence-wav.js";

export const E2E_TOKEN = "e2e-mock-token";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "22222222-2222-4222-8222-222222222222";
const TRACK_A = "33333333-3333-4333-8333-333333333333";
const TRACK_B = "44444444-4444-4444-8444-444444444444";

function trackJson(id, title) {
  return {
    id,
    title,
    format: "wav",
    durationMs: 8000,
    album: { id: ALBUM_ID, title: "E2E Album" },
    artist: { name: "E2E Artist" },
  };
}

const TRACKS_LIST = [trackJson(TRACK_A, "E2E Track One"), trackJson(TRACK_B, "E2E Track Two")];

const meJson = {
  id: USER_ID,
  email: "e2e@example.test",
  username: "e2euser",
  displayName: "E2E User",
  uiLang: "en",
  createdAt: "2020-01-01T00:00:00.000Z",
};

const homeJson = {
  listenMsTotal: 0,
  libraryAlbums: 1,
  libraryArtists: 1,
  libraryTracks: 2,
  listeningByGenre: [],
  recentlyPlayedAlbums: [
    {
      id: ALBUM_ID,
      title: "E2E Album",
      artistName: "E2E Artist",
      year: 2024,
      coverUrl: null,
    },
  ],
};

const emptyPlayback = {
  trackIds: [],
  currentIndex: 0,
  positionMs: 0,
  isPlaying: false,
  clientId: "",
  ownerEpoch: 0,
  updatedAt: "2020-01-01T00:00:00.000Z",
};

/**
 * Stubs `/api/*` so the UI runs without a Go backend (Vite still proxies non-matched paths;
 * we intercept in the browser before the network stack).
 */
export async function installApiMock(page) {
  const wavBody = silenceWavBuffer();

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/\/$/, "") || url.pathname;
    const method = req.method();

    const json = (obj, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });

    const empty = (status = 204) => route.fulfill({ status });

    if (method === "OPTIONS") {
      return empty(204);
    }

    if (path === "/api/auth/login" && method === "POST") {
      return json({ accessToken: E2E_TOKEN });
    }

    if (path === "/api/me" && method === "GET") {
      return json(meJson);
    }

    if (path === "/api/me/home" && method === "GET") {
      return json(homeJson);
    }

    if (path === "/api/me/avatar" && method === "GET") {
      return empty(204);
    }

    if (path === "/api/me/background/settings" && method === "GET") {
      return json({ type: "none", preset: "", url: "", mime: "" });
    }

    if (path === "/api/me/ui/lang" && method === "POST") {
      return json({});
    }

    if (path === "/api/me/playback" && method === "GET") {
      return json(emptyPlayback);
    }

    if (path === "/api/me/playback" && method === "PUT") {
      return empty(204);
    }

    if (path === "/api/me/playback" && method === "DELETE") {
      return empty(204);
    }

    if (path === "/api/me/playback/takeover" && method === "POST") {
      return json({ ownerEpoch: 1 });
    }

    if (path === "/api/likes" && method === "GET") {
      return json({ trackIds: [] });
    }

    if (path === "/api/likes" && method === "POST") {
      return json({});
    }

    if (path.startsWith("/api/likes/") && method === "DELETE") {
      return empty(204);
    }

    if (path === "/api/tracks" && method === "GET") {
      const albumId = url.searchParams.get("albumId");
      const ids = url.searchParams.get("ids");
      const only = url.searchParams.get("only");
      if (only === "ids") {
        return json({ trackIds: TRACKS_LIST.map((t) => t.id) });
      }
      if (albumId === ALBUM_ID) {
        return json(TRACKS_LIST);
      }
      if (ids) {
        const order = ids.split(",").map((s) => s.trim());
        const m = new Map(TRACKS_LIST.map((t) => [t.id, t]));
        const out = [];
        for (const id of order) {
          const row = m.get(id);
          if (row) out.push(row);
        }
        return json(out);
      }
      const lim = parseInt(url.searchParams.get("limit") || "", 10);
      const off = parseInt(url.searchParams.get("offset") || "", 10);
      const offset = Number.isFinite(off) && off >= 0 ? off : 0;
      if (Number.isFinite(lim) && lim > 0) {
        return json(TRACKS_LIST.slice(offset, offset + lim));
      }
      return json(TRACKS_LIST);
    }

    if (path.startsWith("/api/tracks/") && path.endsWith("/stream") && method === "GET") {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(wavBody.length),
          "Accept-Ranges": "bytes",
        },
        body: wavBody,
      });
    }

    if (path.startsWith("/api/albums/") && path.endsWith("/cover") && method === "GET") {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      );
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Length": String(png.length) },
        body: png,
      });
    }

    if (path.startsWith("/api/tracks/") && path.endsWith("/cover") && method === "GET") {
      return empty(404);
    }

    if (path === "/api/library/scan/status" && method === "GET") {
      return json({ running: false });
    }

    return json({ error: `e2e unmocked: ${method} ${path}` }, 501);
  });
}
