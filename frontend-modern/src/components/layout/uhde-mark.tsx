export function UhdeRings({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="#163a8a" />
      <g fill="none" stroke="#ffffff" strokeWidth="3.2">
        <circle cx="23.5" cy="29" r="11" />
        <circle cx="40.5" cy="29" r="11" />
        <circle cx="32" cy="40.5" r="11" />
      </g>
    </svg>
  );
}
