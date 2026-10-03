"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monitoringApi } from "@/lib/endpoints";
import { Modal } from "@/components/ui/modal";
import { DateInput } from "@/components/ui/date-input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { formatDate } from "@/lib/utils";
import { CellPropertiesPanel } from "@/components/domain/cell-dossier";
import { MonitoringExport } from "@/components/domain/export-buttons";

const SPANS = [
  { id: "10", labelKey: "monitoring.last10" },
  { id: "30", labelKey: "monitoring.last30" },
  { id: "90", labelKey: "monitoring.days90" },
  { id: "365", labelKey: "monitoring.year1" },
  { id: "730", labelKey: "monitoring.year2" },
  { id: "custom", labelKey: "monitoring.customRange" },
] as const;

type ChartRow = {
  label: string;
  sort: string;
  date?: string | null;
  time?: string | null;
  voltage?: number;
  rectifier?: number;
  current_ka?: number | null;
  prev_day_ka?: number | null;
  prev2_day_ka?: number | null;
};

function defaultCustomFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function shiftIsoDay(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function HistoryTooltip({
  active,
  payload,
  title,
  t,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
  title: string;
  t: (key: string, vars?: Record<string, string>) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const voltage = row.voltage;
  return (
    <div className="vh-tip">
      <div className="vh-tip-time">{row.label}</div>
      {voltage != null ? (
        <div className="vh-tip-v">
          {title} : {Number(voltage).toFixed(3)} V
        </div>
      ) : null}
      {row.current_ka != null ? (
        <div className="vh-tip-i">
          {t("monitoring.tipLoadToday")}: {Number(row.current_ka).toFixed(2)} kA
        </div>
      ) : null}
      {row.prev_day_ka != null ? (
        <div className="vh-tip-i is-prev">
          {t("monitoring.tipLoadPrevDay")}: {Number(row.prev_day_ka).toFixed(2)} kA
        </div>
      ) : null}
      {row.prev2_day_ka != null ? (
        <div className="vh-tip-i is-prev">
          {t("monitoring.tipLoadPrev2Day")}: {Number(row.prev2_day_ka).toFixed(2)} kA
        </div>
      ) : null}
    </div>
  );
}

export function VoltageHistoryDialog({
  electrolyzer,
  position,
  onClose,
}: {
  electrolyzer: string;
  position?: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [span, setSpan] = useState("30");
  const [dateFrom, setDateFrom] = useState(defaultCustomFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [showProps, setShowProps] = useState(false);
  const [showAmpChart, setShowAmpChart] = useState(false);
  useCalendar();
  useEffect(() => {
    setShowProps(false);
  }, [electrolyzer, position]);

  const custom = span === "custom";
  const query = useQuery({
    queryKey: ["monitoring", "history", electrolyzer, position || "", span, custom ? dateFrom : "", custom ? dateTo : ""],
    queryFn: () =>
      monitoringApi.voltageHistory({
        electrolyzer,
        position: position || undefined,
        span,
        date_from: custom ? dateFrom || undefined : undefined,
        date_to: custom ? dateTo || undefined : undefined,
      }),
    enabled: !custom || Boolean(dateFrom || dateTo),
  });
  const data = query.data;
  const chartRows = useMemo(() => {
    const byKey = new Map<string, ChartRow>();
    const loadBySlot = new Map<string, number>();
    for (const point of data?.points || []) {
      const sort = `${point.date || ""} ${point.time || ""}`;
      const row = byKey.get(sort) || {
        label: `${formatDate(point.date)}${point.time ? ` ${point.time}` : ""}`,
        sort,
        date: point.date,
        time: point.time,
      };
      row.voltage = point.voltage;
      if (point.current_ka != null) {
        row.current_ka = point.current_ka;
        loadBySlot.set(`${point.date || ""}|${(point.time || "").trim()}`, point.current_ka);
      }
      if (point.prev_day_ka != null) row.prev_day_ka = point.prev_day_ka;
      if (point.prev2_day_ka != null) row.prev2_day_ka = point.prev2_day_ka;
      byKey.set(sort, row);
    }
    for (const point of data?.rectifier_points || []) {
      const sort = `${point.date || ""} ${point.time || ""}`;
      const row = byKey.get(sort) || {
        label: `${formatDate(point.date)}${point.time ? ` ${point.time}` : ""}`,
        sort,
        date: point.date,
        time: point.time,
      };
      row.rectifier = point.voltage;
      byKey.set(sort, row);
    }
    const rows = [...byKey.values()].sort((a, b) => a.sort.localeCompare(b.sort));
    for (const row of rows) {
      if (!row.date) continue;
      const time = (row.time || "").trim();
      const prev = shiftIsoDay(row.date, -1);
      const prev2 = shiftIsoDay(row.date, -2);
      if (row.prev_day_ka == null) {
        row.prev_day_ka = loadBySlot.get(`${prev}|${time}`) ?? null;
      }
      if (row.prev2_day_ka == null) {
        row.prev2_day_ka = loadBySlot.get(`${prev2}|${time}`) ?? null;
      }
      if (row.current_ka == null) {
        row.current_ka = loadBySlot.get(`${row.date}|${time}`) ?? null;
      }
    }
    return rows;
  }, [data]);
  const hasRectifier = (data?.rectifier_points || []).length > 0;
  const hasAmpSeries = chartRows.some((row) => row.current_ka != null);

  return (
    <Modal open title={data?.title || electrolyzer} onClose={onClose} wide>
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
        {hasAmpSeries ? (
          <button
            type="button"
            className={`mon-filter-chip${showAmpChart ? " is-active" : ""}`}
            onClick={() => setShowAmpChart((open) => !open)}
          >
            {t("monitoring.showAmpChart")}
          </button>
        ) : null}
        {position ? (
          <button
            type="button"
            className={`mon-filter-chip psm-prop-btn${showProps ? " is-active" : ""}`}
            onClick={() => setShowProps((open) => !open)}
          >
            {t("monitoring.properties")}
          </button>
        ) : null}
        <MonitoringExport
          scope="history"
          electrolyzer={electrolyzer}
          position={position || undefined}
          span={span}
          filenameBase={`monitoring-history-${electrolyzer}${position ? `-${position}` : ""}`}
        />
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
      {showProps && position ? <CellPropertiesPanel electrolyzer={electrolyzer} position={position} /> : null}
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data && chartRows.length === 0 ? <div className="mon-empty">{t("monitoring.noHistory")}</div> : null}
      {data && chartRows.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-[var(--win-muted)]">
            {t("monitoring.pointCount", { shown: data.points.length, total: data.total })}
            {hasRectifier ? ` · ${t("monitoring.rectifierSeries")}` : ""}
          </p>
          <div className="rounded bg-[#0c1848] px-1 py-2">
            <div className="mb-1 px-2 text-[11px] font-semibold text-[#d6e35a]">{t("monitoring.voltageChart")}</div>
            <ResponsiveContainer width="100%" height={showAmpChart ? 260 : 360}>
              <LineChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="#243056" />
                <XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis stroke="#cbd5e1" tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={48} />
                <Tooltip content={<HistoryTooltip title={data.title} t={t} />} />
                <Line type="monotone" dataKey="voltage" stroke="#d6e35a" strokeWidth={2} dot={{ r: 2 }} connectNulls name={data.title} />
                {hasRectifier ? (
                  <Line
                    type="monotone"
                    dataKey="rectifier"
                    stroke="#67e8f9"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                    name={t("monitoring.rectifierSeries")}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {showAmpChart ? (
            <div className="mt-2 rounded bg-[#0c1848] px-1 py-2">
              <div className="mb-1 px-2 text-[11px] font-semibold text-[#f59e0b]">{t("monitoring.ampChart")}</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="#243056" />
                  <XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 10 }} minTickGap={28} />
                  <YAxis stroke="#f59e0b" tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={48} unit=" kA" />
                  <Tooltip content={<HistoryTooltip title={t("monitoring.loadKa")} t={t} />} />
                  <Line
                    type="monotone"
                    dataKey="current_ka"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                    name={t("monitoring.loadKa")}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
          <div className="mt-3 max-h-40 overflow-auto border border-[var(--win-border-shadow)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1e3a8a] text-white">
                <tr>
                  <th className="px-2 py-1 text-start">{t("monitoring.historyTime")}</th>
                  <th className="px-2 py-1 text-start">{t("monitoring.historyValue")}</th>
                  <th className="px-2 py-1 text-start">{t("monitoring.loadKa")}</th>
                </tr>
              </thead>
              <tbody>
                {[...chartRows].reverse().slice(0, 40).map((point, idx) => (
                  <tr key={`${point.sort}-${idx}`} className={idx % 2 ? "bg-[var(--win-row-alt)]" : ""}>
                    <td className="px-2 py-1">{point.label}</td>
                    <td className="px-2 py-1">{point.voltage != null ? Number(point.voltage).toFixed(3) : "—"}</td>
                    <td className="px-2 py-1">{point.current_ka != null ? Number(point.current_ka).toFixed(2) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
