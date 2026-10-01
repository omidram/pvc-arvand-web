"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleDot,
  RefreshCw,
  Save,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { monitoringApi } from "@/lib/endpoints";
import type { AlertEvent, AlertRule, MonitoringCellStatus } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { VoltageHistoryDialog } from "@/components/domain/voltage-history-dialog";
import { PlantSchematic } from "@/components/domain/plant-schematic";
import { CellHealthBoardPanel } from "@/components/domain/cell-health-board";
import { MonitoringExport } from "@/components/domain/export-buttons";
import { trainOf, type TrainId } from "@/lib/plant-topology";

function MonitoringLoad({ label }: { label: string }) {
  return (
    <div className="mon-load" role="status" aria-live="polite">
      <div className="mon-load-track" role="progressbar" aria-label={label}>
        <div className="mon-load-bar" />
      </div>
      <p>{label}</p>
    </div>
  );
}

function severityClass(sev: string): string {
  if (sev === "danger") return "is-danger";
  if (sev === "warning") return "is-warning";
  if (sev === "ok") return "is-ok";
  return "is-unknown";
}

function Kpi({
  label,
  value,
  tone,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  tone: "danger" | "warning" | "ok" | "neutral" | "info";
  icon: typeof Zap;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mon-kpi mon-kpi-${tone}${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active ? true : false}
    >
      <div className="mon-kpi-icon">
        <Icon size={18} />
      </div>
      <div>
        <div className="mon-kpi-value">{value}</div>
        <div className="mon-kpi-label">{label}</div>
      </div>
    </button>
  );
}

