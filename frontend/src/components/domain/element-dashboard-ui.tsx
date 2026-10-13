"use client";

import { Download } from "lucide-react";
import type { ElementStage, LifeStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { downloadCsv, type CsvCell } from "@/lib/csv";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatNumber } from "@/lib/utils";

export type Tone = "green" | "blue" | "amber" | "red" | "violet" | "slate" | "teal";

export const STAGE_TONE: Record<ElementStage, Tone> = {
  in_service: "green",
  installed: "blue",
  decommissioned: "red",
  awaiting_disassembly: "amber",
  disassembled: "slate",
  awaiting_assembly: "violet",
  assembling: "blue",
  awaiting_qc: "amber",
  ready: "teal",
};

/** Order of the element's trip: plant -> cell shop -> back to the plant. */
export const STAGE_FLOW: ElementStage[] = [
  "in_service",
  "installed",
  "decommissioned",
  "awaiting_disassembly",
  "awaiting_assembly",
  "assembling",
  "awaiting_qc",
  "ready",
];

export function StageBadge({ stage }: { stage: ElementStage }) {
  const { t } = useI18n();
  return <span className={cn("ed-badge", `ed-tone-${STAGE_TONE[stage]}`)}>{t(`elDash.stage.${stage}`)}</span>;
}

const LIFE_TONE: Record<LifeStatus, Tone> = { ok: "green", warning: "amber", expired: "red", unknown: "slate" };

export function LifeBadge({ status }: { status: LifeStatus }) {
  const { t } = useI18n();
  return <span className={cn("ed-badge", `ed-tone-${LIFE_TONE[status]}`)}>{t(`elDash.life.${status}`)}</span>;
}

/** Bar + percent of the lifetime limit used. */
export function LifeBar({ pct, status }: { pct: number | null; status: LifeStatus }) {
  if (pct == null) return <span className="ed-mute">—</span>;
  return (
    <div className="ed-life" title={`${formatNumber(pct, 1)} %`}>
      <div className="ed-life-bar">
        <div className={cn("ed-life-fill", status === "warning" && "is-warning", status === "expired" && "is-expired")} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="ed-life-pct">{formatNumber(pct, 0)}%</span>
    </div>
  );
}

export function Days({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="ed-mute">—</span>;
  const years = value / 365.25;
  return (
    <span title={`${formatNumber(years, 1)} y`} className="ed-num">
      {formatNumber(value, 0)}
    </span>
  );
}

export function DashKpi({
  label,
  value,
  tone = "neutral",
  icon: Icon,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "warning" | "ok" | "neutral" | "info";
  icon: React.ComponentType<{ size?: number }>;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="mon-kpi-icon">
        <Icon size={18} />
      </div>
      <div>
        <div className="mon-kpi-value">{value}</div>
        <div className="mon-kpi-label">{label}</div>
        {hint ? <div className="ed-stage-hint">{hint}</div> : null}
      </div>
    </>
  );
  const cls = `mon-kpi mon-kpi-${tone}${active ? " is-active" : ""}`;
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={onClick} aria-pressed={active ? true : false}>
      {body}
    </button>
  );
}

/** One compact line of a grouped KPI panel: icon, label (+ hint) and the value at the end. */
export function MiniStat({
  label,
  value,
  tone = "neutral",
  icon: Icon,
  hint,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "warning" | "ok" | "neutral" | "info";
  icon: React.ComponentType<{ size?: number }>;
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="ed-mini-icon">
        <Icon size={15} />
      </span>
      <span className="ed-mini-text">
        <span className="ed-mini-label">{label}</span>
        {hint ? <span className="ed-mini-hint">{hint}</span> : null}
      </span>
      <span className="ed-mini-value">{value}</span>
    </>
  );
  const cls = `ed-mini is-${tone}`;
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

export function Chips<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: { key: K; label: string; count?: number }[];
  onChange: (key: K) => void;
}) {
  return (
    <div className="ed-chips">
      {options.map((o) => (
        <button key={o.key} type="button" className={`mon-filter-chip${value === o.key ? " is-active" : ""}`} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count != null ? ` (${formatNumber(o.count, 0)})` : ""}
        </button>
      ))}
    </div>
  );
}

/** Downloads the rows currently shown as a CSV file that opens in Excel. */
export function ExportButton({ filename, header, rows, disabled }: { filename: string; header: string[]; rows: () => CsvCell[][]; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled}
      onClick={() => downloadCsv(`${filename}-${new Date().toISOString().slice(0, 10)}`, header, rows())}
    >
      <Download className="h-4 w-4" />
      {t("elDash.exportCsv")}
    </Button>
  );
}