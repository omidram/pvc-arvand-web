"use client";

import Link from "next/link";
import { useId, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Banknote, Gauge, Zap } from "lucide-react";
import { settingsApi } from "@/lib/endpoints";
import type { DashboardVoltageStats } from "@/lib/types";
import { TRAIN_LETTERS, electrolyzerName, formatElectrolyzer, type TrainId } from "@/lib/plant-topology";
import { VoltageGauge } from "@/components/domain/voltage-gauge";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "rgba(15, 23, 42, 0.92)",
  border: "none",
  borderRadius: 10,
  fontSize: 12,
  color: "#f8fafc",
  boxShadow: "0 8px 24px rgba(15,23,42,0.3)",
};

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
    total: names.size,
    ka: present.reduce((sum, row) => sum + (row.online !== false ? row.current_ka || 0 : 0), 0),
    kwh: present.reduce((sum, row) => sum + (row.energy_kwh_24h || 0), 0),
    danger: present.reduce((sum, row) => sum + (row.danger_count || 0), 0),
    warning: present.reduce((sum, row) => sum + (row.warning_count || 0), 0),
  };
}

type KpiTone = "blue" | "violet" | "amber" | "green";

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  unit,
  meta,
  spark,
  extra,
}: {
  icon: ComponentType<{ size?: number }>;
  tone: KpiTone;
  label: string;
  value: string;
  unit?: string;
  meta?: string;
  spark?: { name: string; v: number }[];
  extra?: ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <div className={`dv-kpi dv-${tone}`}>
      <span className="dv-kpi-icon">
        <Icon size={18} />
      </span>
      <div className="dv-kpi-label">{label}</div>
      <div className="dv-kpi-value">
        {value}
        {unit ? <span className="dv-kpi-unit">{unit}</span> : null}
      </div>
      {extra}
      {meta ? <div className="dv-kpi-meta">{meta}</div> : extra ? null : <div className="dv-kpi-meta">&nbsp;</div>}
      {spark && spark.length > 1 ? (
        <div className="dv-spark" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`s${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="currentColor" strokeWidth={2} fill={`url(#s${uid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
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
  const { t, locale } = useI18n();
  const fa = locale === "fa";
  const U = { mw: fa ? "مگاوات" : "Megawatt", mwh: fa ? "مگاوات‌ساعت" : "Megawatt-hour", v: fa ? "ولت" : "Volt", ka: fa ? "کیلوآمپر" : "Kiloampere" };
  const uid = useId().replace(/:/g, "");
  const [span, setSpan] = useState<"day" | "week" | "month">("week");
  const priceQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get, staleTime: 15_000 });
  const price = priceQuery.data?.electricity_price_per_kw;
  const spanPick = () => (
    <div className="dv-span" role="group">
      {(["day", "week", "month"] as const).map((key) => (
        <button key={key} type="button" className={span === key ? "is-on" : ""} onClick={() => setSpan(key)}>
          {t(key === "day" ? "dashboard.spanDay" : key === "week" ? "dashboard.spanWeek" : "dashboard.spanMonth")}
        </button>
      ))}
    </div>
  );

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
    ka: Number((e.current_ka ?? 0).toFixed(1)),
  }));
  const maxKa = Math.max(1, ...barData.map((d) => d.ka));
  const spark = barData.map((d) => ({ name: d.name, v: d.ka }));
  const healthTotal = Math.max(1, live.ok_count + live.warning_count + live.danger_count);
  const health = [
    { key: "ok", name: t("monitoring.legendOk"), value: live.ok_count, color: "#10b981" },
    { key: "warning", name: t("monitoring.legendWarning"), value: live.warning_count, color: "#f59e0b" },
    { key: "danger", name: t("monitoring.legendDanger"), value: live.danger_count, color: "#ef4444" },
  ];
  const okPct = Math.round((live.ok_count / healthTotal) * 100);
  const trains = (["1", "2"] as const).map((train) => trainLine(live, train));
  const spanKwh = span === "day" ? live.plant_energy_kwh_24h : span === "month" ? live.plant_energy_kwh_30d : live.plant_energy_kwh_7d;
  const spanHours = span === "day" ? 24 : span === "month" ? 720 : 168;
  const avgMw = spanKwh != null ? spanKwh / spanHours / 1000 : null;
  const periodCost = price != null && price > 0 && spanKwh != null ? spanKwh * price : null;

  return (
    <section className={`dash-voltage-report dv ${compact ? "is-compact" : ""}`}>
      <div className="dash-voltage-head dv-head">
        <div>
          <h2 className="dash-voltage-title">
            <span className="dv-live-dot" aria-hidden />
            {t("dashboard.voltageReport")}
          </h2>
          <p className="dash-voltage-sub">
            {t("dashboard.voltageReportSub")}
            {live.report_date ? ` · ${formatDate(live.report_date)}` : ""}
          </p>
        </div>
        <Link href="/monitoring" className="dash-voltage-link">
          {t("dashboard.openMonitoring")}
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="dv-kpis">
        <Kpi
          icon={Zap}
          tone="blue"
          label={t("dashboard.plantTotalLoad")}
          value={live.plant_total_ka != null ? formatNumber(live.plant_total_ka, 1) : "—"}
          unit={U.ka}
          spark={spark}
        />
        <Kpi
          icon={Activity}
          tone="violet"
          label={t("dashboard.plantPowerAvg")}
          value={avgMw != null ? formatNumber(avgMw, 2) : "—"}
          unit={U.mw}
          extra={spanPick()}
        />
        <Kpi
          icon={Gauge}
          tone="amber"
          label={t("dashboard.plantCurrentPower")}
          value={live.plant_power_kw != null ? formatNumber(live.plant_power_kw / 1000, 2) : "—"}
          unit={U.mw}
        />
        <Kpi
          icon={Banknote}
          tone="green"
          label={t("dashboard.plantPowerCost")}
          value={periodCost != null ? formatNumber(periodCost, periodCost >= 1 ? 0 : 2) : "—"}
          unit={periodCost != null ? t("dashboard.toman") : undefined}
          extra={spanPick()}
          meta={price != null && price > 0 ? t("dashboard.plantPowerCostHint", { price: formatNumber(price, price >= 1 ? 0 : 2) }) : undefined}
        />
      </div>

      <div className="dv-grid">
        <div className="dv-card dv-health">
          <div className="dv-card-title">{t("dashboard.fromLive", { count: live.cell_count, els: live.online_count ?? live.electrolyzers.length })}</div>
          <div className="dv-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={health}
                  dataKey="value"
                  innerRadius="68%"
                  outerRadius="95%"
                  paddingAngle={2}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                >
                  {health.map((h) => (
                    <Cell key={h.key} fill={h.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dv-donut-center">
              <b>{okPct}%</b>
              <span>{t("monitoring.legendOk")}</span>
            </div>
          </div>
          <div className="dv-legend">
            {health.map((h) => (
              <span key={h.key} className="dv-legend-item">
                <i style={{ background: h.color }} />
                <b>{formatNumber(h.value, 0)}</b> {h.name}
              </span>
            ))}
          </div>
        </div>

        <div className="dv-card dv-trains">
          {trains.map((line) => {
            const pct = line.total ? (line.online / line.total) * 100 : 0;
            return (
              <div key={line.train} className="dv-train">
                <div className="dv-train-head">
                  <span>{t(line.train === "1" ? "monitoring.train1" : "monitoring.train2")}</span>
                  <b>
                    {line.online}/{line.total}
                  </b>
                </div>
                <div className="dv-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className="dv-train-stats">
                  <span>
                    <b>{formatNumber(line.ka, 1)}</b> {U.ka}
                  </span>
                  <span>
                    <b>{formatNumber(line.kwh / 1000, 1)}</b> {U.mwh}
                  </span>
                  <span className="is-danger">
                    <b>{formatNumber(line.danger, 0)}</b> {t("monitoring.legendDanger")}
                  </span>
                  <span className="is-warning">
                    <b>{formatNumber(line.warning, 0)}</b> {t("monitoring.legendWarning")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <VoltageGauge
          value={live.max_voltage}
          max={live.cell_gauge_max}
          label={t("dashboard.maxCellGauge")}
          unit={U.v}
          caption={[live.max_electrolyzer, live.max_position].filter(Boolean).join(" / ") || undefined}
          tone={maxVTone(live.max_voltage, live.danger_limit)}
          digits={3}
        />
        <VoltageGauge
          value={live.avg_voltage}
          max={live.cell_gauge_max}
          label={t("dashboard.avgCellGauge")}
          unit={U.v}
          tone="info"
          digits={3}
        />
      </div>

      {!compact && barData.length > 0 ? (
        <div className="dash-el-totals dv-card">
          <h3 className="dash-el-totals-title">{t("dashboard.totalByElectrolyzer")}</h3>
          <div style={{ width: "100%", height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#2563eb" />
                  </linearGradient>
                  <linearGradient id={`h${uid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#6d28d9" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#cbd5e1" vertical={false} />
                <XAxis dataKey="name" stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(37,99,235,0.08)" }} />
                <Bar dataKey="ka" radius={[10, 10, 0, 0]} name={t("dashboard.plantTotalLoad")} maxBarSize={44} isAnimationActive={false}>
                  {barData.map((d) => (
                    <Cell key={d.name} fill={d.ka >= maxKa * 0.97 ? `url(#h${uid})` : `url(#b${uid})`} />
                  ))}
                  <LabelList dataKey="ka" position="top" fontSize={10} fill="#334155" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
