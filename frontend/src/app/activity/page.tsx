"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Label, Select } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import {
  activityApi,
  downloadExport,
  type ActivityFilters,
  type ActivityInspectionRow,
  type ActivityRow,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";

const GROUPS = ["cell_shop", "warehouse", "lab", "inspection", "operation", "other"] as const;
const ELEMENT_METRICS = ["el_new", "el_assembled", "el_disassembled", "el_commissioned", "el_decommissioned", "el_edited", "el_deleted"];

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Range = { from: string; to: string };

function RangeBar({ range, onChange, children }: { range: Range; onChange: (r: Range) => void; children?: React.ReactNode }) {
  const { t } = useI18n();
  const quick: [string, Range][] = [
    [t("activity.today"), { from: isoDay(0), to: isoDay(0) }],
    [t("activity.yesterday"), { from: isoDay(-1), to: isoDay(-1) }],
    [t("activity.last7"), { from: isoDay(-6), to: isoDay(0) }],
    [t("activity.last30"), { from: isoDay(-29), to: isoDay(0) }],
  ];
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 border border-[#808080] bg-[#d4d0c8] p-2 text-[12px]">
      <div>
        <Label>{t("activity.from")}</Label>
        <DateInput value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })} />
      </div>
      <div>
        <Label>{t("activity.to")}</Label>
        <DateInput value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-1">
        {quick.map(([label, r]) => (
          <Button key={label} type="button" variant="secondary" size="sm" onClick={() => onChange(r)}>
            {label}
          </Button>
        ))}
      </div>
      {children}
    </div>
  );
}

function periodLabel(row: { period: string; period_start: string; period_end: string }, granularity: string): string {
  if (granularity === "day") return formatDate(row.period_start);
  if (granularity === "week") return `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`;
  return row.period;
}

