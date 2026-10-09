import assert from "node:assert/strict";
import { formatLocalYMD, statsPeriodRange } from "./statsPeriod.js";

const now = new Date(2026, 9, 9);
assert.equal(formatLocalYMD(now), "2026-10-09");
assert.deepEqual(statsPeriodRange("day", now), { from: "2026-10-09", to: "2026-10-09" });
assert.deepEqual(statsPeriodRange("week", now), { from: "2026-10-03", to: "2026-10-09" });
assert.deepEqual(statsPeriodRange("month", now), { from: "2026-10-01", to: "2026-10-09" });
console.log("statsPeriod.check.mjs: ok");
