import Image from "next/image";

/** Electrolyzer-cell bars from the original Access left strip (outlined blue / white / red). */
export function UhdeCellBars({ height = 46 }: { height?: number }) {
  return (
    <svg width="42" height={height} viewBox="0 0 42 48" aria-hidden="true" className="access-cell-bars">
      <rect x="2.5" y="1.5" width="9" height="45" fill="none" stroke="#6ea8d8" strokeWidth="1.6" />
      <rect x="16.5" y="1.5" width="9" height="45" fill="#f4f6f8" stroke="#d8d8d8" strokeWidth="1" />
      <line x1="19.2" y1="3" x2="19.2" y2="45" stroke="#ffffff" strokeWidth="1.4" />
      <line x1="22.8" y1="3" x2="22.8" y2="45" stroke="#ffffff" strokeWidth="1.4" />
      <rect x="30.5" y="1.5" width="9" height="45" fill="none" stroke="#c41212" strokeWidth="1.6" />
    </svg>
  );
}

/** Three interlocking rings, one on top / two below — matches the Uhde emblem. */
export function UhdeRings({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="uhdeBlue" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#2a5cb8" />
          <stop offset="100%" stopColor="#163a8a" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="url(#uhdeBlue)" />
      <g fill="none" stroke="#ffffff" strokeWidth="3.15">
        <circle cx="32" cy="24.2" r="10.6" />
        <circle cx="23.2" cy="39.2" r="10.6" />
        <circle cx="40.8" cy="39.2" r="10.6" />
      </g>
    </svg>
  );
}

export function UhdeLogoMark({ size = 44, alt = "Uhde" }: { size?: number; alt?: string }) {
  return (
    <Image
      src="/logo.png"
      alt={alt}
      width={size}
      height={size}
      className="h-full w-full object-contain"
      priority
      loading="eager"
    />
  );
}
