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

export const IQueue = (p) => (
  <S {...p}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="16" y2="12" />
    <line x1="4" y1="17" x2="12" y2="17" />
  </S>
);

export const IClock = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6l4 2" />
  </S>
);

export const IRemoteDevice = (p) => (
  <S {...p}>
    <rect x="3" y="5" width="14" height="10" rx="2" />
    <path d="M8 19h4" />
    <path d="M20 9a3 3 0 0 1 0 6" />
    <path d="M21.5 6.5a6 6 0 0 1 0 11" />
  </S>
);

export const IShuffle = (p) => (
  <S {...p}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="3" y1="3" x2="9" y2="9" />
  </S>
);

export const IRepeat = (p) => (
  <S {...p}>
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </S>
);

export const IStarOutline = (p) => (
  <S {...p}>
    <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9 12 2" />
  </S>
);

export const IMoreHoriz = ({ size = 20, title }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden={title ? undefined : true}
    role={title ? "img" : undefined}
  >
    {title ? <title>{title}</title> : null}
    <circle cx="6" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="18" cy="12" r="2" />
  </svg>
);

export const ICast = (p) => (
  <S {...p}>
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <path d="M7 21h10" />
    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05a9 9 0 0 1 9.95 9.95" />
    <line x1="2" y1="20" x2="2.01" y2="20" />
  </S>
);

export const IGear = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </S>
);

export const IChevronDown = (p) => (
  <S {...p}>
    <path d="M6 9l6 6 6-6" />
  </S>
);

export const ILyrics = (p) => (
  <S {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <line x1="9" y1="10" x2="15" y2="10" />
    <line x1="9" y1="14" x2="13" y2="14" />
  </S>
);

export const ISleepTimer = (p) => (
  <S {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    <path d="M20 3v4M18 5h4" />
    <path d="M7 16h.01M11 18h.01M9 20h.01" />
  </S>
);

