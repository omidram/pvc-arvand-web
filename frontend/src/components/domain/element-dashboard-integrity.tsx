"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Save, Wrench } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { AuditRelation, AuditRepairResult, ElementDashSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import { DashKpi } from "./element-dashboard-ui";

const SEVERITY_TONE: Record<string, string> = { error: "red", warning: "amber", info: "blue", ok: "green" };

function Status({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`ed-badge ed-tone-${SEVERITY_TONE[status] ?? "slate"}`}>{t(`elDash.audit.status.${status}`)}</span>;
}

function RelationRow({ rel }: { rel: AuditRelation }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => rel.status !== "ok" && setOpen(!open)} style={{ cursor: rel.status !== "ok" ? "pointer" : undefined }}>
        <td>
          <strong>{rel.label}</strong>
          <div className="ed-mute">
            {rel.child} → {rel.parent}
          </div>
        </td>
        <td className="ed-num">{formatNumber(rel.ok_rows, 0)}</td>
        <td className="ed-num">{rel.spelling_rows ? `${formatNumber(rel.spelling_rows, 0)} (${rel.spelling_values})` : "—"}</td>
        <td className="ed-num">{rel.orphan_rows ? `${formatNumber(rel.orphan_rows, 0)} (${rel.orphan_values})` : "—"}</td>
        <td>
          <Status status={rel.status} />
          {rel.status !== "ok" && rel.fixable ? <span className="ed-badge ed-tone-teal ms-1">{t("elDash.audit.fixable")}</span> : null}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} className="bg-[var(--win-face)]">
            {rel.spelling.length ? (
              <p>
                <strong>{t("elDash.audit.spelling")}:</strong> {rel.spelling.map((s) => `${s.value} → ${s.should_be} (${s.rows})`).join(" · ")}
              </p>
            ) : null}
            {rel.orphans.length ? (
              <p>
                <strong>{t("elDash.audit.orphans")}:</strong> {rel.orphans.map((o) => `${o.value} (${o.rows})`).join(" · ")}
              </p>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function ElementIntegrityTab() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [result, setResult] = useState<AuditRepairResult | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const query = useQuery({ queryKey: ["element-dashboard", "relations"], queryFn: () => elementDashboardApi.relations(false) });
  const repair = useMutation({
    mutationFn: (mode: "all" | "links" | "fill") => elementDashboardApi.repair({ mode }),
    onSuccess: (res) => {
      setResult(res);
      qc.invalidateQueries({ queryKey: ["element-dashboard"] });
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  const report = query.data;
  const s = report.summary;
  const relations = onlyProblems ? report.relations.filter((r) => r.status !== "ok") : report.relations;
  const fillable = report.consistency.filter((c) => c.fixable && c.count);

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.audit.help")}</p>
      <div className="mon-kpi-row">
        <DashKpi label={t("elDash.audit.relations")} value={`${s.relations_ok} / ${s.relations}`} hint={t("elDash.audit.relationsHint")} icon={Link2} tone={s.relations_with_problems ? "warning" : "ok"} />
        <DashKpi label={t("elDash.audit.spellingRows")} value={formatNumber(s.spelling_rows, 0)} tone={s.spelling_rows ? "warning" : "ok"} icon={Wrench} hint={t("elDash.audit.spellingHint")} />
        <DashKpi label={t("elDash.audit.orphanRows")} value={formatNumber(s.orphan_rows, 0)} tone={s.orphan_rows ? "warning" : "ok"} icon={Link2} hint={t("elDash.audit.orphanHint")} />
        <DashKpi label={t("elDash.audit.idLinks")} value={formatNumber(s.id_links_broken, 0)} tone={s.id_links_broken ? "danger" : "ok"} icon={Link2} />
        <DashKpi label={t("elDash.audit.consistency")} value={formatNumber(s.consistency_issues, 0)} tone={s.consistency_issues ? "warning" : "ok"} icon={CheckCircle2} />
      </div>

      {isAdmin ? (
        <div className="ed-actionbar">
          <Button type="button" disabled={repair.isPending || !s.fixable} onClick={() => repair.mutate("links")}>
            <Wrench className="h-4 w-4" />
            {t("elDash.audit.fixLinks")}
          </Button>
          <Button type="button" variant="secondary" disabled={repair.isPending || !fillable.length} onClick={() => repair.mutate("fill")}>
            <Save className="h-4 w-4" />
            {t("elDash.audit.fillMasters")}
          </Button>
          <span className="mon-sub">{repair.isPending ? t("elDash.audit.working") : t("elDash.audit.repairHint")}</span>
        </div>
      ) : (
        <p className="ed-note">{t("elDash.audit.adminOnly")}</p>
      )}
      {repair.isError ? <ErrorState message={(repair.error as Error).message} /> : null}
      {result ? (
        <p className="ed-note is-ok">
          {t("elDash.audit.done", { renamed: result.renamed_rows, created: result.created_masters, filled: result.masters_filled })}
        </p>
      ) : null}

      <section className="mon-panel">
        <div className="mon-panel-head">
          <h3 className="mon-panel-title">{t("elDash.audit.tableLinks")}</h3>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            {t("elDash.audit.onlyProblems")}
          </label>
        </div>
        {relations.length === 0 ? (
          <div className="mon-empty">{t("elDash.audit.allGood")}</div>
        ) : (
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th>{t("elDash.audit.link")}</th>
                  <th>{t("elDash.audit.okRows")}</th>
                  <th>{t("elDash.audit.spelling")}</th>
                  <th>{t("elDash.audit.orphans")}</th>
                  <th>{t("elDash.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((rel) => (
                  <RelationRow key={rel.name} rel={rel} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t("elDash.audit.consistencyTitle")}</h3>
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th>{t("elDash.audit.check")}</th>
                <th>{t("elDash.audit.count")}</th>
                <th>{t("elDash.audit.examples")}</th>
                <th>{t("elDash.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {report.consistency.map((c) => (
                <tr key={c.name}>
                  <td>{c.label}</td>
                  <td className="ed-num">{c.count}</td>
                  <td className="ed-mute">{c.examples.slice(0, 4).join(" · ")}</td>
                  <td>
                    <Status status={c.status} />
                    {c.fixable ? <span className="ed-badge ed-tone-teal ms-1">{t("elDash.audit.fixable")}</span> : null}
                  </td>
                </tr>
              ))}
              {report.id_links
                .filter((l) => l.status !== "ok")
                .map((l) => (
                  <tr key={l.child}>
                    <td>{l.label}</td>
                    <td className="ed-num">{l.broken_rows}</td>
                    <td className="ed-mute">{l.examples.join(" · ")}</td>
                    <td>
                      <Status status="error" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SettingsForm({ initial }: { initial: ElementDashSettings }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const editable = canEdit("elements") || canEdit("anodes") || canEdit("cathodes") || canEdit("membranes");
  const [form, setForm] = useState({
    anode_life_days: String(initial.anode_life_days ?? ""),
    cathode_life_days: String(initial.cathode_life_days ?? ""),
    membrane_life_days: String(initial.membrane_life_days ?? ""),
    warn_percent: String(initial.warn_percent ?? 85),
    coating_thickness_min: initial.coating_thickness_min == null ? "" : String(initial.coating_thickness_min),
    shop_queue_days: String(initial.shop_queue_days ?? 90),
  });
  const save = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      return elementDashboardApi.saveSettings({
        anode_life_days: num(form.anode_life_days),
        cathode_life_days: num(form.cathode_life_days),
        membrane_life_days: num(form.membrane_life_days),
        warn_percent: Number(form.warn_percent) || 85,
        coating_thickness_min: num(form.coating_thickness_min),
        shop_queue_days: form.shop_queue_days.trim() === "" ? 90 : Number(form.shop_queue_days),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["element-dashboard"] }),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.settings.help")}</p>
      <div className="ed-note is-warning">{t("elDash.settings.placeholder")}</div>
      <div className="ed-filters">
        <label>
          {t("elDash.settings.anodeLife")}
          <input type="number" min={1} disabled={!editable} value={form.anode_life_days} onChange={set("anode_life_days")} />
        </label>
        <label>
          {t("elDash.settings.cathodeLife")}
          <input type="number" min={1} disabled={!editable} value={form.cathode_life_days} onChange={set("cathode_life_days")} />
        </label>
        <label>
          {t("elDash.settings.membraneLife")}
          <input type="number" min={1} disabled={!editable} value={form.membrane_life_days} onChange={set("membrane_life_days")} />
        </label>
        <label>
          {t("elDash.settings.warnPercent")}
          <input type="number" min={1} max={100} disabled={!editable} value={form.warn_percent} onChange={set("warn_percent")} />
        </label>
        <label>
          {t("elDash.settings.thickness")}
          <input type="number" min={0} step="0.1" disabled={!editable} value={form.coating_thickness_min} onChange={set("coating_thickness_min")} />
        </label>
        <label title={t("elDash.settings.queueDaysHint")}>
          {t("elDash.settings.queueDays")}
          <input type="number" min={0} max={3650} disabled={!editable} value={form.shop_queue_days} onChange={set("shop_queue_days")} />
        </label>
      </div>
      <p className="mon-sub">{t("elDash.settings.queueDaysHint")}</p>
      {editable ? (
        <div>
          <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4" />
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          {save.isSuccess ? <span className="ms-3 text-sm text-green-700">{t("elDash.settings.saved")}</span> : null}
          {save.isError ? <span className="ms-3 text-sm text-red-700">{(save.error as Error).message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ElementSettingsTab() {
  const query = useQuery({ queryKey: ["element-dashboard", "settings"], queryFn: elementDashboardApi.settings });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  return <SettingsForm key={JSON.stringify(query.data)} initial={query.data} />;
}
