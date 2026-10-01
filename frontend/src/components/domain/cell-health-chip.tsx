"use client";

import type { CellHealthStatus } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

export function healthTone(status?: string | null): CellHealthStatus {
  if (status === "critical" || status === "investigate" || status === "watch" || status === "ok") {
    return status;
  }
  return "unknown";
}

/** Compact score gem for schematic cells — visible without opening the cell. */
export function CellHealthMini({
  score,
  status,
  title,
}: {
  score: number | null | undefined;
  status?: string | null;
  title?: string;
}) {
  const tone = healthTone(status);
  const label = score != null ? Math.round(score) : "·";
  return (
    <span className={`ch-mini is-${tone}`} title={title} aria-label={title || `Health ${label}`}>
      <i style={{ ["--ch-pct" as string]: `${score != null ? Math.max(0, Math.min(100, score)) : 0}%` }} />
      <b>{label}</b>
    </span>
  );
}

/** Rich health card for the cell properties panel. */
export function CellHealthCard({
  score,
  status,
  dolDays,
  cePct,
  unAvg,
  avgVoltage,
  avgCurrentKa,
  reason,
}: {
  score: number | null | undefined;
  status?: string | null;
  dolDays?: number | null;
  cePct?: number | null;
  unAvg?: number | null;
  avgVoltage?: number | null;
  avgCurrentKa?: number | null;
  reason?: string | null;
}) {
  const { t } = useI18n();
  const tone = healthTone(status);
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;

  return (
    <div className={`ch-card is-${tone}`}>
      <div className="ch-card-gauge" style={{ ["--ch-pct" as string]: `${pct}%` }}>
        <div className="ch-card-gauge-ring">
          <strong>{score != null ? Math.round(score) : "—"}</strong>
          <span>{t(`monitoring.healthStatus.${tone}`)}</span>
        </div>
      </div>
      <div className="ch-card-body">
        <div className="ch-card-title">{t("monitoring.healthScore")}</div>
        <div className="ch-card-metrics">
          <span>
            <small>DOL</small>
            <b>{dolDays != null ? `${formatNumber(dolDays, 0)}d` : "—"}</b>
          </span>
          <span>
            <small>CE</small>
            <b>{cePct != null ? `${formatNumber(cePct, 1)}%` : "—"}</b>
          </span>
          <span>
            <small>Un</small>
            <b>{unAvg != null ? formatNumber(unAvg, 3) : "—"}</b>
          </span>
          <span>
            <small>V avg</small>
            <b>{avgVoltage != null ? formatNumber(avgVoltage, 3) : "—"}</b>
          </span>
          <span>
            <small>kA avg</small>
            <b>{avgCurrentKa != null ? formatNumber(avgCurrentKa, 2) : "—"}</b>
          </span>
        </div>
        {reason ? <p className="ch-card-reason">{reason}</p> : null}
      </div>
    </div>
  );
}