function Person({ row }: { row: { username: string; full_name?: string | null } }) {
  return (
    <span>
      <b>{row.username}</b>
      {row.full_name ? <span className="text-[var(--win-muted)]"> · {row.full_name}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- Summary

function SummaryTab({ range }: { range: Range }) {
  const { t } = useI18n();
  const { isShamsi } = useCalendar();
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [roleId, setRoleId] = useState("");
  const [username, setUsername] = useState("");
  const [groups, setGroups] = useState<string[]>([...GROUPS]);

  const filters: ActivityFilters = {
    date_from: range.from,
    date_to: range.to,
    granularity,
    calendar: isShamsi ? "jalali" : "gregorian",
    username: username || undefined,
    role_id: roleId ? Number(roleId) : undefined,
  };
  const meta = useQuery({ queryKey: ["activity", "meta"], queryFn: activityApi.meta });
  const query = useQuery({ queryKey: ["activity", "summary", filters], queryFn: () => activityApi.summary(filters) });

  const metrics = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    return data.metrics.filter(
      (m) => groups.includes(m.group) && data.user_totals.some((u) => (u.counts[m.key] ?? 0) > 0)
    );
  }, [query.data, groups]);

  function toggleGroup(g: string) {
    setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  function groupTotal(row: ActivityRow): number {
    return metrics.reduce((sum, m) => sum + (row.counts[m.key] ?? 0), 0);
  }

  async function exportXlsx() {
    await downloadExport("/activity/summary", "xlsx", filters, "activity.xlsx");
  }

  const cols = metrics.length;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <div>
          <Label>{t("activity.granularity")}</Label>
          <Select value={granularity} onChange={(e) => setGranularity(e.target.value as "day" | "week" | "month")}>
            <option value="day">{t("activity.day")}</option>
            <option value="week">{t("activity.week")}</option>
            <option value="month">{t("activity.month")}</option>
          </Select>
        </div>
        <div>
          <Label>{t("activity.department")}</Label>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">{t("activity.all")}</option>
            {(meta.data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("activity.user")}</Label>
          <Select value={username} onChange={(e) => setUsername(e.target.value)}>
            <option value="">{t("activity.all")}</option>
            {(meta.data?.users ?? []).map((u) => (
              <option key={u.username} value={u.username}>
                {u.username}
                {u.full_name ? ` — ${u.full_name}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={exportXlsx}>
          <Download size={14} /> {t("activity.exportXlsx")}
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        {GROUPS.map((g) => (
          <label key={g} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={groups.includes(g)} onChange={() => toggleGroup(g)} />
            {t(`activity.group_${g}`)}
          </label>
        ))}
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}

      {query.data ? (
        <>
          <h3 className="mb-1 text-[12px] font-bold text-[var(--win-navy)]">{t("activity.userTotals")}</h3>
          <div className="mb-4 overflow-auto">
            <table className="stats-hier-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.user")}</th>
                  <th>{t("activity.department")}</th>
                  {metrics.map((m) => (
                    <th key={m.key}>{t(`activity.metric_${m.key}`)}</th>
                  ))}
                  <th>{t("activity.elements")}</th>
                  <th>{t("activity.activeDays")}</th>
                  <th>{t("activity.total")}</th>
                  <th title={t("activity.bulkHint")}>{t("activity.bulk")}</th>
                  <th>{t("activity.lastActivity")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.user_totals.length === 0 ? (
                  <tr>
                    <td colSpan={cols + 7}>{t("activity.noActivity")}</td>
                  </tr>
                ) : (
                  query.data.user_totals.map((u) => (
                    <tr key={u.username}>
                      <td className="is-left">
                        <Person row={u} />
                      </td>
                      <td>{u.department || "—"}</td>
                      {metrics.map((m) => (
                        <td key={m.key}>{u.counts[m.key] || ""}</td>
                      ))}
                      <td>{u.distinct_elements || ""}</td>
                      <td>{u.active_days}</td>
                      <td>
                        <b>{groupTotal(u)}</b>
                      </td>
                      <td>{u.bulk || ""}</td>
                      <td>{u.last_at ? formatDateTime(u.last_at) : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3 className="mb-1 text-[12px] font-bold text-[var(--win-navy)]">{t("activity.byPeriod")}</h3>
          <div className="mb-4 overflow-auto">
            <table className="stats-hier-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.period")}</th>
                  <th className="is-left">{t("activity.user")}</th>
                  <th>{t("activity.department")}</th>
                  {metrics.map((m) => (
                    <th key={m.key}>{t(`activity.metric_${m.key}`)}</th>
                  ))}
                  <th>{t("activity.elements")}</th>
                  <th>{t("activity.total")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((r) => {
                  const total = groupTotal(r);
                  if (total === 0 && r.bulk === 0) return null;
                  return (
                    <tr key={`${r.period}-${r.username}`}>
                      <td className="is-left">{periodLabel(r as Required<Pick<ActivityRow, "period" | "period_start" | "period_end">>, granularity)}</td>
                      <td className="is-left">
                        <Person row={r} />
                      </td>
                      <td>{r.department || "—"}</td>
                      {metrics.map((m) => (
                        <td key={m.key}>{r.counts[m.key] || ""}</td>
                      ))}
                      <td>{r.distinct_elements || ""}</td>
                      <td>
                        <b>{total}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {query.data.inactive_users.length ? (
            <div className="border border-[#808080] bg-[#ece9d8] p-2 text-[12px]">
              <b>{t("activity.inactiveUsers")}</b> — {t("activity.inactiveHint")}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {query.data.inactive_users.map((u) => (
                  <Person key={u.username} row={u} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Cell shop

function CellShopTab({ range }: { range: Range }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const filters: ActivityFilters = { date_from: range.from, date_to: range.to };
  const query = useQuery({ queryKey: ["activity", "cell-shop", filters], queryFn: () => activityApi.cellShop(filters) });
  const days = query.data?.days ?? [];

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--win-muted)]">{t("activity.cellShopHelp")}</p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      <div className="overflow-auto">
        <table className="stats-hier-table min-w-[900px]">
          <thead>
            <tr>
              <th className="is-left">{t("activity.date")}</th>
              {ELEMENT_METRICS.map((m) => (
                <th key={m}>{t(`activity.metric_${m}`)}</th>
              ))}
              <th>{t("activity.elements")}</th>
              <th className="is-left">{t("activity.byUser")}</th>
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && !query.isLoading ? (
              <tr>
                <td colSpan={ELEMENT_METRICS.length + 3}>{t("activity.noActivity")}</td>
              </tr>
            ) : null}
            {days.map((d) => (
              <Fragment key={d.date}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === d.date ? null : d.date)}>
                  <td className="is-left">
                    <b>{formatDate(d.date)}</b>
                  </td>
                  {ELEMENT_METRICS.map((m) => (
                    <td key={m}>{d.counts[m] || ""}</td>
                  ))}
                  <td>{d.distinct_elements}</td>
                  <td className="is-left">{d.users.map((u) => `${u.username} (${u.total})`).join("، ")}</td>
                </tr>
                {open === d.date ? (
                  <tr>
                    <td colSpan={ELEMENT_METRICS.length + 3} className="is-left">
                      <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                        {d.elements.map((e) => (
                          <div key={e.element_nr}>
                            <b>{e.element_nr}</b> {e.electrolyzer ? `${e.electrolyzer}${e.position ? `/${e.position}` : ""}` : ""} —{" "}
                            {e.actions.map((a) => t(`activity.metric_${a}`)).join(", ")}{" "}
                            <span className="text-[var(--win-muted)]">({e.users.join(", ")})</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Laboratory

function LabTab({ range }: { range: Range }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const filters: ActivityFilters = { date_from: range.from, date_to: range.to };
  const query = useQuery({ queryKey: ["activity", "lab", filters], queryFn: () => activityApi.lab(filters) });
  const data = query.data;

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--win-muted)]">
        {data?.source === "habitual" ? t("activity.labHelpHabitual") : t("activity.labHelp", { count: data?.expected_per_day ?? 0 })}
      </p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
            {[
              [t("activity.completeness"), data.summary.completeness_pct == null ? "—" : `${data.summary.completeness_pct}%`],
              [t("activity.expected"), data.summary.expected],
              [t("activity.entered"), data.summary.entered],
              [t("activity.missing"), data.summary.missing],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-[110px] border border-[#808080] bg-[#ece9d8] px-3 py-1.5">
                <div className="text-[var(--win-muted)]">{label}</div>
                <div className="text-[16px] font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 text-[12px] md:grid-cols-2">
            <div>
              <b>{t("activity.enteredByUser")}</b>
              <div>{data.entered_by_user.map((u) => `${u.username} (${u.count})`).join("، ") || "—"}</div>
            </div>
            <div>
              <b>{t("activity.missingByType")}</b>
              <div>{data.missing_by_type.map((m) => `${m.analysis_type} (${m.missing})`).join("، ") || "—"}</div>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="stats-hier-table min-w-[700px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.date")}</th>
                  <th>{t("activity.expected")}</th>
                  <th>{t("activity.entered")}</th>
                  <th>{t("activity.missing")}</th>
                  <th className="is-left">{t("activity.enteredByUser")}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <Fragment key={d.date}>
                    <tr className={d.missing ? "cursor-pointer" : ""} onClick={() => d.missing && setOpen(open === d.date ? null : d.date)}>
                      <td className="is-left">
                        <b>{formatDate(d.date)}</b>
                        {d.open ? <span className="text-[var(--win-muted)]"> · {t("activity.dayOpen")}</span> : null}
                      </td>
                      <td>{d.expected}</td>
                      <td>{d.entered}</td>
                      <td style={d.missing && !d.open ? { color: "#b00020", fontWeight: 700 } : undefined}>{d.missing || ""}</td>
                      <td className="is-left">{d.users.map((u) => `${u.username} (${u.count})`).join("، ")}</td>
                    </tr>
                    {open === d.date ? (
                      <tr>
                        <td colSpan={5} className="is-left">
                          <b>{t("activity.notEntered")}:</b> {d.missing_items.join(" · ")}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Inspection

function InspectionTable({ rows, kind, firstHeader, newestFirst }: { rows: ActivityInspectionRow[]; kind: "inspection" | "assembly"; firstHeader: string; newestFirst?: boolean }) {
  const { t } = useI18n();
  return (
    <table className="stats-hier-table mb-3 min-w-[420px]">
      <thead>
        <tr>
          <th className="is-left">{firstHeader}</th>
          <th>{t("activity.reports")}</th>
          <th>{t("activity.elements")}</th>
          {kind === "inspection" ? (
            <th>{t("activity.withFindings")}</th>
          ) : (
            <>
              <th>{t("activity.passed")}</th>
              <th>{t("activity.failed")}</th>
              <th>{t("activity.incomplete")}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={kind === "inspection" ? 4 : 6}>{t("activity.noActivity")}</td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.key}>
              <td className="is-left">{newestFirst && /^\d{4}-\d{2}-\d{2}$/.test(r.key) ? formatDate(r.key) : r.key}</td>
              <td>{r.reports}</td>
              <td>{r.elements}</td>
              {kind === "inspection" ? (
                <td>{r.with_findings || ""}</td>
              ) : (
                <>
                  <td>{r.passed || ""}</td>
                  <td style={r.failed ? { color: "#b00020", fontWeight: 700 } : undefined}>{r.failed || ""}</td>
                  <td>{r.incomplete || ""}</td>
                </>
              )}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function InspectionTab({ range }: { range: Range }) {
  const { t } = useI18n();
  const filters: ActivityFilters = { date_from: range.from, date_to: range.to };
  const query = useQuery({ queryKey: ["activity", "inspections", filters], queryFn: () => activityApi.inspections(filters) });
  const data = query.data;

  return (
    <div>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <p className="mb-2 text-[12px] text-[var(--win-muted)]">{data.note}</p>
          <h3 className="mb-1 text-[12px] font-bold text-[var(--win-navy)]">
            {t("activity.inspectionReports")} — {data.inspection_reports.total} ({t("activity.withFindings")}: {data.inspection_reports.with_findings})
          </h3>
          <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            <InspectionTable rows={data.inspection_reports.by_inspector} kind="inspection" firstHeader={t("activity.inspector")} />
            <InspectionTable rows={data.inspection_reports.by_day} kind="inspection" firstHeader={t("activity.date")} newestFirst />
          </div>
          <div className="mb-4 text-[12px]">
            <b>{t("activity.byReason")}:</b> {data.inspection_reports.by_reason.map((r) => `${r.reason} (${r.count})`).join("، ") || "—"}
            <br />
            <b>{t("activity.topFindings")}:</b> {data.inspection_reports.top_findings.map((r) => `${r.field} (${r.count})`).join("، ") || "—"}
          </div>

          <h3 className="mb-1 text-[12px] font-bold text-[var(--win-navy)]">
            {t("activity.assemblyReports")} — {data.assembly_reports.total} ({t("activity.passed")}: {data.assembly_reports.passed}, {t("activity.failed")}: {data.assembly_reports.failed}, {t("activity.incomplete")}: {data.assembly_reports.incomplete})
          </h3>
          <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            <InspectionTable rows={data.assembly_reports.by_inspector} kind="assembly" firstHeader={t("activity.inspector")} />
            <InspectionTable rows={data.assembly_reports.by_day} kind="assembly" firstHeader={t("activity.date")} newestFirst />
          </div>
          <div className="text-[12px]">
            <b>{t("activity.topFailedChecks")}:</b> {data.assembly_reports.top_failed_checks.map((r) => `${r.check} (${r.count})`).join("، ") || "—"}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Page

export default function ActivityPage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  useCalendar();
  const [range, setRange] = useState<Range>({ from: isoDay(-6), to: isoDay(0) });
  const queryClient = useQueryClient();

  if (!canView("activity")) {
    return (
      <AccessFormWindow caption={t("activity.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  return (
    <AccessFormWindow
      caption={t("activity.title")}
      commands={
        <Button type="button" variant="secondary" onClick={() => queryClient.invalidateQueries({ queryKey: ["activity"] })}>
          <RefreshCw size={14} /> {t("common.refresh")}
        </Button>
      }
    >
      <p className="mb-3 text-[12px] text-[var(--win-muted)]">{t("activity.description")}</p>
      <RangeBar range={range} onChange={setRange} />
      <Tabs
        tabs={[
          { key: "summary", label: t("activity.tabSummary"), content: <SummaryTab range={range} /> },
          { key: "cell", label: t("activity.tabCellShop"), content: <CellShopTab range={range} /> },
          { key: "lab", label: t("activity.tabLab"), content: <LabTab range={range} /> },
          { key: "inspection", label: t("activity.tabInspection"), content: <InspectionTab range={range} /> },
        ]}
      />
    </AccessFormWindow>
  );
}
