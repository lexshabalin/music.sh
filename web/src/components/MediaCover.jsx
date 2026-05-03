import React, { useEffect, useState } from "react";

/** Beamed quavers — monochrome; color from parent `color` / CSS. */
export function CoverNoteIcon() {
  return (
    <svg className="cover-note-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <ellipse cx="6.85" cy="18.35" rx="3.1" ry="2.38" transform="rotate(-24 6.85 18.35)" />
      <ellipse cx="15.75" cy="17.85" rx="3.1" ry="2.38" transform="rotate(-24 15.75 17.85)" />
      <rect x="9.25" y="7.35" width="1.42" height="10.1" rx="0.35" />
      <rect x="18.05" y="6.55" width="1.42" height="10.55" rx="0.35" />
      <path d="M 8.75 8.05 L 10.35 6.8 L 19.15 5.2 L 17.55 6.45 Z" />
    </svg>
  );
}

/**
 * Album / track / artist image, or themed placeholder when URL is missing or load fails.
 * `className` is applied to both `<img>` and the placeholder wrapper.
 */
export function MediaCover({ src, alt = "", className = "album-art", loading, decoding }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  const safe = typeof src === "string" && src.trim().length > 0;
  if (!safe || broken) {
    const cls = `${className} cover-art-placeholder`.trim();
    return (
      <div className={cls} aria-hidden="true">
        <CoverNoteIcon />
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onError={() => setBroken(true)}
    />
  );
}
