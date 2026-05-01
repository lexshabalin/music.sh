/**
 * Parses a free-text genre field ("Rock; Jazz | Folk") into unique trimmed tags (order preserved).
 */
export function parseGenreInput(raw) {
  if (typeof raw !== "string") return [];
  const out = [];
  const seen = new Set();
  const parts = raw.split(/[;|]/);
  for (const piece of parts) {
    const t = piece.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** @param {string[] | undefined | null} arr */
export function genresToInputValue(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return a.filter((x) => typeof x === "string" && x.trim()).join("; ");
}

/** @param {string[]} suggestions */
export default function GenreSuggestInput({
  datalistId,
  suggestions = [],
  value,
  onChange,
  disabled,
  placeholder,
  hint,
}) {
  const listId = datalistId || "genre-suggestions";
  return (
    <>
      <datalist id={listId}>
        {suggestions
          .filter((s) => typeof s === "string" && s.trim())
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
      />
      {hint ? (
        <span className="muted" style={{ display: "block", fontSize: "0.82rem", marginTop: 4 }}>
          {hint}
        </span>
      ) : null}
    </>
  );
}
