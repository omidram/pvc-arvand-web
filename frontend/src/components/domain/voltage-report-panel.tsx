"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DashboardVoltageStats } from "@/lib/types";
import { TRAIN_LETTERS, electrolyzerName, formatElectrolyzer, type TrainId } from "@/lib/plant-topology";
import { VoltageGauge } from "@/components/domain/voltage-gauge";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

function maxVTone(v: number | null | undefined, limit: number): "ok" | "warning" | "danger" | "info" {
  if (v == null) return "info";
  if (v >= limit) return "danger";
  if (v >= limit - 0.2) return "warning";
  return "ok";
}

function hasLiveTotals(voltage?: DashboardVoltageStats | null): boolean {
  if (!voltage) return false;
  return (
    voltage.cell_count > 0 ||
    (voltage.plant_total_ka != null && voltage.plant_total_ka > 0) ||
    (voltage.plant_energy_kwh_24h != null && voltage.plant_energy_kwh_24h > 0) ||
    (voltage.online_count != null && voltage.online_count > 0)
  );
}

function trainLine(live: DashboardVoltageStats, train: TrainId) {
  const names = new Set(TRAIN_LETTERS.map((letter) => electrolyzerName(train, letter)));
  const present = live.electrolyzers.filter((row) => names.has(formatElectrolyzer(row.electrolyzer)));
  const online = present.filter((row) => row.online !== false && ((row.cell_count || 0) > 0 || Boolean(row.current_ka))).length;
  return {
    train,
    online,
    cells: present.reduce((sum, row) => sum + (row.cell_count || 0), 0),
    danger: present.reduce((sum, row) => sum + (row.danger_count || 0), 0),
    warning: present.reduce((sum, row) => sum + (row.warning_count || 0), 0),
  };
}

/** Always-visible load / energy strip for Main Menu / Overview. */
export function VoltageReportPanel({
  voltage,
  compact = false,
  loading = false,
  error = null,
}: {
  voltage?: DashboardVoltageStats | null;
  compact?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useI18n();

  if (loading && !voltage) {
    return (
      <section className={`dash-voltage-report ${compact ? "is-compact" : ""}`}>
        <h2 className="dash-voltage-title">{t("dashboard.voltageReport")}</h2>
        <p className="dash-voltage-sub">{t("dashboard.loading")}</p>
      </section>
    );
  }

  if (error && !voltage) {
    return (
      <section className={`dash-voltage-report ${compact ? "is-compact" : ""}`}>
        <h2 className="dash-voltage-title">{t("dashboard.voltageReport")}</h2>
        <p className="dash-voltage-sub" style={{ color: "#a10000" }}>
          {error}
        </p>
      </section>
    );
  }

  if (!hasLiveTotals(voltage)) {
    return (
      <section className={`dash-voltage-report ${compact ? "is-compact" : ""}`}>
        <div className="dash-voltage-head">
          <div>
            <h2 className="dash-voltage-title">{t("dashboard.voltageReport")}</h2>
            <p className="dash-voltage-sub">{t("dashboard.noVoltageGaugeData")}</p>
          </div>
          <Link href="/monitoring" className="dash-voltage-link">
            {t("dashboard.openMonitoring")}
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    );
  }

  const live = voltage!;
  const barData = live.electrolyzers.map((e) => ({
    name: e.electrolyzer,
    ka: e.current_ka ?? 0,
  }));

  return (
    <section className={`dash-voltage-report ${compact ? "is-compact" : ""}`}>
      <div className="dash-voltage-head">
        <div>
          <h2 className="dash-voltage-title">{t("dashboard.voltageReport")}</h2>
          <p className="dash-voltage-sub">{t("dashboard.voltageReportSub")}</p>
        </div>
        <Link href="/monitoring" className="dash-voltage-link">
          {t("dashboard.openMonitoring")}
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="dash-total-banner">
        <div className="dash-total-metrics">
          <div>
            <div className="dash-total-label">{t("dashboard.plantTotalLoad")}</div>
            <div className="dash-total-value">
              {live.plant_total_ka != null ? formatNumber(live.plant_total_ka, 1) : "—"}
              <span className="dash-total-unit">kA</span>
            </div>
          </div>
          <div>
            <div className="dash-total-label">{t("dashboard.plantTotalEnergy")}</div>
            <div className="dash-total-value">
              {live.plant_energy_kwh_24h != null
                ? formatNumber(live.plant_energy_kwh_24h / 24_000, 1)
                : "—"}
              <span className="dash-total-unit">MW</span>
            </div>
          </div>
        </div>
        <div>
          <div className="dash-total-meta">
            {t("dashboard.fromLive", { count: live.cell_count, els: live.online_count ?? live.electrolyzers.length })}
            {live.report_date ? ` · ${formatDate(live.report_date)}` : ""}
          </div>
          <div className="dash-total-chips">
            <span className="mon-pill is-danger">
              {live.danger_count} {t("monitoring.legendDanger")}
            </span>
            <span className="mon-pill is-warning">
              {live.warning_count} {t("monitoring.legendWarning")}
            </span>
            <span className="mon-pill is-ok">
              {live.ok_count} {t("monitoring.legendOk")}
            </span>
          </div>
        </div>
      </div>

      <div className="dash-gauge-row">
        <div className="dash-train-card">
          {(["1", "2"] as const).map((train) => {
            const line = trainLine(live, train);
            return (
              <div key={train} className="dash-train-line">
                <span className="dash-train-name">{t(train === "1" ? "monitoring.train1" : "monitoring.train2")}</span>
                <span className="dash-train-sum">
                  {t("monitoring.trainSummary", {
                    online: line.online,
                    cells: formatNumber(line.cells, 0),
                    danger: formatNumber(line.danger, 0),
                    warning: formatNumber(line.warning, 0),
                  })}
                </span>
              </div>
            );
          })}
        </div>
        <VoltageGauge
          value={live.max_voltage}
          max={live.cell_gauge_max}
          label={t("dashboard.maxCellGauge")}
          unit="V"
          caption={[live.max_electrolyzer, live.max_position].filter(Boolean).join(" / ") || undefined}
          tone={maxVTone(live.max_voltage, live.danger_limit)}
          digits={3}
        />
        <VoltageGauge
          value={live.avg_voltage}
          max={live.cell_gauge_max}
          label={t("dashboard.avgCellGauge")}
          unit="V"
          tone="info"
          digits={3}
        />
      </div>

      {!compact && barData.length > 0 ? (
        <div className="dash-el-totals">
          <h3 className="dash-el-totals-title">{t("dashboard.totalByElectrolyzer")}</h3>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                <XAxis dataKey="name" stroke="#475569" fontSize={11} />
                <YAxis stroke="#475569" fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="ka" fill="#2563eb" radius={[6, 6, 0, 0]} name={t("dashboard.plantTotalLoad")} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
