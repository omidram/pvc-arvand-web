"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shutdownSummaryApi } from "@/lib/endpoints";
import { useCalendar } from "@/lib/calendar/context";
import { JALALI_MONTHS_EN, JALALI_MONTHS_FA } from "@/lib/calendar/jalali";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

const TOOLTIP_STYLE = { background: "#0f172a", border: "none", borderRadius: 10, fontSize: 12, color: "#f8fafc" };

type Cause = { cause: string; count: number };
type MonthRow = { year: number; month: number; count: number; top_causes: Cause[] };
type Board = {
  span: "month" | "year";
  year: number;
  month: number;
  trips: number;
  top_causes: Cause[];
  months: MonthRow[];
};

function monthName(month: number, fa: boolean, jalali: boolean): string {
  if (jalali) return (fa ? JALALI_MONTHS_FA : JALALI_MONTHS_EN)[month - 1] || String(month);
  return new Date(2024, month - 1, 1).toLocaleString(fa ? "fa-IR" : "en", { month: "short" });
}

/** Current-month trip count and the three most repeated causes, with a yearly switch and a month-by-month comparison. */
export function ShutdownTripBoard() {
  const { t, locale } = useI18n();
  const { isShamsi } = useCalendar();
  const fa = locale === "fa";
  const [span, setSpan] = useState<"month" | "year">("month");
  const [picked, setPicked] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["shutdowns-summary", "board", span, isShamsi ? "jalali" : "gregorian"],
    queryFn: () => shutdownSummaryApi.board(span, isShamsi ? "jalali" : "gregorian"),
    staleTime: 30_000,
  });
  const data = q.data as Board | undefined;
  if (q.isLoading || !data) return null;

  const focusMonth = picked ?? data.month;
  const month = data.months.find((row) => row.month === focusMonth);
  const causes = span === "year" && picked == null ? data.top_causes : month?.top_causes || data.top_causes;
  const chart = data.months.map((row) => ({
    ...row,
    name: monthName(row.month, fa, isShamsi),
    current: row.month === data.month,
  }));
  const max = Math.max(1, ...chart.map((row) => row.count));

  return (
    <section className="stb">
      <div className="stb-head">
        <div>
          <h3>{t("shutdowns.tripBoardTitle")}</h3>
          <p>{span === "year" ? t("shutdowns.tripBoardYear", { year: data.year }) : t("shutdowns.tripBoardMonth")}</p>
        </div>
        <div className="dv-span" role="group">
          <button type="button" className={span === "month" ? "is-on" : ""} onClick={() => { setSpan("month"); setPicked(null); }}>
            {t("shutdowns.spanMonth")}
          </button>
          <button type="button" className={span === "year" ? "is-on" : ""} onClick={() => { setSpan("year"); setPicked(null); }}>
            {t("shutdowns.spanYear")}
          </button>
        </div>
      </div>
      <div className="stb-grid">
        <div className="stb-count">
          <b>{formatNumber(span === "year" && picked == null ? data.trips : month?.count ?? 0, 0)}</b>
          <span>{t("shutdowns.tripCount")}</span>
        </div>
        <ol className="stb-causes">
          {causes.length === 0 ? <li className="is-empty">{t("shutdowns.tripNone")}</li> : null}
          {causes.map((cause, index) => (
            <li key={cause.cause}>
              <em>{index + 1}</em>
              <span>{cause.cause}</span>
              <b>{formatNumber(cause.count, 0)}</b>
            </li>
          ))}
        </ol>
        <div className="stb-chart">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={28} name={t("shutdowns.tripCount")}>
                {chart.map((row) => (
                  <Cell key={row.month} fill={row.month === focusMonth ? "#b91c1c" : row.count >= max * 0.75 ? "#f59e0b" : "#2563eb"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="stb-picks">
            {chart.map((row) => (
              <button key={row.month} type="button" className={row.month === focusMonth ? "is-on" : ""} onClick={() => setPicked(row.month === picked ? null : row.month)}>
                {row.name}
              </button>
            ))}
          </div>
          {month ? (
            <p className="stb-month-why">
              {monthName(month.month, fa, isShamsi)}:{" "}
              {month.top_causes.length
                ? month.top_causes.map((cause) => `${cause.cause} (${cause.count})`).join(" · ")
                : t("shutdowns.tripNone")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
