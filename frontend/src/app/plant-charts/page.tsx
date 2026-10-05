"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessHub } from "@/components/layout/access-hub";
import { DateInput } from "@/components/ui/date-input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { monitoringApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { formatDate } from "@/lib/utils";
import type { TrainId } from "@/lib/plant-topology";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";

const SPANS = [
  { id: "10", labelKey: "monitoring.last10" },
  { id: "30", labelKey: "monitoring.last30" },
  { id: "90", labelKey: "monitoring.days90" },
  { id: "365", labelKey: "monitoring.year1" },
  { id: "730", labelKey: "monitoring.year2" },
  { id: "custom", labelKey: "monitoring.customRange" },
] as const;

type Scope = "plant" | "train" | "electrolyzer";

function defaultCustomFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function ChartBlock({
  title,
  color,
  dataKey,
  unit,
  rows,
}: {
  title: string;
  color: string;
  dataKey: "voltage" | "current_ka" | "power_kw";
  unit: string;
  rows: Array<Record<string, string | number | null | undefined>>;
}) {
  return (
    <div className="rounded bg-[#0c1848] px-1 py-2">
      <div className="mb-1 px-2 text-[11px] font-semibold" style={{ color }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="#243056" />
          <XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 10 }} minTickGap={28} />
          <YAxis stroke={color} tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={52} />
          <Tooltip
            contentStyle={{ background: "#0b1a3d", border: "1px solid #334155", fontSize: 11 }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value) => [`${Number(value).toFixed(dataKey === "voltage" ? 3 : 2)} ${unit}`, title]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 1.5 }} connectNulls name={title} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function PlantChartsPage() {
  const { t } = useI18n();
  useCalendar();
  const [scope, setScope] = useState<Scope>("plant");
  const [train, setTrain] = useState<TrainId>("1");
  const [electrolyzer, setElectrolyzer] = useState("A1");
  const [span, setSpan] = useState("30");
  const [dateFrom, setDateFrom] = useState(defaultCustomFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [showVoltage, setShowVoltage] = useState(true);
  const [showAmp, setShowAmp] = useState(true);
  const [showPower, setShowPower] = useState(true);

  const custom = span === "custom";
  const query = useQuery({
    queryKey: [
      "monitoring",
      "plant-trends",
      scope,
      scope === "train" ? train : "",
      scope === "electrolyzer" ? electrolyzer : "",
      span,
      custom ? dateFrom : "",
      custom ? dateTo : "",
    ],
    queryFn: () =>
      monitoringApi.plantTrends({
        scope,
        train: scope === "train" ? train : undefined,
        electrolyzer: scope === "electrolyzer" ? electrolyzer : undefined,
        span,
        date_from: custom ? dateFrom || undefined : undefined,
        date_to: custom ? dateTo || undefined : undefined,
      }),
    enabled: !custom || Boolean(dateFrom || dateTo),
  });

  const rows = useMemo(
    () =>
      (query.data?.points || []).map((point) => ({
        label: `${formatDate(point.date)}${point.time ? ` ${point.time}` : ""}`,
        voltage: point.voltage,
        current_ka: point.current_ka,
        power_kw: point.power_kw,
      })),
    [query.data]
  );

  return (
    <AccessHub title={t("mainMenu.plantCharts")}>
      <p className="mb-3 text-[11px] text-[var(--win-muted)]">{t("plantCharts.hint")}</p>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {(
          [
            ["plant", t("plantCharts.scopePlant")],
            ["train", t("plantCharts.scopeTrain")],
            ["electrolyzer", t("plantCharts.scopeElectrolyzer")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`mon-filter-chip ${scope === id ? "is-active" : ""}`}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
        {scope === "train" ? (
          <>
            <button type="button" className={`mon-filter-chip ${train === "1" ? "is-active" : ""}`} onClick={() => setTrain("1")}>
              {t("monitoring.train1")}
            </button>
            <button type="button" className={`mon-filter-chip ${train === "2" ? "is-active" : ""}`} onClick={() => setTrain("2")}>
              {t("monitoring.train2")}
            </button>
          </>
        ) : null}
        {scope === "electrolyzer" ? (
          <ElectrolyzerCombo
            className="mon-filter-chip max-w-[88px]"
            variant="access"
            value={electrolyzer}
            onChange={setElectrolyzer}
            aria-label={t("plantCharts.scopeElectrolyzer")}
          />
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {SPANS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mon-filter-chip ${span === item.id ? "is-active" : ""}`}
            onClick={() => setSpan(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {custom ? (
        <div className="vh-custom-range mb-3">
          <label>
            <span>{t("monitoring.rangeFrom")}</span>
            <DateInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            <span>{t("monitoring.rangeTo")}</span>
            <DateInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-1">
        <button type="button" className={`mon-filter-chip ${showVoltage ? "is-active" : ""}`} onClick={() => setShowVoltage((v) => !v)}>
          {t("monitoring.voltageChart")}
        </button>
        <button type="button" className={`mon-filter-chip ${showAmp ? "is-active" : ""}`} onClick={() => setShowAmp((v) => !v)}>
          {t("monitoring.ampChart")}
        </button>
        <button type="button" className={`mon-filter-chip ${showPower ? "is-active" : ""}`} onClick={() => setShowPower((v) => !v)}>
          {t("plantCharts.powerChart")}
        </button>
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {query.data && rows.length === 0 ? <div className="mon-empty">{t("plantCharts.noData")}</div> : null}

      {query.data && rows.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs text-[var(--win-muted)]">
            {query.data.title} · {t("monitoring.pointCount", { shown: String(rows.length), total: String(query.data.total) })}
          </p>
          {showVoltage ? (
            <ChartBlock title={t("monitoring.voltageChart")} color="#d6e35a" dataKey="voltage" unit="V" rows={rows} />
          ) : null}
          {showAmp ? (
            <ChartBlock title={t("monitoring.ampChart")} color="#f59e0b" dataKey="current_ka" unit="kA" rows={rows} />
          ) : null}
          {showPower ? (
            <ChartBlock title={t("plantCharts.powerChart")} color="#67e8f9" dataKey="power_kw" unit="kW" rows={rows} />
          ) : null}
        </div>
      ) : null}
    </AccessHub>
  );
}
