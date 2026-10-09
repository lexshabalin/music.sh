import assert from "node:assert/strict";
import { sortAlbumsByYearAsc } from "./artistAlbumsSort.js";

const sorted = sortAlbumsByYearAsc([
  { id: "a", title: "Z", year: 2020 },
  { id: "b", title: "A", year: 2018 },
  { id: "c", title: "M", year: null },
  { id: "d", title: "B", year: 2018 },
]);

assert.deepEqual(
  sorted.map((x) => x.id),
  ["b", "d", "a", "c"],
  "oldest→newest; same year by title; missing year last"
);

console.log("artistAlbumsSort ok");