function AlertsPanel({
  alerts,
  canEdit,
}: {
  alerts: AlertEvent[];
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: (id: number) => monitoringApi.acknowledge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });
  const resolve = useMutation({
    mutationFn: (id: number) => monitoringApi.resolve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });

  if (!alerts.length) {
    return <div className="mon-empty">{t("monitoring.noAlerts")}</div>;
  }

  return (
    <div className="mon-alert-list">
      {alerts.map((a) => (
        <article key={a.id} className={`mon-alert ${severityClass(a.severity)}`}>
          <div className="mon-alert-main">
            <div className="mon-alert-title">
              <ShieldAlert size={16} />
              <span>{a.title}</span>
              <span className={`mon-sev-badge ${severityClass(a.severity)}`}>{a.severity}</span>
              <span className="mon-status-badge">{a.status}</span>
            </div>
            <p className="mon-alert-msg">{a.message}</p>
            <div className="mon-alert-meta">
              {a.electrolyzer ? `${a.electrolyzer}${a.position ? `-${a.position}` : ""}` : ""}
              {a.value != null ? ` · ${Number(a.value).toFixed(3)} V` : ""}
              {a.threshold != null ? ` · ${t("monitoring.limit")} ${a.threshold}` : ""}
              {` · ${formatDateTime(a.created_at)}`}
            </div>
          </div>
          {canEdit && a.status !== "resolved" ? (
            <div className="mon-alert-actions">
              {a.status === "open" ? (
                <Button type="button" variant="secondary" onClick={() => ack.mutate(a.id)}>
                  {t("monitoring.acknowledge")}
                </Button>
              ) : null}
              <Button type="button" onClick={() => resolve.mutate(a.id)}>
                {t("monitoring.resolve")}
              </Button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function RulesPanel() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("monitoring") || canEdit("voltage");
  const qc = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ["monitoring", "rules"], queryFn: monitoringApi.listRules });
  const [drafts, setDrafts] = useState<Record<number, AlertRule>>({});

  useEffect(() => {
    if (rulesQuery.data) {
      setDrafts(Object.fromEntries(rulesQuery.data.map((r) => [r.id, { ...r }])));
    }
  }, [rulesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ops = Object.values(drafts).map((r) =>
        monitoringApi.updateRule(r.id, {
          name: r.name,
          warning_threshold: r.warning_threshold,
          danger_threshold: r.danger_threshold,
          enabled: r.enabled,
          notify: r.notify,
          electrolyzer: r.electrolyzer,
          operator: r.operator,
        })
      );
      await Promise.all(ops);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });

  if (rulesQuery.isLoading) return <LoadingState />;
  if (rulesQuery.isError) return <ErrorState message={(rulesQuery.error as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="mon-panel-head">
        <p className="mon-help">{t("monitoring.rulesHelp")}</p>
        <MonitoringExport scope="rules" filenameBase="monitoring-thresholds" />
      </div>
      <div className="mon-rules">
        {Object.values(drafts).map((rule) => (
          <div key={rule.id} className="mon-rule-row">
            <label className="mon-rule-enable">
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={!editable}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [rule.id]: { ...rule, enabled: e.target.checked } }))
                }
              />
            </label>
            <div className="mon-rule-body">
              <div className="mon-rule-name">{rule.name}</div>
              <div className="mon-rule-desc">
                {rule.description || rule.metric} · {rule.operator}
              </div>
              <div className="mon-rule-fields">
                <div>
                  <Label>{t("monitoring.warningLimit")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!editable}
                    value={rule.warning_threshold ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [rule.id]: {
                          ...rule,
                          warning_threshold: e.target.value === "" ? null : Number(e.target.value),
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>{t("monitoring.dangerLimit")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!editable}
                    value={rule.danger_threshold ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [rule.id]: {
                          ...rule,
                          danger_threshold: e.target.value === "" ? null : Number(e.target.value),
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <Label>{t("monitoring.electrolyzerFilter")}</Label>
                  <Input
                    disabled={!editable}
                    placeholder={t("monitoring.allElectrolyzers")}
                    value={rule.electrolyzer ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [rule.id]: { ...rule, electrolyzer: e.target.value || null },
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {editable ? (
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? t("monitoring.saving") : t("monitoring.saveRules")}
        </Button>
      ) : null}
      {saveMutation.isSuccess ? <span className="text-sm text-green-700">{t("monitoring.rulesSaved")}</span> : null}
    </div>
  );
}

function OverviewTab({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const [history, setHistory] = useState<{ electrolyzer: string; position?: string } | null>(null);
  const [plantView, setPlantView] = useState<
    { level: "plant" } | { level: "train"; train: TrainId } | { level: "electrolyzer"; train: TrainId; name: string }
  >({ level: "plant" });
  const [elFilter, setElFilter] = useState<string>("all");
  const [focus, setFocus] = useState<"danger" | "warning" | "ok" | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const issuesRef = useRef<HTMLElement>(null);

  const snapQuery = useQuery({
    queryKey: ["monitoring", "snapshot"],
    queryFn: monitoringApi.snapshot,
    refetchInterval: 20_000,
  });
  const progressQuery = useQuery({
    queryKey: ["monitoring", "import-progress"],
    queryFn: monitoringApi.importProgress,
    refetchInterval: 15_000,
  });

  const evalMutation = useMutation({
    mutationFn: () => monitoringApi.evaluate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monitoring"] }),
  });

  const data = snapQuery.data;

  if (snapQuery.isLoading) return <MonitoringLoad label={t("monitoring.loading")} />;
  if (snapQuery.isError || !data) return <ErrorState message={(snapQuery.error as Error)?.message || "Error"} />;

  const { summary, voltage } = data;
  const focusLabel =
    focus === "danger"
      ? t("monitoring.openDanger")
      : focus === "warning"
        ? t("monitoring.openWarning")
        : focus === "ok"
          ? t("monitoring.cellsOk")
          : "";

  function toggleFocus(next: "danger" | "warning" | "ok") {
    setFocus((prev) => (prev === next ? null : next));
  }

  function openHottestCell() {
    let best: MonitoringCellStatus | null = null;
    for (const block of data?.electrolyzers || []) {
      for (const cell of block.cells) {
        if (cell.voltage == null) continue;
        if (!best || Number(cell.voltage) > Number(best.voltage)) best = cell;
      }
    }
    if (!best) return;
    setFocus(null);
    setElFilter(best.electrolyzer);
    const train = trainOf(best.electrolyzer);
    if (train) setPlantView({ level: "electrolyzer", train, name: best.electrolyzer });
    setHistory({ electrolyzer: best.electrolyzer, position: best.position });
  }

  function toggleIssues() {
    const next = !issuesOpen;
    setIssuesOpen(next);
    if (next) {
      window.setTimeout(() => issuesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    }
  }

  const componentIssues = issuesOpen ? data.component_issues : data.component_issues.slice(0, 30);

  return (
    <div className="mon-page">
      <div className="mon-toolbar">
        <div>
          <h2 className="mon-heading">{t("monitoring.liveTitle")}</h2>
          <p className="mon-sub">
            {t("monitoring.updatedAt", { time: formatDateTime(data.generated_at) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="mon-select"
            value={elFilter}
            onChange={(e) => {
              const value = e.target.value;
              setElFilter(value);
              const train = trainOf(value);
              if (value !== "all" && train) setPlantView({ level: "electrolyzer", train, name: value });
              if (value === "all") setPlantView({ level: "plant" });
            }}
          >
            <option value="all">{t("monitoring.allElectrolyzers")}</option>
            {data.electrolyzers.map((e) => (
              <option key={e.electrolyzer} value={e.electrolyzer}>
                {e.electrolyzer}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" onClick={() => snapQuery.refetch()}>
            <RefreshCw className="h-4 w-4" />
            {t("monitoring.refresh")}
          </Button>
          {canEdit("monitoring") || canEdit("voltage") ? (
            <Button type="button" onClick={() => evalMutation.mutate()} disabled={evalMutation.isPending}>
              <Bell className="h-4 w-4" />
              {evalMutation.isPending ? t("monitoring.evaluating") : t("monitoring.evaluateNow")}
            </Button>
          ) : null}
          <MonitoringExport
            scope={plantView.level === "electrolyzer" ? "electrolyzer" : plantView.level === "train" ? "train" : "plant"}
            train={plantView.level === "plant" ? undefined : plantView.train}
            electrolyzer={plantView.level === "electrolyzer" ? plantView.name : undefined}
            filenameBase={
              plantView.level === "electrolyzer"
                ? `monitoring-${plantView.name}`
                : plantView.level === "train"
                  ? `monitoring-train-${plantView.train}`
                  : "monitoring-plant"
            }
          />
        </div>
      </div>

      {progressQuery.data?.active ? (
        <p className="mon-import-note">
          {t("monitoring.importProgress", {
            done: progressQuery.data.done,
            total: progressQuery.data.total,
            names: progressQuery.data.names.join(", ") || "—",
          })}
        </p>
      ) : null}

      {data.electrolyzers.length === 0 ? (
        <div className="mon-empty">{t("monitoring.noVoltageData")}</div>
      ) : (
        <PlantSchematic
          blocks={data.electrolyzers}
          focus={focus}
          view={plantView}
          onView={(next) => {
            setPlantView(next);
            setElFilter(next.level === "electrolyzer" ? next.name : "all");
          }}
          onOpenCell={(cell) => setHistory({ electrolyzer: cell.electrolyzer, position: cell.position })}
          onOpenTotal={(electrolyzer) => setHistory({ electrolyzer })}
        />
      )}

      <div className="mon-kpi-row">
        <Kpi
          label={t("monitoring.totalCells")}
          value={voltage.cell_count}
          tone="info"
          icon={Activity}
          onClick={() => setFocus(null)}
        />
        <Kpi
          label={t("monitoring.openDanger")}
          value={voltage.danger_count}
          tone="danger"
          icon={ShieldAlert}
          active={focus === "danger"}
          onClick={() => toggleFocus("danger")}
        />
        <Kpi
          label={t("monitoring.openWarning")}
          value={voltage.warning_count}
          tone="warning"
          icon={AlertTriangle}
          active={focus === "warning"}
          onClick={() => toggleFocus("warning")}
        />
        <Kpi
          label={t("monitoring.cellsOk")}
          value={voltage.ok_count}
          tone="ok"
          icon={CheckCircle2}
          active={focus === "ok"}
          onClick={() => toggleFocus("ok")}
        />
        <Kpi
          label={t("monitoring.maxCellV")}
          value={voltage.max_voltage != null ? Number(voltage.max_voltage).toFixed(3) : "—"}
          tone="info"
          icon={Zap}
          onClick={openHottestCell}
        />
        <Kpi
          label={t("monitoring.loadKa")}
          value={voltage.current_ka != null ? formatNumber(voltage.current_ka, 1) : "—"}
          tone="info"
          icon={Activity}
          onClick={() => setFocus(null)}
        />
        <Kpi
          label={t("monitoring.powerKw")}
          value={voltage.power_kw != null ? formatNumber(voltage.power_kw, 0) : "—"}
          tone="info"
          icon={Zap}
          onClick={() => setFocus(null)}
        />
        <Kpi
          label={t("monitoring.energyKwh24h")}
          value={voltage.energy_kwh_24h != null ? formatNumber(voltage.energy_kwh_24h, 0) : "—"}
          tone="info"
          icon={Zap}
          onClick={() => setFocus(null)}
        />
        <Kpi
          label={t("monitoring.componentIssues")}
          value={voltage.component_issue_count}
          tone="neutral"
          icon={CircleDot}
          active={issuesOpen}
          onClick={toggleIssues}
        />
        <Kpi
          label={t("monitoring.openInbox")}
          value={summary.open_total}
          tone={summary.open_danger > 0 ? "danger" : summary.open_total > 0 ? "warning" : "neutral"}
          icon={Bell}
          onClick={onOpenAlerts}
        />
      </div>
      {focus ? <p className="mon-filter-note">{t("monitoring.filterShowing", { label: focusLabel })}</p> : null}

      <div className="mon-legend">
        <span className="mon-legend-item is-ok">{t("monitoring.legendOk")}</span>
        <span className="mon-legend-item is-warning">{t("monitoring.legendWarning")}</span>
        <span className="mon-legend-item is-danger">{t("monitoring.legendDanger")}</span>
          <span className="mon-legend-item is-unknown">{t("monitoring.legendUnknown")}</span>
          <span className="text-xs text-[var(--win-muted)]">{t("monitoring.historyHint")}</span>
        </div>

      <div className="mon-split">
        <section className="mon-panel">
          <div className="mon-panel-head">
            <h3 className="mon-panel-title">{t("monitoring.recentAlerts")}</h3>
            <MonitoringExport scope="alerts" status="open" filenameBase="monitoring-alerts-open" />
          </div>
          <AlertsPanel
            alerts={data.recent_alerts.filter((a) => a.status !== "resolved").slice(0, 12)}
            canEdit={canEdit("monitoring") || canEdit("voltage")}
          />
        </section>
        <section ref={issuesRef} className={`mon-panel${issuesOpen ? " is-focus" : ""}`} id="mon-component-issues">
          <div className="mon-panel-head">
            <h3 className="mon-panel-title">{t("monitoring.anodeCathodeIssues")}</h3>
            <MonitoringExport scope="issues" filenameBase="monitoring-issues" />
          </div>
          {data.component_issues.length === 0 ? (
            <div className="mon-empty">{t("monitoring.noComponentIssues")}</div>
          ) : (
            <div className="mon-issue-list">
              {componentIssues.map((issue, idx) => (
                <div key={`${issue.kind}-${issue.element_nr}-${idx}`} className={`mon-issue ${severityClass(issue.severity)}`}>
                  <strong>{issue.kind.replaceAll("_", " ")}</strong>
                  <span>
                    {issue.electrolyzer}
                    {issue.position ? `-${issue.position}` : ""}
                    {issue.element_nr ? ` · ${issue.element_nr}` : ""}
                    {issue.component_ref ? ` · ${issue.component_ref}` : ""}
                  </span>
                  <span className="mon-issue-detail">{issue.detail}</span>
                </div>
              ))}
            </div>
          )}
          {!issuesOpen && data.component_issues.length > 30 ? (
            <button type="button" className="mon-history-link mt-2 text-xs" onClick={toggleIssues}>
              {t("monitoring.showAllIssues", { count: data.component_issues.length })}
            </button>
          ) : null}
        </section>
      </div>

      {history ? (
        <VoltageHistoryDialog
          electrolyzer={history.electrolyzer}
          position={history.position}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}

function InboxTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const [status, setStatus] = useState("open");
  const alertsQuery = useQuery({
    queryKey: ["monitoring", "alerts", status],
    queryFn: () => monitoringApi.listAlerts({ status, limit: 200 }),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-3">
      <div className="mon-panel-head">
        <div className="flex flex-wrap gap-2">
        {(["open", "acknowledged", "resolved", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`mon-filter-chip ${status === s ? "is-active" : ""}`}
            onClick={() => setStatus(s)}
          >
            {t(`monitoring.status.${s}`)}
          </button>
        ))}
        </div>
        <MonitoringExport scope="alerts" status={status} filenameBase={`monitoring-alerts-${status}`} />
      </div>
      {alertsQuery.isLoading ? (
        <LoadingState />
      ) : alertsQuery.isError ? (
        <ErrorState message={(alertsQuery.error as Error).message} />
      ) : (
        <AlertsPanel alerts={alertsQuery.data || []} canEdit={canEdit("monitoring") || canEdit("voltage")} />
      )}
    </div>
  );
}

export default function MonitoringPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("overview");
  const snapshotQuery = useQuery({
    queryKey: ["monitoring", "snapshot"],
    queryFn: monitoringApi.snapshot,
    refetchInterval: 60_000,
  });
  const electrolyzers = useMemo(
    () => (snapshotQuery.data?.electrolyzers || []).map((block) => block.electrolyzer).filter(Boolean),
    [snapshotQuery.data]
  );

  return (
    <AccessFormWindow caption={t("monitoring.title")} helpKey="monitoring">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: t("monitoring.tabOverview"), content: <OverviewTab onOpenAlerts={() => setTab("alerts")} /> },
          {
            key: "health",
            label: t("monitoring.tabHealth"),
            content: (
              <CellHealthBoardPanel
                electrolyzers={electrolyzers.length ? electrolyzers : ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2", "E1", "E2", "F1", "F2", "G1", "G2", "H1", "H2", "J1", "J2", "K1", "K2", "L1", "L2", "M1", "M2"]}
              />
            ),
          },
          { key: "alerts", label: t("monitoring.tabAlerts"), content: <InboxTab /> },
          { key: "rules", label: t("monitoring.tabRules"), content: <RulesPanel /> },
        ]}
      />
    </AccessFormWindow>
  );
}
