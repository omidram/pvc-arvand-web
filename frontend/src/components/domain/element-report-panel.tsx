"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { CellCheck, ElementDashOverview, ElementStage } from "@/lib/types";
import { VoltageGauge } from "@/components/domain/voltage-gauge";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { ElementReportGuideButton } from "./element-report-guide";
import { STAGE_FLOW, STAGE_TONE } from "./element-dashboard-ui";

type Tone = "ok" | "warning" | "danger" | "info";

function pctTone(pct: number | null, good: number, warn: number): Tone {
  if (pct == null) return "info";
  if (pct >= good) return "ok";
  if (pct >= warn) return "warning";
  return "danger";
}

function href(tab: string, extra: Record<string, string> = {}): string {
  return `/element-dashboard?${new URLSearchParams({ tab, ...extra }).toString()}`;
}

/** Element counterpart of the voltage report: where the elements are, how worn the parts are, what is at the coater. */
export function ElementReportPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { canView } = useAuth();
  const allowed = canView("elements") || canView("anodes") || canView("cathodes") || canView("membranes") || canView("storage");
  const query = useQuery({
    queryKey: ["element-dashboard", "overview"],
    queryFn: () => elementDashboardApi.overview(false),
    enabled: allowed,
    refetchInterval: 60_000,
  });
  if (!allowed) return null;

  const cls = `dash-voltage-report er-report ${compact ? "is-compact" : ""}`;
  const head = (
    <div className="dash-voltage-head">
      <div>
        <h2 className="dash-voltage-title">{t("elDash.report.title")}</h2>
        <p className="dash-voltage-sub">{t("elDash.report.sub")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ElementReportGuideButton compact={compact} />
        <Link href="/element-dashboard" className="dash-voltage-link">
          {t("elDash.report.open")}
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );

  if (query.isLoading && !query.data) {
    return (
      <section className={cls}>
        {head}
        <p className="dash-voltage-sub">{t("elDash.loading")}</p>
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className={cls}>
        {head}
        <p className="dash-voltage-sub" style={{ color: "#a10000" }}>
          {(query.error as Error | null)?.message || "Error"}
        </p>
      </section>
    );
  }
  return <Report data={query.data} compact={compact} cls={cls} head={head} />;
}

