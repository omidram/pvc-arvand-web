"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { shutdownsApi } from "@/lib/endpoints";
import type { Shutdown } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { DateInput } from "@/components/ui/date-input";
import { formatDateTime } from "@/lib/utils";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { monthStartIso, todayIsoLocal } from "@/lib/date-range";

export type ShutdownGroupBy = "reason" | "cause" | "category" | "plant" | "detail";

type SortKey = "label" | "count" | "pctCount" | "minutes" | "pctMinutes" | "avg" | "max" | "last";

type Group = {
  key: string;
  code: string;
  label: string;
  category: string;
  count: number;
  minutes: number;
  avg: number;
  max: number;
  last: string | null;
  pctCount: number;
  pctMinutes: number;
  trips: Shutdown[];
};

const GROUP_BYS: ShutdownGroupBy[] = ["reason", "cause", "category", "plant", "detail"];

function wallMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function tripMinutes(row: Shutdown): number {
  const a = wallMs(row.shutdown_time);
  const b = wallMs(row.startup_time);
  if (a != null && b != null) return Math.max(0, Math.round((b - a) / 60000));
  if (row.duration_hours != null) return Math.max(0, Math.round(row.duration_hours * 60));
  return 0;
}

function hm(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function norm(value: string | null | undefined): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

function groupKey(row: Shutdown, by: ShutdownGroupBy): { key: string; code: string; label: string; category: string } {
  const unknown = "—";
  switch (by) {
    case "reason": {
      const code = norm(row.code);
      const cause = norm(row.cause);
      return { key: `${code.toLowerCase()}|${cause.toLowerCase()}`, code, label: cause || unknown, category: norm(row.category) };
    }
    case "cause": {
      const cause = norm(row.cause);
      return { key: cause.toLowerCase(), code: "", label: cause || unknown, category: "" };
    }
    case "category": {
      const cat = norm(row.category);
      return { key: cat.toLowerCase(), code: "", label: cat || unknown, category: "" };
    }
    case "plant": {
      const el = formatElectrolyzer(row.plant_part) || norm(row.plant_part);
      return { key: el.toLowerCase(), code: "", label: el || unknown, category: "" };
    }
    case "detail": {
      const detail = norm(row.remarks);
      return { key: detail.toLowerCase(), code: norm(row.code), label: detail || unknown, category: norm(row.cause) };
    }
  }
}

function SortTh({
  k,
  sort,
  onSort,
  className,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th className={`sd-sort ${className || ""}`} onClick={() => onSort(k)} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
      {children}
      <span className="sd-sort-mark">{active ? (sort.desc ? "▼" : "▲") : "↕"}</span>
    </th>
  );
}

export function ShutdownAnalysis({ initialGroupBy = "reason" }: { initialGroupBy?: ShutdownGroupBy }) {
  const { t } = useI18n();
  useCalendar();
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIsoLocal);
  const [groupBy, setGroupBy] = useState<ShutdownGroupBy>(initialGroupBy);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "minutes", desc: true });
  const [open, setOpen] = useState<Set<string>>(new Set());

  const params = useMemo(() => {
    const p: Record<string, unknown> = { limit: 5000 };
    if (from) p.date_from = `${from}T00:00:00`;
    if (to) p.date_to = `${to}T23:59:59`;
    return p;
  }, [from, to]);

  const listQuery = useQuery({ queryKey: ["shutdowns", "analysis", params], queryFn: () => shutdownsApi.list(params) });
  const trips = useMemo(() => listQuery.data || [], [listQuery.data]);

  const { groups, totalCount, totalMinutes } = useMemo(() => {
    const map = new Map<string, Group>();
    let totalMins = 0;
    for (const row of trips) {
      const g = groupKey(row, groupBy);
      const mins = tripMinutes(row);
      totalMins += mins;
      let entry = map.get(g.key);
      if (!entry) {
        entry = { ...g, count: 0, minutes: 0, avg: 0, max: 0, last: null, pctCount: 0, pctMinutes: 0, trips: [] };
        map.set(g.key, entry);
      }
      entry.count += 1;
      entry.minutes += mins;
      entry.max = Math.max(entry.max, mins);
      if (row.shutdown_time && (!entry.last || row.shutdown_time > entry.last)) entry.last = row.shutdown_time;
      entry.trips.push(row);
    }
    const list = [...map.values()];
    for (const g of list) {
      g.avg = g.count ? g.minutes / g.count : 0;
      g.pctCount = trips.length ? (g.count / trips.length) * 100 : 0;
      g.pctMinutes = totalMins ? (g.minutes / totalMins) * 100 : 0;
      g.trips.sort((a, b) => (b.shutdown_time || "").localeCompare(a.shutdown_time || ""));
    }
    return { groups: list, totalCount: trips.length, totalMinutes: totalMins };
  }, [trips, groupBy]);

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...groups].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir || b.minutes - a.minutes;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [groups, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "label" }));
  }

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const showCode = groupBy === "reason" || groupBy === "detail";
  const showCategory = groupBy === "reason" || groupBy === "detail";
  const colCount = 9 + (showCode ? 1 : 0) + (showCategory ? 1 : 0);

  const th = (k: SortKey, label: string, className?: string) => (
    <SortTh k={k} sort={sort} onSort={toggleSort} className={className}>
      {label}
    </SortTh>
  );

  return (
    <div className="sd-analysis">
      <div className="shutdown-list-toolbar mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1">
          <span>{t("menus.from")}</span>
          <DateInput className="access-inset-field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("menus.till")}</span>
          <DateInput className="access-inset-field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("shutdowns.groupBy")}</span>
          <select className="access-inset-field" value={groupBy} onChange={(e) => { setGroupBy(e.target.value as ShutdownGroupBy); setOpen(new Set()); }}>
            {GROUP_BYS.map((g) => (
              <option key={g} value={g}>
                {t(`shutdowns.by_${g}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="shutdown-summary-chip ms-auto font-bold">
          {t("shutdowns.totalShutdowns")}: {totalCount} &nbsp;·&nbsp; {t("shutdowns.totalDuration")}: {hm(totalMinutes)} &nbsp;·&nbsp;{" "}
          {t("shutdowns.groupsCount")}: {groups.length}
        </div>
      </div>
      <p className="mb-2 text-[11px] text-[var(--win-muted)]">{t("shutdowns.analysisHint")}</p>

      <div className="overflow-auto">
        <table className="access-cont-table sd-analysis-table min-w-[980px]">
          <thead>
            <tr>
              <th className="w-6" />
              <th className="w-8">#</th>
              {showCode ? <th className="w-16">{t("fields.code")}</th> : null}
              {th("label", t(`shutdowns.col_${groupBy}`))}
              {showCategory ? <th className="w-36">{groupBy === "detail" ? t("fields.reason") : t("fields.category")}</th> : null}
              {th("count", t("shutdowns.trips"), "w-20")}
              {th("pctCount", t("shutdowns.pctTrips"), "w-24")}
              {th("minutes", t("fields.durationHm"), "w-24")}
              {th("pctMinutes", t("shutdowns.pctDuration"), "w-40")}
              {th("avg", t("shutdowns.avgDuration"), "w-24")}
              {th("max", t("shutdowns.maxDuration"), "w-24")}
              {th("last", t("shutdowns.lastTrip"), "w-36")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((g, idx) => {
              const isOpen = open.has(g.key);
              return (
                <Fragment key={g.key || `empty-${idx}`}>
                  <tr className="sd-group-row" onClick={() => toggleOpen(g.key)}>
                    <td className="access-selector">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                    <td className="text-center">{idx + 1}</td>
                    {showCode ? <td>{g.code || "—"}</td> : null}
                    <td className="font-semibold">{g.label}</td>
                    {showCategory ? <td>{g.category || "—"}</td> : null}
                    <td className="text-center tabular-nums">{g.count}</td>
                    <td className="text-center tabular-nums">{pct(g.pctCount)}</td>
                    <td className="text-center font-semibold tabular-nums">{hm(g.minutes)}</td>
                    <td>
                      <div className="sd-bar" title={pct(g.pctMinutes)}>
                        <span style={{ width: `${Math.min(100, g.pctMinutes)}%` }} />
                        <b>{pct(g.pctMinutes)}</b>
                      </div>
                    </td>
                    <td className="text-center tabular-nums">{hm(g.avg)}</td>
                    <td className="text-center tabular-nums">{hm(g.max)}</td>
                    <td className="tabular-nums">{formatDateTime(g.last)}</td>
                  </tr>
                  {isOpen ? (
                    <tr className="sd-trips-row">
                      <td />
                      <td colSpan={colCount - 1}>
                        <table className="sd-trips">
                          <thead>
                            <tr>
                              <th>{t("menus.number")}</th>
                              <th>{t("menus.partOfPlant")}</th>
                              <th>{t("fields.shutdownTime")}</th>
                              <th>{t("fields.startupTime")}</th>
                              <th>{t("fields.durationHm")}</th>
                              <th>{t("fields.code")}</th>
                              <th>{t("fields.reason")}</th>
                              <th>{t("fields.category")}</th>
                              <th>{t("fields.remarks")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.trips.map((r) => (
                              <tr key={r.nr}>
                                <td>{r.nr}</td>
                                <td>{formatElectrolyzer(r.plant_part) || r.plant_part || "—"}</td>
                                <td className="tabular-nums">{formatDateTime(r.shutdown_time)}</td>
                                <td className="tabular-nums">{r.startup_time ? formatDateTime(r.startup_time) : t("shutdowns.ongoing")}</td>
                                <td className="tabular-nums">{hm(tripMinutes(r))}</td>
                                <td>{r.code || "—"}</td>
                                <td>{r.cause || "—"}</td>
                                <td>{r.category || "—"}</td>
                                <td>{r.remarks || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!listQuery.isLoading && sorted.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-3 text-center text-[var(--win-muted)]">
                  {t("shutdowns.noShutdowns")}
                </td>
              </tr>
            ) : null}
          </tbody>
          {sorted.length ? (
            <tfoot>
              <tr className="sd-total-row">
                <td />
                <td />
                {showCode ? <td /> : null}
                <td>{t("shutdowns.total")}</td>
                {showCategory ? <td /> : null}
                <td className="text-center">{totalCount}</td>
                <td className="text-center">100%</td>
                <td className="text-center">{hm(totalMinutes)}</td>
                <td>100%</td>
                <td className="text-center">{hm(totalCount ? totalMinutes / totalCount : 0)}</td>
                <td className="text-center">{hm(Math.max(0, ...groups.map((g) => g.max)))}</td>
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {listQuery.isLoading ? <div className="mt-2 text-[12px]">…</div> : null}
      {listQuery.isError ? <div className="mt-2 text-[12px] text-red-800">{(listQuery.error as Error).message}</div> : null}
    </div>
  );
}
