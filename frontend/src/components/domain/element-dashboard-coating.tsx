"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Clock, Hammer, Send, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { elementDashboardApi } from "@/lib/endpoints";
import type { DashPart } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { Chips, DashKpi } from "./element-dashboard-ui";
import { PartsTable } from "./element-dashboard-parts";

type Kind = "anode" | "cathode";
type ListKey = "at_coater" | "pending_check" | "candidates" | "installed_due";

function AtCoaterTable({ rows }: { rows: DashPart[] }) {
  const { t } = useI18n();
  return (
    <div className="ed-table-wrap">
      <table className="ed-table">
        <thead>
          <tr>
            <th>{t("elDash.col.piece")}</th>
            <th>{t("elDash.col.coater")}</th>
            <th>{t("elDash.col.sendNo")}</th>
            <th>{t("elDash.col.sentOn")}</th>
            <th>{t("elDash.col.daysAway")}</th>
            <th>{t("elDash.col.recoats")}</th>
            <th>{t("elDash.col.totalDol")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <strong>{r.serial}</strong>
              </td>
              <td>{r.coater || "—"}</td>
              <td>{r.send_no || "—"}</td>
              <td>{formatDate(r.dispatch_date)}</td>
              <td className="ed-num">
                <span className={r.days_away != null && r.days_away > 60 ? "ed-badge ed-tone-red" : undefined}>{r.days_away ?? "—"}</span>
              </td>
              <td className="ed-num">{r.recoat_count ?? 0}</td>
              <td className="ed-num">{r.total_dol == null ? "—" : formatNumber(r.total_dol, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ElementCoatingTab() {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>("anode");
  const [list, setList] = useState<ListKey>("at_coater");
  const query = useQuery({ queryKey: ["element-dashboard", "coating", kind], queryFn: () => elementDashboardApi.coating(kind) });
  const data = query.data;

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  const s = data.summary;
  const rows = data[list] as DashPart[];

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.coatingHelp")}</p>
      <Chips
        value={kind}
        onChange={(k) => {
          setKind(k);
          setList("at_coater");
        }}
        options={[
          { key: "anode", label: t("elDash.kind.anode") },
          { key: "cathode", label: t("elDash.kind.cathode") },
        ]}
      />

      <div className="mon-kpi-row">
        <DashKpi label={t("elDash.coat.recoated")} value={formatNumber(s.recoated_pieces, 0)} hint={t("elDash.coat.ofPieces", { total: s.pieces })} icon={CheckCircle2} tone="ok" />
        <DashKpi label={t("elDash.coat.jobs")} value={formatNumber(s.recoat_jobs, 0)} hint={t("elDash.coat.never", { count: s.never_recoated })} icon={Hammer} tone="info" />
        <DashKpi label={t("elDash.coat.atCoater")} value={formatNumber(s.at_coater, 0)} hint={t("elDash.coat.longest", { days: s.max_days_away })} icon={Truck} tone={s.at_coater ? "warning" : "neutral"} active={list === "at_coater"} onClick={() => setList("at_coater")} />
        <DashKpi label={t("elDash.coat.pending")} value={formatNumber(s.pending_check, 0)} hint={t("elDash.coat.pendingHint")} icon={ClipboardCheck} tone={s.pending_check ? "warning" : "neutral"} active={list === "pending_check"} onClick={() => setList("pending_check")} />
        <DashKpi label={t("elDash.coat.sendNow")} value={formatNumber(s.candidates, 0)} hint={t("elDash.coat.sendNowHint")} icon={Send} tone={s.candidates ? "danger" : "ok"} active={list === "candidates"} onClick={() => setList("candidates")} />
        <DashKpi label={t("elDash.coat.installedDue")} value={formatNumber(s.installed_due, 0)} hint={t("elDash.coat.installedDueHint")} icon={Clock} tone={s.installed_due ? "warning" : "ok"} active={list === "installed_due"} onClick={() => setList("installed_due")} />
        <DashKpi label={t("elDash.coat.turnaround")} value={s.avg_turnaround_days == null ? "—" : `${formatNumber(s.avg_turnaround_days, 0)} d`} icon={Clock} tone="info" />
      </div>
      {s.thin_threshold == null ? <p className="ed-note is-warning">{t("elDash.coat.noThinLimit")}</p> : null}

      <div className="ed-grid-3">
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.coat.timesChart")}</h3>
          <div className="ed-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.times} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="pieces" name={t("elDash.coat.pieces")} fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.coat.byYear")}</h3>
          <div className="ed-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_year} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sent" name={t("elDash.coat.sent")} fill="#2563eb" />
                <Bar dataKey="returned" name={t("elDash.coat.returned")} fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.coat.byMonth")}</h3>
          <div className="ed-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="sent" name={t("elDash.coat.sent")} fill="#2563eb" />
                <Bar dataKey="returned" name={t("elDash.coat.returned")} fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t("elDash.coat.coaters")}</h3>
        {data.coaters.length === 0 ? (
          <div className="mon-empty">{t("elDash.coat.noJobs")}</div>
        ) : (
          <table className="ed-table">
            <thead>
              <tr>
                <th>{t("elDash.col.coater")}</th>
                <th>{t("elDash.coat.jobs")}</th>
                <th>{t("elDash.coat.returned")}</th>
                <th>{t("elDash.coat.open")}</th>
                <th>{t("elDash.coat.turnaround")}</th>
              </tr>
            </thead>
            <tbody>
              {data.coaters.map((c) => (
                <tr key={c.coater}>
                  <td>
                    <strong>{c.coater}</strong>
                  </td>
                  <td className="ed-num">{c.jobs}</td>
                  <td className="ed-num">{c.returned}</td>
                  <td className="ed-num">{c.open}</td>
                  <td className="ed-num">{c.avg_days == null ? "—" : `${c.avg_days} d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t(`elDash.coat.list.${list}`)}</h3>
        <p className="mon-sub mb-2">{t(`elDash.coat.listHelp.${list}`)}</p>
        {rows.length === 0 ? (
          <div className="mon-empty">{t("elDash.coat.emptyList")}</div>
        ) : list === "at_coater" ? (
          <AtCoaterTable rows={rows} />
        ) : (
          <PartsTable rows={rows} kind={kind} showReasons={list === "candidates" || list === "installed_due"} />
        )}
        {data.truncated && (list === "candidates" || list === "installed_due") ? <p className="mon-sub">{t("elDash.truncated", { count: rows.length })}</p> : null}
      </section>
    </div>
  );
}
