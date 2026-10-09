"use client";

import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import {
  activityApi,
  downloadExport,
  type ActivityEvent,
  type ActivityEventFilters,
  type ActivityFilters,
  type ActivityInspectionReport,
  type ActivityInspectionRow,
  type ActivityRow,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";

const GROUPS = ["cell_shop", "warehouse", "lab", "inspection", "operation", "other"] as const;
const ELEMENT_METRICS = ["el_new", "el_assembled", "el_disassembled", "el_commissioned", "el_decommissioned", "el_edited", "el_deleted"];
const WH_KINDS = ["dispatch", "receiving", "purchase", "punch", "decommission"];
const DAY_MS = 86_400_000;

function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Range = { from: string; to: string };
const RED = { color: "#b00020", fontWeight: 700 } as const;

function useMetricLabel() {
  const { t } = useI18n();
  return (key: string) => t(`activity.metric_${key}`);
}

function Person({ row, onOpen }: { row: { username: string; full_name?: string | null }; onOpen?: (username: string) => void }) {
  const clickable = !!onOpen && row.username !== "(system)";
  return (
    <span>
      {clickable ? (
        <button type="button" className="font-bold underline decoration-dotted" onClick={() => onOpen?.(row.username)}>
          {row.username}
        </button>
      ) : (
        <b>{row.username}</b>
      )}
      {row.full_name ? <span className="text-[var(--win-muted)]"> · {row.full_name}</span> : null}
    </span>
  );
}

function Card({ label, value, red }: { label: string; value: string | number; red?: boolean }) {
  return (
    <div className="min-w-[110px] border border-[#808080] bg-[#ece9d8] px-3 py-1.5 text-[12px]">
      <div className="text-[var(--win-muted)]">{label}</div>
      <div className="text-[16px] font-bold" style={red ? RED : undefined}>
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1 mt-3 text-[12px] font-bold text-[var(--win-navy)]">{children}</h3>;
}

function changeText(ev: ActivityEvent): string[] {
  return ev.changes.map((c) => {
    if (ev.action === "create") return `${c.field} = ${c.new}`;
    if (ev.action === "delete") return `${c.field}: ${c.old}`;
    return `${c.field}: ${c.old || "∅"} → ${c.new || "∅"}`;
  });
}

// ---------------------------------------------------------------- Filter bar

type Filters = { range: Range; roleId: string; username: string };

function FilterBar({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const { t } = useI18n();
  const meta = useQuery({ queryKey: ["activity", "meta"], queryFn: activityApi.meta });
  const quick: [string, Range][] = [
    [t("activity.today"), { from: isoDay(0), to: isoDay(0) }],
    [t("activity.yesterday"), { from: isoDay(-1), to: isoDay(-1) }],
    [t("activity.last7"), { from: isoDay(-6), to: isoDay(0) }],
    [t("activity.last30"), { from: isoDay(-29), to: isoDay(0) }],
  ];
  const users = (meta.data?.users ?? []).filter((u) => !value.roleId || String(u.role_id) === value.roleId);
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 border border-[#808080] bg-[#d4d0c8] p-2 text-[12px]">
      <div>
        <Label>{t("activity.from")}</Label>
        <DateInput value={value.range.from} onChange={(e) => onChange({ ...value, range: { ...value.range, from: e.target.value } })} />
      </div>
      <div>
        <Label>{t("activity.to")}</Label>
        <DateInput value={value.range.to} onChange={(e) => onChange({ ...value, range: { ...value.range, to: e.target.value } })} />
      </div>
      <div className="flex flex-wrap gap-1">
        {quick.map(([label, r]) => (
          <Button key={label} type="button" variant="secondary" size="sm" onClick={() => onChange({ ...value, range: r })}>
            {label}
          </Button>
        ))}
      </div>
      <div>
        <Label>{t("activity.department")}</Label>
        <Select value={value.roleId} onChange={(e) => onChange({ ...value, roleId: e.target.value, username: "" })}>
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
        <Select value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })}>
          <option value="">{t("activity.all")}</option>
          {users.map((u) => (
            <option key={u.username} value={u.username}>
              {u.username}
              {u.full_name ? ` — ${u.full_name}` : ""}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Event log (finest level)

function EventList({ base, presetMetric, presetGroup }: { base: ActivityFilters; presetMetric?: string; presetGroup?: string }) {
  const { t } = useI18n();
  const metricLabel = useMetricLabel();
  const [group, setGroup] = useState(presetGroup ?? "");
  const [metric, setMetric] = useState(presetMetric ?? "");
  const [resource, setResource] = useState("");
  const [q, setQ] = useState("");
  const [bulk, setBulk] = useState(false);
  const [skip, setSkip] = useState(0);
  const limit = 100;
  const filters: ActivityEventFilters = {
    ...base,
    group: group || undefined,
    metric: metric || undefined,
    resource: resource || undefined,
    q: q || undefined,
    include_bulk: bulk || undefined,
    skip,
    limit,
  };
  const query = useQuery({ queryKey: ["activity", "events", filters], queryFn: () => activityApi.events(filters) });
  const meta = useQuery({ queryKey: ["activity", "meta"], queryFn: activityApi.meta });
  const data = query.data;
  const total = data?.total ?? 0;

  async function exportXlsx() {
    const { skip: _skip, limit: _limit, ...rest } = filters;
    void _skip;
    void _limit;
    await downloadExport("/activity/events", "xlsx", rest, "activity-events.xlsx");
  }
  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setSkip(0);
      setter(v);
    };
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end gap-3 text-[12px]">
        {!presetGroup ? (
          <div>
            <Label>{t("activity.group")}</Label>
            <Select value={group} onChange={(e) => reset(setGroup)(e.target.value)}>
              <option value="">{t("activity.all")}</option>
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {t(`activity.group_${g}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {!presetMetric ? (
          <div>
            <Label>{t("activity.metric")}</Label>
            <Select value={metric} onChange={(e) => reset(setMetric)(e.target.value)}>
              <option value="">{t("activity.all")}</option>
              {(meta.data?.metrics ?? [])
                .filter((m) => !group || m.group === group)
                .map((m) => (
                  <option key={m.key} value={m.key}>
                    {metricLabel(m.key)}
                  </option>
                ))}
            </Select>
          </div>
        ) : null}
        <div>
          <Label>{t("activity.form")}</Label>
          <Select value={resource} onChange={(e) => reset(setResource)(e.target.value)}>
            <option value="">{t("activity.all")}</option>
            {(data?.resources ?? []).map((r) => (
              <option key={r.resource} value={r.resource}>
                {r.resource} ({r.count})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("activity.search")}</Label>
          <Input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder={t("activity.searchHint")} />
        </div>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={bulk} onChange={(e) => reset(setBulk)(e.target.checked)} />
          {t("activity.includeBulk")}
        </label>
        <Button type="button" variant="secondary" size="sm" onClick={exportXlsx}>
          <Download size={14} /> {t("activity.exportXlsx")}
        </Button>
      </div>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      <div className="mb-1 text-[12px] text-[var(--win-muted)]">
        {t("activity.eventsTotal", { count: total })}
        {data && data.metrics.length ? ` — ${data.metrics.slice(0, 8).map((m) => `${metricLabel(m.metric)} ${m.count}`).join("، ")}` : ""}
      </div>
      <div className="overflow-auto">
        <table className="stats-hier-table min-w-[1100px]">
          <thead>
            <tr>
              <th className="is-left">{t("activity.time")}</th>
              <th className="is-left">{t("activity.user")}</th>
              <th>{t("activity.department")}</th>
              <th className="is-left">{t("activity.what")}</th>
              <th>{t("activity.action")}</th>
              <th className="is-left">{t("activity.form")}</th>
              <th className="is-left">{t("activity.record")}</th>
              <th className="is-left">{t("activity.changes")}</th>
              <th>{t("activity.ip")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((ev, i) => (
              <tr key={`${ev.id}-${ev.metric}-${i}`} style={ev.bulk ? { opacity: 0.6 } : undefined}>
                <td className="is-left whitespace-nowrap">{formatDateTime(ev.at)}</td>
                <td className="is-left">
                  <Person row={ev} />
                </td>
                <td>{ev.department || "—"}</td>
                <td className="is-left">
                  {metricLabel(ev.metric)}
                  {ev.bulk ? <span className="text-[var(--win-muted)]"> ({t("activity.bulk")})</span> : null}
                </td>
                <td>{ev.action}</td>
                <td className="is-left">
                  {ev.resource}
                  {ev.resource_id ? <span className="text-[var(--win-muted)]"> #{ev.resource_id}</span> : null}
                </td>
                <td className="is-left">
                  {Object.entries(ev.target)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ") || [ev.element_nr, ev.electrolyzer, ev.position].filter(Boolean).join(" / ") || "—"}
                </td>
                <td className="is-left" style={{ maxWidth: 360 }}>
                  {changeText(ev).map((line, idx) => (
                    <div key={idx} className="break-all">
                      {line}
                    </div>
                  ))}
                </td>
                <td>{ev.ip || ""}</td>
              </tr>
            ))}
            {data && data.items.length === 0 ? (
              <tr>
                <td colSpan={9}>{t("activity.noActivity")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2 text-[12px]">
        <span>
          {Math.min(skip + 1, total)}–{Math.min(skip + limit, total)} / {total}
        </span>
        <Button type="button" variant="secondary" size="sm" disabled={skip <= 0} onClick={() => setSkip(Math.max(0, skip - limit))}>
          {t("common.previous")}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={skip + limit >= total} onClick={() => setSkip(skip + limit)}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- One person

function UserDetailModal({ username, base, onClose }: { username: string; base: ActivityFilters; onClose: () => void }) {
  const { t } = useI18n();
  const metricLabel = useMetricLabel();
  const params = { date_from: base.date_from, date_to: base.date_to, username };
  const query = useQuery({ queryKey: ["activity", "user-detail", params], queryFn: () => activityApi.userDetail(params) });
  const data = query.data;
  const maxHour = Math.max(1, ...(data?.hours ?? [0]));
  const [openDay, setOpenDay] = useState<string | null>(null);

  return (
    <Modal open onClose={onClose} title={`${t("activity.userDetail")}: ${username}`} wide>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <div className="space-y-3 text-[12px]">
          <div>
            <Person row={data.person} /> · {data.person.department || "—"}
          </div>
          <div className="flex flex-wrap gap-3">
            <Card label={t("activity.total")} value={data.total} />
            <Card label={t("activity.activeDays")} value={data.active_days} />
            <Card label={t("activity.bulk")} value={data.bulk} />
            <Card label={t("activity.logins")} value={data.logins.filter((l) => l.success).length} />
          </div>

          <div>
            <b>{t("activity.hourly")}</b>
            <div className="mt-1 flex h-[70px] items-end gap-[2px] border border-[#808080] bg-white p-1" dir="ltr">
              {data.hours.map((n, h) => (
                <div key={h} className="flex flex-1 flex-col items-center justify-end" title={`${h}:00 — ${n}`}>
                  <div style={{ height: `${(n / maxHour) * 48}px`, background: "#0a246a", width: "100%", minHeight: n ? 2 : 0 }} />
                  <div className="text-[9px] text-[var(--win-muted)]">{h}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <b>{t("activity.perForm")}</b>
            <div>{data.by_resource.map((r) => `${r.resource} (${r.count})`).join("، ") || "—"}</div>
          </div>

          <div className="overflow-auto">
            <b>{t("activity.perDay")}</b>
            <table className="stats-hier-table mt-1 min-w-[700px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.date")}</th>
                  <th>{t("activity.firstAction")}</th>
                  <th>{t("activity.lastAction")}</th>
                  <th>{t("activity.span")}</th>
                  <th>{t("activity.total")}</th>
                  <th>{t("activity.bulk")}</th>
                  <th className="is-left">{t("activity.what")}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <Fragment key={d.date}>
                    <tr className="cursor-pointer" onClick={() => setOpenDay(openDay === d.date ? null : d.date)}>
                      <td className="is-left">
                        <b>{formatDate(d.date)}</b>
                      </td>
                      <td>{d.first_at ? formatDateTime(d.first_at).slice(-8) : "—"}</td>
                      <td>{d.last_at ? formatDateTime(d.last_at).slice(-8) : "—"}</td>
                      <td>{d.span_minutes ? `${Math.floor(d.span_minutes / 60)}h ${d.span_minutes % 60}m` : ""}</td>
                      <td>
                        <b>{d.total}</b>
                      </td>
                      <td>{d.bulk || ""}</td>
                      <td className="is-left">
                        {Object.entries(d.counts)
                          .filter(([k]) => k !== "logins")
                          .map(([k, v]) => `${metricLabel(k)} ${v}`)
                          .join("، ")}
                      </td>
                    </tr>
                    {openDay === d.date ? (
                      <tr>
                        <td colSpan={7} className="is-left">
                          <b>{t("activity.perForm")}:</b> {Object.entries(d.resources).map(([k, v]) => `${k} (${v})`).join("، ")}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data.logins.length ? (
            <div className="overflow-auto">
              <b>{t("activity.logins")}</b>
              <table className="stats-hier-table mt-1 min-w-[500px]">
                <tbody>
                  {data.logins.slice(0, 20).map((l, i) => (
                    <tr key={i}>
                      <td className="is-left">{formatDateTime(l.at)}</td>
                      <td style={l.success ? undefined : RED}>{l.success ? t("activity.loginOk") : t("activity.loginFailed")}</td>
                      <td>{l.ip || ""}</td>
                      <td className="is-left">{l.agent || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div>
            <b>{t("activity.allActions")}</b>
            <div className="mt-1">
              <EventList base={{ date_from: base.date_from, date_to: base.date_to, username }} />
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------- Summary

function SummaryTab({ base }: { base: ActivityFilters }) {
  const { t } = useI18n();
  const metricLabel = useMetricLabel();
  const { isShamsi } = useCalendar();
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");
  const [groups, setGroups] = useState<string[]>([...GROUPS]);
  const [detailUser, setDetailUser] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ username: string; metric: string } | null>(null);

  const filters: ActivityFilters = { ...base, granularity, calendar: isShamsi ? "jalali" : "gregorian" };
  const query = useQuery({ queryKey: ["activity", "summary", filters], queryFn: () => activityApi.summary(filters) });

  const metrics = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    return data.metrics.filter((m) => groups.includes(m.group) && data.user_totals.some((u) => (u.counts[m.key] ?? 0) > 0));
  }, [query.data, groups]);

  const groupTotal = (row: ActivityRow) => metrics.reduce((sum, m) => sum + (row.counts[m.key] ?? 0), 0);
  const periodLabel = (r: { period: string; period_start?: string; period_end?: string }) => {
    if (granularity === "day" && r.period_start) return formatDate(r.period_start);
    if (granularity === "week" && r.period_start && r.period_end) return `${formatDate(r.period_start)} – ${formatDate(r.period_end)}`;
    return r.period;
  };
  const cell = (row: { username: string; counts: Record<string, number> }, key: string) =>
    row.counts[key] ? (
      <button type="button" className="underline decoration-dotted" onClick={() => setDrill({ username: row.username, metric: key })}>
        {row.counts[key]}
      </button>
    ) : (
      ""
    );

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
        <Button type="button" variant="secondary" size="sm" onClick={() => downloadExport("/activity/summary", "xlsx", filters, "activity.xlsx")}>
          <Download size={14} /> {t("activity.exportXlsx")}
        </Button>
        <span className="text-[var(--win-muted)]">{t("activity.clickHint")}</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        {GROUPS.map((g) => (
          <label key={g} className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={groups.includes(g)}
              onChange={() => setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))}
            />
            {t(`activity.group_${g}`)}
          </label>
        ))}
      </div>

      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}

      {query.data ? (
        <>
          <SectionTitle>{t("activity.userTotals")}</SectionTitle>
          <div className="mb-4 overflow-auto">
            <table className="stats-hier-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.user")}</th>
                  <th>{t("activity.department")}</th>
                  {metrics.map((m) => (
                    <th key={m.key}>{metricLabel(m.key)}</th>
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
                    <td colSpan={metrics.length + 7}>{t("activity.noActivity")}</td>
                  </tr>
                ) : (
                  query.data.user_totals.map((u) => (
                    <tr key={u.username}>
                      <td className="is-left">
                        <Person row={u} onOpen={setDetailUser} />
                      </td>
                      <td>{u.department || "—"}</td>
                      {metrics.map((m) => (
                        <td key={m.key}>{cell(u, m.key)}</td>
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

          <SectionTitle>{t("activity.byPeriod")}</SectionTitle>
          <div className="mb-4 overflow-auto">
            <table className="stats-hier-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.period")}</th>
                  <th className="is-left">{t("activity.user")}</th>
                  <th>{t("activity.department")}</th>
                  {metrics.map((m) => (
                    <th key={m.key}>{metricLabel(m.key)}</th>
                  ))}
                  <th>{t("activity.elements")}</th>
                  <th>{t("activity.total")}</th>
                  <th>{t("activity.firstAction")}</th>
                  <th>{t("activity.lastAction")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((r) => {
                  const total = groupTotal(r);
                  if (total === 0 && r.bulk === 0) return null;
                  return (
                    <tr key={`${r.period}-${r.username}`}>
                      <td className="is-left">{periodLabel({ period: r.period ?? "", period_start: r.period_start, period_end: r.period_end })}</td>
                      <td className="is-left">
                        <Person row={r} onOpen={setDetailUser} />
                      </td>
                      <td>{r.department || "—"}</td>
                      {metrics.map((m) => (
                        <td key={m.key}>{r.counts[m.key] || ""}</td>
                      ))}
                      <td>{r.distinct_elements || ""}</td>
                      <td>
                        <b>{total}</b>
                      </td>
                      <td>{r.first_at ? formatDateTime(r.first_at).slice(-8) : ""}</td>
                      <td>{r.last_at ? formatDateTime(r.last_at).slice(-8) : ""}</td>
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

      {detailUser ? <UserDetailModal username={detailUser} base={base} onClose={() => setDetailUser(null)} /> : null}
      {drill ? (
        <Modal open onClose={() => setDrill(null)} title={`${drill.username} — ${metricLabel(drill.metric)}`} wide>
          <EventList
            base={{ date_from: base.date_from, date_to: base.date_to, username: drill.username === "(system)" ? undefined : drill.username }}
            presetMetric={drill.metric}
          />
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Cell shop

function MiniTable({ rows, first, metrics }: { rows: { name: string; counts: Record<string, number>; total: number }[]; first: string; metrics: string[] }) {
  const metricLabel = useMetricLabel();
  return (
    <div className="overflow-auto">
      <table className="stats-hier-table min-w-[500px]">
        <thead>
          <tr>
            <th className="is-left">{first}</th>
            {metrics.map((m) => (
              <th key={m}>{metricLabel(m)}</th>
            ))}
            <th>Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="is-left">
                <b>{r.name}</b>
              </td>
              {metrics.map((m) => (
                <td key={m}>{r.counts[m] || ""}</td>
              ))}
              <td>
                <b>{r.total}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellShopTab({ base }: { base: ActivityFilters }) {
  const { t } = useI18n();
  const metricLabel = useMetricLabel();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["activity", "cell-shop", base], queryFn: () => activityApi.cellShop(base) });
  const data = query.data;

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--win-muted)]">{t("activity.cellShopHelp")}</p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <div className="mb-2 flex flex-wrap gap-3">
            {ELEMENT_METRICS.map((m) => (
              <Card key={m} label={metricLabel(m)} value={data.totals.counts[m] ?? 0} />
            ))}
            <Card label={t("activity.elements")} value={data.totals.distinct_elements} />
          </div>
          <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            <div>
              <SectionTitle>{t("activity.byUser")}</SectionTitle>
              <MiniTable rows={data.by_user.map((u) => ({ name: u.username, counts: u.counts, total: u.total }))} first={t("activity.user")} metrics={ELEMENT_METRICS} />
            </div>
            <div>
              <SectionTitle>{t("activity.byElectrolyzer")}</SectionTitle>
              <MiniTable rows={data.by_electrolyzer.map((u) => ({ name: u.electrolyzer, counts: u.counts, total: u.total }))} first={t("activity.electrolyzer")} metrics={ELEMENT_METRICS} />
            </div>
          </div>

          <SectionTitle>{t("activity.perDay")}</SectionTitle>
          <div className="overflow-auto">
            <table className="stats-hier-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.date")}</th>
                  {ELEMENT_METRICS.map((m) => (
                    <th key={m}>{metricLabel(m)}</th>
                  ))}
                  <th>{t("activity.elements")}</th>
                  <th className="is-left">{t("activity.byUser")}</th>
                  <th className="is-left">{t("activity.byElectrolyzer")}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.length === 0 ? (
                  <tr>
                    <td colSpan={ELEMENT_METRICS.length + 4}>{t("activity.noActivity")}</td>
                  </tr>
                ) : null}
                {data.days.map((d) => (
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
                      <td className="is-left">{d.electrolyzers.map((u) => `${u.electrolyzer} (${u.total})`).join("، ")}</td>
                    </tr>
                    {open === d.date ? (
                      <tr>
                        <td colSpan={ELEMENT_METRICS.length + 4} className="is-left">
                          <table className="stats-hier-table">
                            <thead>
                              <tr>
                                <th className="is-left">{t("activity.element")}</th>
                                <th>{t("activity.electrolyzer")}</th>
                                <th>{t("activity.position")}</th>
                                <th className="is-left">{t("activity.timeline")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.elements.map((e) => (
                                <tr key={e.element_nr}>
                                  <td className="is-left">
                                    <b>{e.element_nr}</b>
                                  </td>
                                  <td>{e.electrolyzer || ""}</td>
                                  <td>{e.position || ""}</td>
                                  <td className="is-left">
                                    {e.events.map((ev, i) => (
                                      <div key={`${ev.id}-${i}`}>
                                        {formatDateTime(ev.at).slice(-8)} — {metricLabel(ev.metric)} <span className="text-[var(--win-muted)]">({ev.username})</span>
                                      </div>
                                    ))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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

// ---------------------------------------------------------------- Warehouse

function WarehouseTab({ base }: { base: ActivityFilters }) {
  const { t } = useI18n();
  const [kind, setKind] = useState("");
  const query = useQuery({ queryKey: ["activity", "warehouse", base], queryFn: () => activityApi.warehouse(base) });
  const data = query.data;
  const rows = (data?.rows ?? []).filter((r) => !kind || r.kind === kind);

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--win-muted)]">{t("activity.warehouseHelp")}</p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <div className="mb-2 flex flex-wrap gap-3">
            {WH_KINDS.map((k) => {
              const s = data.summary.find((x) => x.kind === k);
              return <Card key={k} label={t(`activity.kind_${k}`)} value={s ? `${s.documents} / ${s.items}` : "0"} />;
            })}
          </div>
          <div className="mb-1 text-[11px] text-[var(--win-muted)]">{t("activity.documentsItems")}</div>
          <div className="mb-2 text-[12px]">
            <b>{t("activity.byUser")}:</b>{" "}
            {data.by_user.map((u) => `${u.username} (${Object.entries(u.counts).map(([k, v]) => `${t(`activity.kind_${k}`)} ${v}`).join(", ")})`).join(" · ") || "—"}
          </div>
          <div className="mb-2 flex items-end gap-2 text-[12px]">
            <div>
              <Label>{t("activity.what")}</Label>
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">{t("activity.all")}</option>
                {WH_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`activity.kind_${k}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="stats-hier-table min-w-[800px]">
              <thead>
                <tr>
                  <th className="is-left">{t("activity.date")}</th>
                  <th className="is-left">{t("activity.what")}</th>
                  <th className="is-left">{t("activity.number")}</th>
                  <th className="is-left">{t("activity.company")}</th>
                  <th>{t("activity.items")}</th>
                  <th className="is-left">{t("activity.detail")}</th>
                  <th>{t("activity.status")}</th>
                  <th className="is-left">{t("activity.user")}</th>
                  <th className="is-left">{t("activity.remarks")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>{t("activity.noActivity")}</td>
                  </tr>
                ) : null}
                {rows.map((r, i) => (
                  <tr key={`${r.kind}-${r.number}-${r.date}-${i}`}>
                    <td className="is-left">{formatDate(r.date)}</td>
                    <td className="is-left">{t(`activity.kind_${r.kind}`)}</td>
                    <td className="is-left">{r.number || ""}</td>
                    <td className="is-left">{r.company || ""}</td>
                    <td>{r.items}</td>
                    <td className="is-left">{r.detail}</td>
                    <td>{r.status || ""}</td>
                    <td className="is-left">{r.users.join(", ") || "—"}</td>
                    <td className="is-left">{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Laboratory

function LabTab({ base }: { base: ActivityFilters }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["activity", "lab", base], queryFn: () => activityApi.lab(base) });
  const data = query.data;

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--win-muted)]">
        {data?.source === "habitual" ? t("activity.labHelpHabitual") : t("activity.labHelp", { count: data?.expected_per_day ?? 0 })}
        {data?.filtered ? ` ${t("activity.labFiltered")}` : ""}
      </p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <div className="mb-3 flex flex-wrap gap-3">
            <Card label={t("activity.completeness")} value={data.summary.completeness_pct == null ? "—" : `${data.summary.completeness_pct}%`} />
            <Card label={t("activity.expected")} value={data.summary.expected} />
            <Card label={t("activity.entered")} value={data.summary.entered} />
            <Card label={t("activity.missing")} value={data.summary.missing} red={data.summary.missing > 0} />
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 text-[12px] md:grid-cols-2">
            <div>
              <b>{t("activity.enteredByUser")}</b>
              <div>{data.entered_by_user.map((u) => `${u.username} (${u.count})`).join("، ") || "—"}</div>
            </div>
            <div>
              <b>{t("activity.missingByType")}</b>
              <div>{data.missing_by_type.map((m) => `${m.analysis_type} (${m.missing}/${m.expected})`).join("، ") || "—"}</div>
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
                  <th className="is-left">{t("activity.byType")}</th>
                  <th className="is-left">{t("activity.enteredByUser")}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <Fragment key={d.date}>
                    <tr className="cursor-pointer" onClick={() => setOpen(open === d.date ? null : d.date)}>
                      <td className="is-left">
                        <b>{formatDate(d.date)}</b>
                        {d.open ? <span className="text-[var(--win-muted)]"> · {t("activity.dayOpen")}</span> : null}
                      </td>
                      <td>{d.expected}</td>
                      <td>{d.entered}</td>
                      <td style={d.missing && !d.open ? RED : undefined}>{d.missing || ""}</td>
                      <td className="is-left">{d.types.map((x) => `${x.analysis_type} ${x.entered}/${x.expected}`).join("، ")}</td>
                      <td className="is-left">{d.users.map((u) => `${u.username} (${u.count})`).join("، ")}</td>
                    </tr>
                    {open === d.date ? (
                      <tr>
                        <td colSpan={6} className="is-left">
                          {d.missing_items.length ? (
                            <div className="mb-2">
                              <b style={RED}>{t("activity.notEntered")} ({d.missing_items.length}):</b> {d.missing_items.join(" · ")}
                            </div>
                          ) : null}
                          {d.entries.length ? (
                            <table className="stats-hier-table">
                              <thead>
                                <tr>
                                  <th className="is-left">{t("activity.samplePoint")}</th>
                                  <th>{t("activity.sampleTime")}</th>
                                  <th className="is-left">{t("activity.enteredByUser")}</th>
                                  <th>{t("activity.enteredAt")}</th>
                                  <th>{t("activity.parameters")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.entries.map((e, i) => (
                                  <tr key={i}>
                                    <td className="is-left">{e.label}</td>
                                    <td>{e.sample_time}</td>
                                    <td className="is-left">{e.username}</td>
                                    <td>{e.entered_at ? formatDateTime(e.entered_at) : "—"}</td>
                                    <td>{e.parameters}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
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
                  <td style={r.failed ? RED : undefined}>{r.failed || ""}</td>
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

function ReportList({ rows, kind }: { rows: ActivityInspectionReport[]; kind: "inspection" | "assembly" }) {
  const { t } = useI18n();
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="stats-hier-table min-w-[900px]">
        <thead>
          <tr>
            <th className="is-left">{t("activity.date")}</th>
            <th className="is-left">{t("activity.element")}</th>
            <th>{t("activity.electrolyzer")}</th>
            <th className="is-left">{t("activity.inspector")}</th>
            {kind === "inspection" ? (
              <>
                <th className="is-left">{t("activity.reason")}</th>
                <th className="is-left">{t("activity.findings")}</th>
              </>
            ) : (
              <>
                <th>{t("activity.status")}</th>
                <th>{t("activity.checked")}</th>
                <th className="is-left">{t("activity.failedChecks")}</th>
              </>
            )}
            <th className="is-left">{t("activity.signed")}</th>
            <th className="is-left">{t("activity.enteredByUser")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9}>{t("activity.noActivity")}</td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="is-left">{formatDate(r.date)}</td>
              <td className="is-left">
                <b>{r.element_nr || "—"}</b>
              </td>
              <td>{[r.electrolyzer, r.position].filter(Boolean).join("/")}</td>
              <td className="is-left">{r.inspector}</td>
              {kind === "inspection" ? (
                <>
                  <td className="is-left">{r.reason}</td>
                  <td className="is-left" style={r.findings?.length ? RED : undefined}>
                    {r.findings?.join(" · ") || ""}
                  </td>
                </>
              ) : (
                <>
                  <td style={r.status === "failed" ? RED : undefined}>{r.status ? t(`activity.${r.status}`) : ""}</td>
                  <td>
                    {r.checked}/{r.total_checks}
                  </td>
                  <td className="is-left">{r.failed_checks?.join(" · ") || ""}</td>
                </>
              )}
              <td className="is-left">{r.signed.join(", ")}</td>
              <td className="is-left">{r.entered_by || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InspectionTab({ base }: { base: ActivityFilters }) {
  const { t } = useI18n();
  const query = useQuery({ queryKey: ["activity", "inspections", base], queryFn: () => activityApi.inspections(base) });
  const data = query.data;

  return (
    <div>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {data ? (
        <>
          <p className="mb-2 text-[12px] text-[var(--win-muted)]">{data.note}</p>
          <SectionTitle>
            {t("activity.inspectionReports")} — {data.inspection_reports.total} ({t("activity.withFindings")}: {data.inspection_reports.with_findings})
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            <InspectionTable rows={data.inspection_reports.by_inspector} kind="inspection" firstHeader={t("activity.inspector")} />
            <InspectionTable rows={data.inspection_reports.by_day} kind="inspection" firstHeader={t("activity.date")} newestFirst />
          </div>
          <div className="mb-3 text-[12px]">
            <b>{t("activity.byReason")}:</b> {data.inspection_reports.by_reason.map((r) => `${r.reason} (${r.count})`).join("، ") || "—"}
            <br />
            <b>{t("activity.topFindings")}:</b> {data.inspection_reports.top_findings.map((r) => `${r.field} (${r.count})`).join("، ") || "—"}
          </div>
          <ReportList rows={data.inspection_reports.reports} kind="inspection" />

          <SectionTitle>
            {t("activity.assemblyReports")} — {data.assembly_reports.total} ({t("activity.passed")}: {data.assembly_reports.passed}, {t("activity.failed")}: {data.assembly_reports.failed},{" "}
            {t("activity.incomplete")}: {data.assembly_reports.incomplete})
          </SectionTitle>
          <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            <InspectionTable rows={data.assembly_reports.by_inspector} kind="assembly" firstHeader={t("activity.inspector")} />
            <InspectionTable rows={data.assembly_reports.by_day} kind="assembly" firstHeader={t("activity.date")} newestFirst />
          </div>
          <div className="mb-3 text-[12px]">
            <b>{t("activity.topFailedChecks")}:</b> {data.assembly_reports.top_failed_checks.map((r) => `${r.check} (${r.count})`).join("، ") || "—"}
          </div>
          <ReportList rows={data.assembly_reports.reports} kind="assembly" />
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
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ range: { from: isoDay(-6), to: isoDay(0) }, roleId: "", username: "" });

  const base: ActivityFilters = useMemo(
    () => ({
      date_from: filters.range.from,
      date_to: filters.range.to,
      role_id: filters.roleId ? Number(filters.roleId) : undefined,
      username: filters.username || undefined,
    }),
    [filters]
  );

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
      <FilterBar value={filters} onChange={setFilters} />
      <Tabs
        tabs={[
          { key: "summary", label: t("activity.tabSummary"), content: <SummaryTab base={base} /> },
          { key: "events", label: t("activity.tabEvents"), content: <EventList base={base} /> },
          { key: "cell", label: t("activity.tabCellShop"), content: <CellShopTab base={base} /> },
          { key: "warehouse", label: t("activity.tabWarehouse"), content: <WarehouseTab base={base} /> },
          { key: "lab", label: t("activity.tabLab"), content: <LabTab base={base} /> },
          { key: "inspection", label: t("activity.tabInspection"), content: <InspectionTab base={base} /> },
        ]}
      />
    </AccessFormWindow>
  );
}
