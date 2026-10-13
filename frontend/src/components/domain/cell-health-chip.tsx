"use client";

import type { CellHealthFactor, CellHealthStatus } from "@/lib/endpoints";
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
  factors,
}: {
  score: number | null | undefined;
  status?: string | null;
  dolDays?: number | null;
  cePct?: number | null;
  unAvg?: number | null;
  avgVoltage?: number | null;
  avgCurrentKa?: number | null;
  reason?: string | null;
  factors?: CellHealthFactor[];
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
        {factors?.length ? <HealthBreakdown factors={factors} /> : null}
      </div>
    </div>
  );
}

function factorValue(f: CellHealthFactor): string {
  if (f.value == null) return "—";
  switch (f.name) {
    case "peer_voltage":
      return `${f.value > 0 ? "+" : ""}${formatNumber(f.value * 1000, 0)} mV`;
    case "voltage_trend":
      return `${f.value > 0 ? "+" : ""}${formatNumber(f.value, 2)} mV/d`;
    case "un_ce":
      return `${formatNumber(f.value, 3)} V`;
    case "current_efficiency":
    case "life":
      return `${formatNumber(f.value, 1)} %`;
    default:
      return formatNumber(f.value, 0);
  }
}

/** How the score was built: every factor with its value, its 0–100 score and its weight. */
export function HealthBreakdown({ factors }: { factors: CellHealthFactor[] }) {
  const { t } = useI18n();
  return (
    <table className="ch-breakdown">
      <thead>
        <tr>
          <th>{t("monitoring.healthFactor.title")}</th>
          <th>{t("monitoring.healthFactor.value")}</th>
          <th>{t("monitoring.healthFactor.score")}</th>
          <th>{t("monitoring.healthFactor.weight")}</th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.name} className={f.score == null ? "is-missing" : `is-${healthTone(f.status)}`} title={f.detail || undefined}>
            <td>
              {t(`monitoring.healthFactor.${f.name}`)}
              {f.scope === "electrolyzer" ? <small> ({t("monitoring.healthFactor.shared")})</small> : null}
            </td>
            <td>{factorValue(f)}</td>
            <td>{f.score == null ? t("monitoring.healthFactor.noData") : formatNumber(f.score, 0)}</td>
            <td>×{f.weight}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
