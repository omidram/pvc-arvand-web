"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CircleCheck,
  CalendarClock,
  Flame,
  Layers,
  Link2,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { elementDashboardApi } from "@/lib/endpoints";
import type { ElementStage, LifeBin } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { ElementReportGuideButton } from "./element-report-guide";
import { MiniStat, STAGE_FLOW, STAGE_TONE, StageBadge } from "./element-dashboard-ui";

export type DashTab = "overview" | "flow" | "shop" | "parts" | "installed" | "cells" | "coating" | "integrity" | "settings";

export interface OpenTarget {
  tab: DashTab;
  stage?: string;
  kind?: "anode" | "cathode" | "membrane";
  life?: string;
  where?: string;
  due?: string;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="mon-load" role="status" aria-live="polite">
      <div className="mon-load-track" role="progressbar" aria-label={label}>
        <div className="mon-load-bar" />
      </div>
      <p>{label}</p>
    </div>
  );
}

function LifeHistogram({ title, data, kind, onOpen }: { title: string; data: LifeBin[]; kind: "anode" | "cathode" | "membrane"; onOpen: (t: OpenTarget) => void }) {
  const { t } = useI18n();
  return (
    <section className="mon-panel">
      <div className="mon-panel-head">
        <h3 className="mon-panel-title">{title}</h3>
        <button type="button" className="mon-history-link text-xs" onClick={() => onOpen({ tab: "parts", kind, life: "alert", where: "all" })}>
          {t("elDash.openList")}
        </button>
      </div>
      <div className="ed-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="installed" name={t("elDash.installed")} stackId="a" fill="#2563eb" />
            <Bar dataKey="warehouse" name={t("elDash.notInstalled")} stackId="a" fill="#94a3b8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ElementOverviewTab({ onOpen }: { onOpen: (target: OpenTarget) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["element-dashboard", "overview"], queryFn: () => elementDashboardApi.overview(false), refetchInterval: 60_000 });
  const integrity = useQuery({ queryKey: ["element-dashboard", "integrity"], queryFn: elementDashboardApi.integrity, staleTime: 60_000 });
  const data = query.data;

  if (query.isLoading) return <Loading label={t("elDash.loading")} />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;

  const { counts, parts, coating } = data;
  const flowHints: Partial<Record<ElementStage, string>> = {
    in_service: t("elDash.hint.in_service"),
    installed: t("elDash.hint.installed"),
    decommissioned: t("elDash.hint.decommissioned"),
    awaiting_disassembly: t("elDash.hint.awaiting_disassembly"),
    awaiting_assembly: t("elDash.hint.awaiting_assembly"),
    assembling: t("elDash.hint.assembling"),
    awaiting_qc: t("elDash.hint.awaiting_qc"),
    ready: t("elDash.hint.ready"),
  };
  const endOfLife = (k: "anode" | "cathode" | "membrane") => parts[k].summary.installed_warning + parts[k].summary.installed_expired;
  const due90 = parts.anode.summary.due_90 + parts.cathode.summary.due_90 + parts.membrane.summary.due_90;
  const atCoater = coating.anode.at_coater + coating.cathode.at_coater;
  const integrityIssues = integrity.data ? integrity.data.relations_with_problems + integrity.data.consistency_issues + integrity.data.id_links_broken : null;
  const shopTotal = counts.awaiting_disassembly + counts.awaiting_assembly + counts.assembling + counts.awaiting_qc + counts.ready;

  return (
    <div className="mon-page">
      <div className="mon-toolbar">
        <div>
          <h2 className="mon-heading">{t("elDash.heading")}</h2>
          <p className="mon-sub">{t("elDash.updatedAt", { time: formatDateTime(data.generated_at) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="asm-link" onClick={() => onOpen({ tab: "flow" })}>
            {t("elDash.tab.flow")}
          </button>
          <ElementReportGuideButton />
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const fresh = await elementDashboardApi.overview(true);
              qc.setQueryData(["element-dashboard", "overview"], fresh);
              qc.invalidateQueries({ queryKey: ["element-dashboard"], predicate: (q) => q.queryKey[1] !== "overview" });
            }}
          >
            <RefreshCw className="h-4 w-4" />
            {t("elDash.refresh")}
          </Button>
        </div>
      </div>

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t("elDash.pipelineTitle")}</h3>
        <div className="ed-flow">
          {STAGE_FLOW.map((stage) => (
            <button
              key={stage}
              type="button"
              title={flowHints[stage]}
              className={`ed-flow-step ed-tone-${STAGE_TONE[stage]}${counts[stage] ? "" : " is-zero"}`}
              onClick={() => onOpen(stage === "in_service" || stage === "installed" ? { tab: "installed" } : { tab: "shop", stage })}
            >
              <span className="ed-flow-value">{formatNumber(counts[stage], 0)}</span>
              <span className="ed-flow-label">{t(`elDash.stage.${stage}`)}</span>
            </button>
          ))}
          <button
            type="button"
            title={t("elDash.disassembledHint", { recent: data.recently_disassembled })}
            className={`ed-flow-step ed-tone-slate${counts.disassembled ? "" : " is-zero"}`}
            onClick={() => onOpen({ tab: "shop", stage: "disassembled" })}
          >
            <span className="ed-flow-value">{formatNumber(counts.disassembled, 0)}</span>
            <span className="ed-flow-label">{t("elDash.stage.disassembled")}</span>
          </button>
        </div>
      </section>

      <div className="ed-grid-3">
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.group.plant")}</h3>
          <MiniStat label={t("elDash.kpi.capacity")} value={`${formatNumber(data.in_plant, 0)} / ${formatNumber(data.capacity, 0)}`} hint={data.occupancy_pct != null ? `${formatNumber(data.occupancy_pct, 1)} %` : undefined} tone="info" icon={Layers} onClick={() => onOpen({ tab: "installed" })} />
          <MiniStat label={t("elDash.kpi.voltageAlerts")} value={`${data.alerts.danger} / ${data.alerts.warning}`} hint={t("elDash.kpi.voltageAlertsHint")} tone={data.alerts.danger ? "danger" : data.alerts.warning ? "warning" : "ok"} icon={ShieldAlert} />
          <MiniStat
            label={t("elDash.kpi.integrity")}
            value={integrityIssues == null ? "…" : formatNumber(integrityIssues, 0)}
            hint={integrity.data ? t("elDash.kpi.integrityHint", { rows: integrity.data.spelling_rows + integrity.data.orphan_rows }) : undefined}
            tone={integrityIssues ? "warning" : "ok"}
            icon={Link2}
            onClick={() => onOpen({ tab: "integrity" })}
          />
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.group.life")}</h3>
          {(["anode", "cathode", "membrane"] as const).map((k) => (
            <MiniStat
              key={k}
              label={t(`elDash.kpi.${k}Eol`)}
              value={formatNumber(endOfLife(k), 0)}
              hint={t("elDash.kpi.eolHint", { expired: parts[k].summary.installed_expired })}
              tone={parts[k].summary.installed_expired ? "danger" : endOfLife(k) ? "warning" : "ok"}
              icon={Flame}
              onClick={() => onOpen({ tab: "parts", kind: k, life: "alert", where: "installed" })}
            />
          ))}
          <MiniStat label={t("elDash.kpi.due90")} value={formatNumber(due90, 0)} hint={t("elDash.kpi.due90Hint")} tone={due90 ? "warning" : "ok"} icon={CalendarClock} onClick={() => onOpen({ tab: "parts", kind: "anode", life: "all", where: "installed", due: "90" })} />
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.group.shop")}</h3>
          <MiniStat label={t("elDash.kpi.shop")} value={formatNumber(shopTotal, 0)} hint={t("elDash.kpi.shopHint")} tone={shopTotal ? "warning" : "neutral"} icon={Wrench} onClick={() => onOpen({ tab: "shop", stage: "shop" })} />
          <MiniStat label={t("elDash.kpi.ready")} value={formatNumber(counts.ready, 0)} tone="ok" icon={CircleCheck} onClick={() => onOpen({ tab: "shop", stage: "ready" })} />
          <MiniStat label={t("elDash.kpi.atCoater")} value={formatNumber(atCoater, 0)} hint={t("elDash.kpi.atCoaterHint", { anodes: coating.anode.at_coater, cathodes: coating.cathode.at_coater })} tone={atCoater ? "info" : "neutral"} icon={Boxes} onClick={() => onOpen({ tab: "coating" })} />
          <MiniStat label={t("elDash.kpi.toCoat")} value={formatNumber(coating.anode.candidates + coating.cathode.candidates, 0)} hint={t("elDash.kpi.toCoatHint")} tone="warning" icon={AlertTriangle} onClick={() => onOpen({ tab: "coating" })} />
        </section>
      </div>

      <div className="ed-grid-2">
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.chart.byElectrolyzer")}</h3>
          <div className="ed-chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_electrolyzer} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="electrolyzer" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 168]} />
                <Tooltip />
                <Bar dataKey="cells" name={t("elDash.cellsInPlant")} fill="#2563eb" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.chart.flow")}</h3>
          <div className="ed-chart-tall">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.monthly_flow} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="assembled" name={t("elDash.flow.assembled")} stroke="#7c3aed" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="commissioned" name={t("elDash.flow.commissioned")} stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="decommissioned" name={t("elDash.flow.decommissioned")} stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="disassembled" name={t("elDash.flow.disassembled")} stroke="#64748b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="ed-grid-3">
        <LifeHistogram title={t("elDash.chart.lifeAnode")} data={parts.anode.histogram} kind="anode" onOpen={onOpen} />
        <LifeHistogram title={t("elDash.chart.lifeCathode")} data={parts.cathode.histogram} kind="cathode" onOpen={onOpen} />
        <LifeHistogram title={t("elDash.chart.lifeMembrane")} data={parts.membrane.histogram} kind="membrane" onOpen={onOpen} />
      </div>

      <div className="ed-grid-3">
        {(["anode", "cathode", "membrane"] as const).map((k) => (
          <section key={k} className="mon-panel">
            <h3 className="mon-panel-title">{t(`elDash.installedTitle.${k}`)}</h3>
            <p className="ed-stage-value">{formatNumber(parts[k].summary.installed, 0)}</p>
            <p className="mon-sub">
              {t("elDash.installedLine", { service: parts[k].summary.in_service, spare: parts[k].summary.warehouse })}
            </p>
            <button type="button" className="mon-history-link mt-2 text-xs" onClick={() => onOpen({ tab: "installed" })}>
              {t("elDash.whereInstalled")}
            </button>
          </section>
        ))}
      </div>

      <div className="mon-split">
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.oldestWaiting")}</h3>
          {data.oldest_waiting.length === 0 ? (
            <div className="mon-empty">{t("elDash.nothingWaiting")}</div>
          ) : (
            <table className="ed-table">
              <thead>
                <tr>
                  <th>{t("elDash.col.element")}</th>
                  <th>{t("elDash.col.stage")}</th>
                  <th>{t("elDash.col.since")}</th>
                  <th>{t("elDash.col.days")}</th>
                </tr>
              </thead>
              <tbody>
                {data.oldest_waiting.map((row) => (
                  <tr key={row.element_nr}>
                    <td>
                      <strong>{row.element_nr}</strong>
                    </td>
                    <td>
                      <StageBadge stage={row.state} />
                    </td>
                    <td>{formatDate(row.since)}</td>
                    <td className="ed-num">{row.days_in_state ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.recentMoves")}</h3>
          {data.events.length === 0 ? (
            <div className="mon-empty">{t("elDash.noMoves")}</div>
          ) : (
            <table className="ed-table">
              <thead>
                <tr>
                  <th>{t("elDash.col.element")}</th>
                  <th>{t("elDash.col.move")}</th>
                  <th>{t("elDash.col.user")}</th>
                  <th>{t("elDash.col.when")}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.element_nr}</strong>
                    </td>
                    <td>
                      {e.from_stage ? `${t(`elDash.stage.${e.from_stage}`)} → ` : ""}
                      {e.to_stage === "clear" ? t("elDash.cleared") : t(`elDash.stage.${e.to_stage}`)}
                    </td>
                    <td>{e.user || "—"}</td>
                    <td>{formatDateTime(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="ed-note">
        <Activity className="me-1 inline h-3.5 w-3.5" />
        {t("elDash.limitsNote", { anode: data.settings.anode_life_days ?? "—", cathode: data.settings.cathode_life_days ?? "—", membrane: data.settings.membrane_life_days ?? "—", warn: data.settings.warn_percent })}{" "}
        <button type="button" className="mon-history-link" onClick={() => onOpen({ tab: "settings" })}>
          {t("elDash.changeLimits")}
        </button>
      </p>
    </div>
  );
}
