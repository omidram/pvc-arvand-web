"use client";

type Tone = "ok" | "warning" | "danger" | "info";

const TONE_COLOR: Record<Tone, string> = {
  ok: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#2563eb",
};

/** CSS semi-circle gauge (no recharts) — reliable on classic Main Menu. */
export function VoltageGauge({
  value,
  max,
  label,
  unit = "V",
  tone = "info",
  digits = 2,
}: {
  value: number | null | undefined;
  max: number;
  label: string;
  unit?: string;
  tone?: Tone;
  digits?: number;
}) {
  const safeMax = max > 0 ? max : 1;
  const raw = value == null || Number.isNaN(Number(value)) ? 0 : Math.max(0, Number(value));
  const pct = Math.min(100, (raw / safeMax) * 100);
  const color = TONE_COLOR[tone];

  return (
    <div className="vg-gauge">
      <div className="vg-chart" style={{ ["--vg-pct" as string]: `${pct}%`, ["--vg-color" as string]: color }}>
        <div className="vg-arc" aria-hidden />
        <div className="vg-center">
          <div className="vg-value" style={{ color }}>
            {value == null ? "—" : Number(value).toFixed(digits)}
          </div>
          <div className="vg-unit">{unit}</div>
        </div>
      </div>
      <div className="vg-label">{label}</div>
    </div>
  );
}