/** Is any cell holding two elements, is any element in two cells, and how full is every electrolyzer of both trains. */
function CellCheck({ check, compact }: { check: CellCheck; compact: boolean }) {
  const { t } = useI18n();
  const s = check.summary;
  const bad = s.problems;
  const limit = compact ? 4 : 10;
  return (
    <div className="er-cells">
      <div className="er-cells-head">
        <div className="er-cells-title">{t("elDash.cellCheck.title")}</div>
        <div className="er-cells-pills">
          <Link href={href("cells")} className={`mon-pill ${bad ? "is-danger" : "is-ok"}`}>
            {bad ? t("elDash.cellCheck.problems", { count: bad }) : t("elDash.cellCheck.clear")}
          </Link>
          <Link href={href("cells")} className="mon-pill is-info">
            {formatNumber(s.occupied_cells, 0)} / {formatNumber(s.capacity, 0)} {t("elDash.cellCheck.cellsFilled")}
          </Link>
          <Link href={href("cells")} className={`mon-pill ${s.conflict_cells ? "is-danger" : "is-ok"}`}>
            {s.conflict_cells} {t("elDash.cellCheck.twoInCell")}
          </Link>
          {s.stale_cells ? (
            <Link href={href("cells")} className="mon-pill is-warning">
              {s.stale_cells} {t("elDash.cellCheck.stale")}
            </Link>
          ) : null}
          <Link href={href("cells")} className={`mon-pill ${s.multi_cell_elements ? "is-danger" : "is-ok"}`}>
            {s.multi_cell_elements} {t("elDash.cellCheck.inTwoCells")}
          </Link>
        </div>
      </div>

      {bad ? (
        <ul className="er-cells-list">
          {check.problems.slice(0, limit).map((p) => (
            <li key={p.cell}>
              <Link href={href("cells", { train: p.cell.split("-")[0].slice(-1) })} className="er-cells-cell">
                {p.cell}
              </Link>
              <span className={`ed-badge ${p.status === "conflict" ? "ed-tone-red" : "ed-tone-amber"}`}>{t(`elDash.cells.status.${p.status}`)}</span>
              <span>{p.elements.join(" · ")}</span>
            </li>
          ))}
          {check.multi_cell.slice(0, Math.max(0, limit - check.problems.length)).map((m) => (
            <li key={m.element_nr}>
              <strong>{t("elDash.cells.elementIn", { nr: m.element_nr })}</strong>
              <span>{m.cells.join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="er-cells-trains">
        {check.trains.map((tr) => (
          <div key={tr.train} className="er-cells-train">
            <Link href={href("cells", { train: tr.train })} className="er-cells-train-name">
              {t("elDash.cells.train", { n: tr.train })}
            </Link>
            <div className="er-cells-chips">
              {tr.electrolyzers.map((e) => (
                <Link
                  key={e.electrolyzer}
                  href={href("cells", { train: tr.train })}
                  className={`er-cells-chip ${e.conflict ? "is-danger" : e.stale ? "is-warning" : ""}`}
                  title={t("elDash.cellCheck.chipTitle", { name: e.electrolyzer, occ: e.occupied, cap: e.capacity, conflict: e.conflict })}
                >
                  <span className="er-cells-chip-name">{e.electrolyzer}</span>
                  <span className="er-cells-chip-n">{e.occupied}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Report({ data, compact, cls, head }: { data: ElementDashOverview; compact: boolean; cls: string; head: React.ReactNode }) {
  const { t } = useI18n();
  const { counts, parts, coating } = data;
  const kinds = ["anode", "cathode", "membrane"] as const;

  const shopTotal = counts.awaiting_disassembly + counts.awaiting_assembly + counts.assembling + counts.awaiting_qc + counts.ready;
  const toShop = counts.decommissioned + counts.awaiting_disassembly;
  const installed = kinds.reduce((n, k) => n + parts[k].summary.installed_known, 0);
  const healthy = kinds.reduce((n, k) => n + parts[k].summary.installed_ok, 0);
  const healthPct = installed ? (healthy * 100) / installed : null;
  const readyPct = shopTotal ? (counts.ready * 100) / shopTotal : null;
  const eol = kinds.reduce((n, k) => n + parts[k].summary.installed_warning + parts[k].summary.installed_expired, 0);
  const expired = kinds.reduce((n, k) => n + parts[k].summary.installed_expired, 0);
  const due90 = kinds.reduce((n, k) => n + parts[k].summary.due_90, 0);
  const atCoater = coating.anode.at_coater + coating.cathode.at_coater;
  const toCoat = coating.anode.candidates + coating.cathode.candidates;
  const noLimits = installed === 0 && kinds.every((k) => parts[k].summary.installed > 0);

  return (
    <section className={cls}>
      {head}

      <div className="dash-total-banner">
        <div className="dash-total-metrics">
          <div>
            <div className="dash-total-label">{t("elDash.report.inService")}</div>
            <div className="dash-total-value">
              {formatNumber(counts.in_service, 0)}
              <span className="dash-total-unit">/ {formatNumber(data.capacity, 0)}</span>
            </div>
          </div>
          <div>
            <div className="dash-total-label">{t("elDash.report.ready")}</div>
            <div className="dash-total-value">{formatNumber(counts.ready, 0)}</div>
          </div>
          <div>
            <div className="dash-total-label">{t("elDash.report.inShop")}</div>
            <div className="dash-total-value">{formatNumber(shopTotal, 0)}</div>
          </div>
        </div>
        <div>
          <div className="dash-total-meta">{t("elDash.updatedAt", { time: formatDateTime(data.generated_at) })}</div>
          <div className="dash-total-chips">
            <Link href={href("shop", { stage: "decommissioned" })} className={`mon-pill ${toShop ? "is-warning" : "is-ok"}`}>
              {toShop} {t("elDash.report.toShop")}
            </Link>
            <Link href={href("parts", { life: "alert", where: "installed" })} className={`mon-pill ${expired ? "is-danger" : eol ? "is-warning" : "is-ok"}`}>
              {eol} {t("elDash.report.nearEol")}
            </Link>
            <Link href={href("coating")} className={`mon-pill ${toCoat ? "is-warning" : "is-ok"}`}>
              {atCoater} {t("elDash.report.atCoater")} · {toCoat} {t("elDash.report.toCoat")}
            </Link>
          </div>
        </div>
      </div>

      <div className="er-pipeline" role="list">
        {STAGE_FLOW.map((stage: ElementStage) => (
          <Link
            key={stage}
            role="listitem"
            href={stage === "in_service" || stage === "installed" ? href("installed") : href("shop", { stage })}
            className={`er-stage ed-tone-${STAGE_TONE[stage]}`}
          >
            <span className="er-stage-value">{formatNumber(counts[stage], 0)}</span>
            <span className="er-stage-label">{t(`elDash.stage.${stage}`)}</span>
          </Link>
        ))}
      </div>

      <div className="dash-gauge-row is-four">
        <VoltageGauge value={data.occupancy_pct} max={100} label={t("elDash.report.occupancy")} unit="%" tone={pctTone(data.occupancy_pct, 95, 80)} digits={1} />
        <VoltageGauge value={noLimits ? null : healthPct} max={100} label={t("elDash.report.partsHealth")} unit="%" tone={pctTone(healthPct, 90, 75)} digits={1} />
        <VoltageGauge value={readyPct} max={100} label={t("elDash.report.shopReadiness")} unit="%" tone={readyPct == null ? "info" : readyPct >= 30 ? "ok" : "warning"} digits={0} />
        <VoltageGauge value={due90} max={Math.max(due90, 20)} label={t("elDash.report.due90")} unit={t("elDash.report.parts")} tone={due90 ? "warning" : "ok"} digits={0} />
      </div>

      {data.cell_check ? <CellCheck check={data.cell_check} compact={compact} /> : null}

      {!compact ? (
        <div className="er-parts">
          {kinds.map((k) => {
            const s = parts[k].summary;
            return (
              <Link key={k} href={href("parts", { kind: k, where: "installed", life: "all" })} className="er-part">
                <span className="er-part-name">{t(`elDash.installedTitle.${k}`)}</span>
                <span className="er-part-value">{formatNumber(s.installed, 0)}</span>
                <span className="er-part-sub">
                  {t("elDash.report.partLine", { warn: s.installed_warning, expired: s.installed_expired, due: s.due_90 })}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
