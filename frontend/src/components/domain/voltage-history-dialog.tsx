"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monitoringApi } from "@/lib/endpoints";
import { Modal } from "@/components/ui/modal";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { formatDate } from "@/lib/utils";

const SPANS = [
  { id: "10", labelKey: "monitoring.last10" },
  { id: "30", labelKey: "monitoring.last30" },
  { id: "90", labelKey: "monitoring.days90" },
  { id: "365", labelKey: "monitoring.year1" },
  { id: "730", labelKey: "monitoring.year2" },
] as const;

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
  useCalendar();
  const query = useQuery({
    queryKey: ["monitoring", "history", electrolyzer, position || "", span],
    queryFn: () => monitoringApi.voltageHistory({ electrolyzer, position: position || undefined, span }),
  });
  const data = query.data;
  const chartRows = (() => {
    const byKey = new Map<string, { label: string; sort: string; voltage?: number; rectifier?: number }>();
    for (const point of data?.points || []) {
      const sort = `${point.date || ""} ${point.time || ""}`;
      const row = byKey.get(sort) || {
        label: `${formatDate(point.date)}${point.time ? ` ${point.time}` : ""}`,
        sort,
      };
      row.voltage = point.voltage;
      byKey.set(sort, row);
    }
    for (const point of data?.rectifier_points || []) {
      const sort = `${point.date || ""} ${point.time || ""}`;
      const row = byKey.get(sort) || {
        label: `${formatDate(point.date)}${point.time ? ` ${point.time}` : ""}`,
        sort,
      };
      row.rectifier = point.voltage;
      byKey.set(sort, row);
    }
    return [...byKey.values()].sort((a, b) => a.sort.localeCompare(b.sort));
  })();
  const hasRectifier = (data?.rectifier_points || []).length > 0;

  return (
    <Modal open title={data?.title || electrolyzer} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap gap-1">
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
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartRows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid stroke="#243056" />
                <XAxis dataKey="label" stroke="#cbd5e1" tick={{ fontSize: 10 }} minTickGap={28} />
                <YAxis stroke="#cbd5e1" tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={48} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155", color: "#f8fafc" }}
                  formatter={(value, name) => [`${Number(value).toFixed(3)} V`, name]}
                />
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
          <div className="mt-3 max-h-40 overflow-auto border border-[var(--win-border-shadow)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#1e3a8a] text-white">
                <tr>
                  <th className="px-2 py-1 text-start">{t("monitoring.historyTime")}</th>
                  <th className="px-2 py-1 text-start">{t("monitoring.historyValue")}</th>
                </tr>
              </thead>
              <tbody>
                {[...data.points].reverse().slice(0, 40).map((point, idx) => (
                  <tr key={`${point.date}-${point.time}-${idx}`} className={idx % 2 ? "bg-[var(--win-row-alt)]" : ""}>
                    <td className="px-2 py-1">
                      {formatDate(point.date)} {point.time || ""}
                    </td>
                    <td className="px-2 py-1">{Number(point.voltage).toFixed(3)}</td>
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
