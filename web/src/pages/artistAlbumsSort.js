/** Oldest → newest; missing years last; title tie-break. */
export function sortAlbumsByYearAsc(list) {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const ay = a?.year != null && a.year !== "" && Number.isFinite(Number(a.year)) ? Number(a.year) : null;
    const by = b?.year != null && b.year !== "" && Number.isFinite(Number(b.year)) ? Number(b.year) : null;
    if (ay == null && by == null) return coll.compare(String(a?.title || ""), String(b?.title || ""));
    if (ay == null) return 1;
    if (by == null) return -1;
    if (ay !== by) return ay - by;
    return coll.compare(String(a?.title || ""), String(b?.title || ""));
  });
}
