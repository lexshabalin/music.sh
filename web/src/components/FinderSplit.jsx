import React from "react";

export function FinderSplit({
  left,
  right,
  minHeight = 560,
  leftWidth = 320,
}) {
  return (
    <div className="card finder-split" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="finder-split__grid"
        style={{
          display: "grid",
          gridTemplateColumns: `${leftWidth}px 1fr`,
          minHeight,
        }}
      >
        <div className="finder-split__left">{left}</div>
        <div className="finder-split__right">{right}</div>
      </div>
    </div>
  );
}

export function FinderLeft({
  title,
  tabs,
  activeTab,
  onTab,
  searchValue,
  onSearch,
  error,
  children,
}) {
  return (
    <>
      {tabs && tabs.length ? (
        <div className="finder-left__tabs" role="tablist" aria-label={title || "Sections"}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ghost finder-left__tab${activeTab === t.id ? " is-active" : ""}`}
              onClick={() => onTab?.(t.id)}
              role="tab"
              aria-selected={activeTab === t.id}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : title ? (
        <div className="finder-left__title muted">{title}</div>
      ) : null}

      {typeof onSearch === "function" ? (
        <input
          className="finder-left__search"
          placeholder="Search"
          value={searchValue || ""}
          onChange={(e) => onSearch(e.target.value)}
        />
      ) : null}

      {error ? <p style={{ color: "tomato", margin: "8px 0" }}>{error}</p> : null}

      <div className="finder-left__list">{children}</div>
    </>
  );
}

export function FinderItem({
  active,
  onClick,
  title,
  subtitle,
  rightMeta,
}) {
  return (
    <button
      type="button"
      className={`ghost finder-item${active ? " is-active" : ""}`}
      onClick={onClick}
      title={title}
    >
      <div className="finder-item__main">
        <div className="finder-item__title">{title || "—"}</div>
        {subtitle ? <div className="finder-item__sub muted">{subtitle}</div> : null}
      </div>
      {rightMeta ? <div className="finder-item__meta muted">{rightMeta}</div> : null}
    </button>
  );
}

