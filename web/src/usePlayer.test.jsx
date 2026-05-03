import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { PlayerProvider, usePlayer } from "./usePlayer";
import * as api from "./api";

vi.mock("./api", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    releasePlaybackServerSync: vi.fn(),
  };
});

function wrapper({ children }) {
  return <PlayerProvider>{children}</PlayerProvider>;
}

function audioStub() {
  const el = new EventTarget();
  el.volume = 1;
  el.muted = false;
  el.paused = true;
  return el;
}

describe("usePlayer", () => {
  beforeEach(() => {
    vi.mocked(api.releasePlaybackServerSync).mockClear();
  });

  it("playQueue clears queue when empty and calls release", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playQueue([], 0);
    });
    expect(result.current.queue).toEqual([]);
    expect(result.current.index).toBe(-1);
    expect(api.releasePlaybackServerSync).toHaveBeenCalled();
  });

  it("playQueue sets start index clamped", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    const items = [
      { id: "1", label: "a", url: "/u1" },
      { id: "2", label: "b", url: "/u2" },
    ];
    act(() => {
      result.current.playQueue(items, 99);
    });
    expect(result.current.index).toBe(1);
    expect(result.current.current?.id).toBe("2");
    expect(api.releasePlaybackServerSync).toHaveBeenCalled();
  });

  it("playQueue can skip release for passive server mirror", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playQueue([{ id: "1", label: "a", url: "/u1" }], 0, { skipPlaybackRelease: true });
    });
    expect(api.releasePlaybackServerSync).not.toHaveBeenCalled();
  });

  it("next and prev move index within bounds", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playQueue(
        [
          { id: "1", label: "a", url: "/u1" },
          { id: "2", label: "b", url: "/u2" },
        ],
        0
      );
    });
    act(() => {
      result.current.next();
    });
    expect(result.current.index).toBe(1);
    act(() => {
      result.current.next();
    });
    expect(result.current.index).toBe(1);
    act(() => {
      result.current.prev();
    });
    expect(result.current.index).toBe(0);
    act(() => {
      result.current.prev();
    });
    expect(result.current.index).toBe(0);
  });

  it("jumpTo clamps index", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playQueue([{ id: "1", label: "a", url: "/u1" }], 0);
    });
    act(() => {
      result.current.jumpTo(-5);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      result.current.jumpTo(500);
    });
    expect(result.current.index).toBe(0);
  });

  it("removeTrackFromQueueById removes and adjusts index", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playQueue(
        [
          { id: "a", label: "1", url: "/1" },
          { id: "b", label: "2", url: "/2" },
          { id: "c", label: "3", url: "/3" },
        ],
        1
      );
    });
    act(() => {
      result.current.removeTrackFromQueueById("a");
    });
    expect(result.current.queue.map((x) => x.id)).toEqual(["b", "c"]);
    expect(result.current.index).toBe(0);
  });

  it("setAudioEl syncs volume and reflects paused state", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    const el = audioStub();
    act(() => {
      result.current.setAudioEl(el);
    });
    expect(el.volume).toBe(1);
    act(() => {
      result.current.setVolume(0.4);
    });
    expect(el.volume).toBeCloseTo(0.4, 5);
    el.paused = false;
    act(() => {
      result.current.setAudioEl(el);
    });
    expect(result.current.isPlaying).toBe(true);
  });

  it("toggleMute restores volume when unmuting", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    const el = audioStub();
    act(() => {
      result.current.setAudioEl(el);
      result.current.setVolume(0.7);
    });
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(true);
    expect(el.muted).toBe(true);
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(false);
    expect(result.current.volume).toBeCloseTo(0.7, 5);
  });

  it("playOne builds queue with format from track object", () => {
    const { result } = renderHook(() => usePlayer(), { wrapper });
    act(() => {
      result.current.playOne("t1", "Title", "/stream", { format: "FLAC" });
    });
    expect(result.current.queue).toHaveLength(1);
    expect(result.current.queue[0].format).toBe("flac");
  });
});
