// ponytail: runnable check for JWT user scoping + allowed modes (no frameworks).
import assert from "node:assert/strict";
import { allowedModesForSection, normalizeListCols, userIdFromAccessToken } from "./viewPrefs.js";

function fakeJwt(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `hdr.${body}.sig`;
}

assert.equal(userIdFromAccessToken(""), "");
assert.equal(userIdFromAccessToken("not-a-jwt"), "");
assert.equal(userIdFromAccessToken(fakeJwt({ userId: "11111111-1111-1111-1111-111111111111" })), "11111111-1111-1111-1111-111111111111");

assert.deepEqual(allowedModesForSection("artists"), ["table", "list", "grid"]);
for (const s of ["songs", "albums", "playlists", "likes"]) {
  assert.deepEqual(allowedModesForSection(s), ["table", "grid"]);
}
assert.deepEqual(allowedModesForSection("genres"), ["grid"]);
assert.equal(normalizeListCols(1), 2);
assert.equal(normalizeListCols(9), 5);
assert.equal(normalizeListCols(4), 4);

console.log("viewPrefs.check.mjs: ok");
