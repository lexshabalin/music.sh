import React from "react";

const S = ({ children, size = 20, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={title ? undefined : true}
    role={title ? "img" : undefined}
  >
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

// VHS-style icons (simple, monochrome)
export const IRewind = (p) => (
  <S {...p}>
    <polygon points="11 19 2 12 11 5 11 19" />
    <polygon points="22 19 13 12 22 5 22 19" />
  </S>
);

export const IFastForward = (p) => (
  <S {...p}>
    <polygon points="2 5 11 12 2 19 2 5" />
    <polygon points="13 5 22 12 13 19 13 5" />
  </S>
);

export const IPlay = (p) => (
  <S {...p}>
    <polygon points="8 5 20 12 8 19 8 5" />
  </S>
);

export const IPause = (p) => (
  <S {...p}>
    <line x1="9" y1="5" x2="9" y2="19" />
    <line x1="15" y1="5" x2="15" y2="19" />
  </S>
);

export const ISpeaker = (p) => (
  <S {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15 9a4 4 0 0 1 0 6" />
    <path d="M17.5 6.5a8 8 0 0 1 0 11" />
  </S>
);

export const ISpeakerOff = (p) => (
  <S {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </S>
);

export const IHeart = (p) => (
  <S {...p}>
    <path d="M20.8 7.5c0-2.4-1.9-4.3-4.3-4.3-1.5 0-2.9.8-3.7 2-0.8-1.2-2.2-2-3.7-2C6.7 3.2 4.8 5.1 4.8 7.5c0 6 7.2 10.9 8 11.5.8-.6 8-5.5 8-11.5Z" />
  </S>
);

export const IPlus = (p) => (
  <S {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </S>
);

