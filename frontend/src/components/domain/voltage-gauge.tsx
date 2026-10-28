"use client";

import { useId } from "react";

type Tone = "ok" | "warning" | "danger" | "info";

const TONE_COLOR: Record<Tone, [string, string]> = {
  ok: ["#34d399", "#059669"],
  warning: ["#fbbf24", "#d97706"],
  danger: ["#f87171", "#dc2626"],
  info: ["#60a5fa", "#2563eb"],
};

const R = 50;
const C = 2 * Math.PI * R;
const SWEEP = 0.75; // 270 degrees

/** SVG ring gauge with glow, ticks and a centred value. */
export function VoltageGauge({
  value,
  max,
  label,
  unit = "V",
  caption,
  tone = "info",
  digits = 2,
}: {
  value: number | null | undefined;
  max: number;
  label: string;
  unit?: string;
  caption?: string;
  tone?: Tone;
  digits?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const safeMax = max > 0 ? max : 1;
  const raw = value == null || Number.isNaN(Number(value)) ? 0 : Math.max(0, Number(value));
  const ratio = Math.min(1, raw / safeMax);
  const [from, to] = TONE_COLOR[tone];
  const track = C * SWEEP;
  const filled = track * ratio;

  return (
    <div className={`vg-gauge vg-${tone}`}>
      <div className="vg-ring">
        <svg viewBox="0 0 140 140" role="img" aria-label={label}>
          <defs>
            <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={from} />
              <stop offset="100%" stopColor={to} />
            </linearGradient>
            <filter id={`f${uid}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            className="vg-track"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${track} ${C}`}
            transform="rotate(135 70 70)"
          />
          <circle
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={`url(#g${uid})`}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(filled, 0.01)} ${C}`}
            transform="rotate(135 70 70)"
            filter={`url(#f${uid})`}
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
          {Array.from({ length: 28 }).map((_, i) => {
            const angle = (135 + (270 * i) / 27) * (Math.PI / 180);
            const inner = 38;
            const outer = i % 9 === 0 ? 33 : 35;
            return (
              <line
                key={i}
                className="vg-tick"
                x1={70 + inner * Math.cos(angle)}
                y1={70 + inner * Math.sin(angle)}
                x2={70 + outer * Math.cos(angle)}
                y2={70 + outer * Math.sin(angle)}
                strokeWidth={i % 9 === 0 ? 1.8 : 1}
              />
            );
          })}
        </svg>
        <div className="vg-center">
          <div className="vg-value" style={{ color: to }}>
            {value == null ? "—" : Number(value).toFixed(digits)}
          </div>
          <div className="vg-unit">{caption ? `${unit} · ${caption}` : unit}</div>
        </div>
      </div>
      <div className="vg-label">{label}</div>
    </div>
  );
}
