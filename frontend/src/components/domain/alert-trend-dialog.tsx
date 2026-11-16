"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";
import { monitoringApi } from "@/lib/endpoints";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { formatDate } from "@/lib/utils";

const SPANS = [
  { days: 14, labelKey: "monitoring.days14" },
  { days: 30, labelKey: "monitoring.last30" },
  { days: 90, labelKey: "monitoring.days90" },
] as const;

export function AlertTrendButton({ electrolyzer }: { electrolyzer: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="psm-trend-btn"
        title={t("monitoring.alertTrend")}
        aria-label={t("monitoring.alertTrend")}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setOpen(true);
        }}
      >
        <LineChartIcon size={13} />
      </button>
      {open ? <AlertTrendDialog electrolyzer={electrolyzer} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AlertTrendDialog({ electrolyzer, onClose }: { electrolyzer: string; onClose: () => void }) {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  useCalendar();
  const query = useQuery({
    queryKey: ["monitoring", "alert-trend", electrolyzer, days],
    queryFn: () => monitoringApi.alertTrend({ electrolyzer, days }),
  });
  const rows = useMemo(
    () =>
      (query.data?.points || []).map((point) => ({
        ...point,
        label: formatDate(point.date),
      })),
    [query.data]
  );
  const hasPoints = rows.some((row) => row.danger != null || row.warning != null);

  return (
    <Modal open title={`${electrolyzer} · ${t("monitoring.alertTrend")}`} onClose={onClose} wide>
      <p className="mb-3 text-[12px] text-[var(--win-text-dim)]">{t("monitoring.alertTrendHint")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {SPANS.map((item) => (
          <button
            key={item.days}
            type="button"
            className={`mon-filter-chip ${days === item.days ? "is-active" : ""}`}
            onClick={() => setDays(item.days)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {query.data && !hasPoints ? <p className="text-[12px]">{t("monitoring.offline")}</p> : null}
      {hasPoints ? (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis allowDecimals={false} width={36} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, name) => [value ?? "—", name]}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.label || ""}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="danger"
                name={t("monitoring.legendDanger")}
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="warning"
                name={t("monitoring.legendWarning")}
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </Modal>
  );
}
