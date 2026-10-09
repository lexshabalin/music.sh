import { describe, it, expect } from "vitest";
import { sortAlbumsByYearAsc } from "./artistAlbumsSort.js";

describe("sortAlbumsByYearAsc", () => {
  it("sorts oldest→newest; same year by title; missing year last", () => {
    const sorted = sortAlbumsByYearAsc([
      { id: "a", title: "Z", year: 2020 },
      { id: "b", title: "A", year: 2018 },
      { id: "c", title: "M", year: null },
      { id: "d", title: "B", year: 2018 },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
});
