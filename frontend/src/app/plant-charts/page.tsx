"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

const SERIES = {
  voltage: { color: "#d6e35a", unit: "V", digits: 3 },
  current_ka: { color: "#f59e0b", unit: "kA", digits: 2 },
  power_kw: { color: "#67e8f9", unit: "kW", digits: 2 },
} as const;

type TrendRow = {
  label: string;
  voltage: number | null | undefined;
  current_ka: number | null | undefined;
  power_kw: number | null | undefined;
};

function CombinedTrendChart({
  rows,
  showVoltage,
  showAmp,
  showPower,
  voltageLabel,
  ampLabel,
  powerLabel,
}: {
  rows: TrendRow[];
  showVoltage: boolean;
  showAmp: boolean;
  showPower: boolean;
  voltageLabel: string;
  ampLabel: string;
  powerLabel: string;
}) {
  const rightCount = Number(showAmp) + Number(showPower);
  const rightMargin = 12 + rightCount * 52;

  return (
    <div className="rounded bg-[#0c1848] px-1 py-2">
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={rows} margin={{ top: 12, right: rightMargin, left: 4, bottom: 8 }}>
          <CartesianGrid stroke="#243056" />
          <XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 10 }} minTickGap={28} />
          {showVoltage ? (
            <YAxis
              yAxisId="voltage"
              orientation="left"
              stroke={SERIES.voltage.color}
              tick={{ fontSize: 10, fill: SERIES.voltage.color }}
              domain={["auto", "auto"]}
              width={56}
              label={{ value: "V", angle: -90, position: "insideLeft", fill: SERIES.voltage.color, fontSize: 10 }}
            />
          ) : null}
          {showAmp ? (
            <YAxis
              yAxisId="current"
              orientation="right"
              stroke={SERIES.current_ka.color}
              tick={{ fontSize: 10, fill: SERIES.current_ka.color }}
              domain={["auto", "auto"]}
              width={52}
              label={{ value: "kA", angle: 90, position: "insideRight", fill: SERIES.current_ka.color, fontSize: 10 }}
            />
          ) : null}
          {showPower ? (
            <YAxis
              yAxisId="power"
              orientation="right"
              stroke={SERIES.power_kw.color}
              tick={{ fontSize: 10, fill: SERIES.power_kw.color }}
              domain={["auto", "auto"]}
              width={56}
              label={{ value: "kW", angle: 90, position: "insideRight", fill: SERIES.power_kw.color, fontSize: 10 }}
            />
          ) : null}
          <Tooltip
            contentStyle={{ background: "#0b1a3d", border: "1px solid #334155", fontSize: 11 }}
            labelStyle={{ color: "#e2e8f0" }}
            formatter={(value, name) => {
              const key =
                name === voltageLabel ? "voltage" : name === ampLabel ? "current_ka" : name === powerLabel ? "power_kw" : null;
              if (!key || value == null || value === "") return ["—", String(name)];
              const meta = SERIES[key];
              return [`${Number(value).toFixed(meta.digits)} ${meta.unit}`, String(name)];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#e2e8f0" }} />
          {showVoltage ? (
            <Line
              yAxisId="voltage"
              type="monotone"
              dataKey="voltage"
              stroke={SERIES.voltage.color}
              strokeWidth={2}
              dot={{ r: 1.5 }}
              connectNulls
              name={voltageLabel}
            />
          ) : null}
          {showAmp ? (
            <Line
              yAxisId="current"
              type="monotone"
              dataKey="current_ka"
              stroke={SERIES.current_ka.color}
              strokeWidth={2}
              dot={{ r: 1.5 }}
              connectNulls
              name={ampLabel}
            />
          ) : null}
          {showPower ? (
            <Line
              yAxisId="power"
              type="monotone"
              dataKey="power_kw"
              stroke={SERIES.power_kw.color}
              strokeWidth={2}
              dot={{ r: 1.5 }}
              connectNulls
              name={powerLabel}
            />
          ) : null}
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
          {showVoltage || showAmp || showPower ? (
            <CombinedTrendChart
              rows={rows}
              showVoltage={showVoltage}
              showAmp={showAmp}
              showPower={showPower}
              voltageLabel={t("monitoring.voltageChart")}
              ampLabel={t("monitoring.ampChart")}
              powerLabel={t("plantCharts.powerChart")}
            />
          ) : (
            <div className="mon-empty">{t("plantCharts.noSeries")}</div>
          )}
        </div>
      ) : null}
    </AccessHub>
  );
}
