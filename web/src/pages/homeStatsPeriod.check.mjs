// ponytail: period range helper self-check
import assert from "node:assert/strict";
import { formatLocalYMD, homeStatsPeriodRange } from "./homeStatsPeriod.js";

const now = new Date(2026, 9, 9); // Oct 9, 2026 local
assert.equal(formatLocalYMD(now), "2026-10-09");
assert.deepEqual(homeStatsPeriodRange("day", now), { from: "2026-10-09", to: "2026-10-09" });
assert.deepEqual(homeStatsPeriodRange("week", now), { from: "2026-10-03", to: "2026-10-09" });
assert.deepEqual(homeStatsPeriodRange("month", now), { from: "2026-10-01", to: "2026-10-09" });
assert.deepEqual(homeStatsPeriodRange("custom", now, { from: "2026-09-01", to: "2026-09-15" }), {
  from: "2026-09-01",
  to: "2026-09-15",
});
assert.deepEqual(homeStatsPeriodRange("custom", now, { from: "2026-09-20", to: "2026-09-10" }), {
  from: "2026-09-10",
  to: "2026-09-20",
});
console.log("homeStatsPeriod.check.mjs: ok");
