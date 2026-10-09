/** Local calendar YYYY-MM-DD (not UTC) for home stats range pickers. */
export function formatLocalYMD(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Inclusive local-date range for a stats period.
 * @param {"day"|"week"|"month"|"custom"} period
 * @param {Date} [now]
 * @param {{ from?: string, to?: string }} [custom]
 */
export function homeStatsPeriodRange(period, now = new Date(), custom = {}) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "day") {
    const s = formatLocalYMD(end);
    return { from: s, to: s };
  }
  if (period === "week") {
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return { from: formatLocalYMD(start), to: formatLocalYMD(end) };
  }
  if (period === "month") {
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return { from: formatLocalYMD(start), to: formatLocalYMD(end) };
  }
  // custom
  let from = String(custom?.from || "").trim();
  let to = String(custom?.to || "").trim();
  if (!from || !to) {
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    from = from || formatLocalYMD(start);
    to = to || formatLocalYMD(end);
  }
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return { from, to };
}
