"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { monitoringApi, type ComponentDossier } from "@/lib/endpoints";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { CellHealthCard } from "@/components/domain/cell-health-chip";

type Part = { kind: "anode" | "cathode" | "membrane"; nr: string };

function PartButton({
  label,
  nr,
  detail,
  active,
  onOpen,
}: {
  label: string;
  nr: string | null | undefined;
  detail?: string | null;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`psm-part${active ? " is-active" : ""}`} disabled={!nr} onClick={onOpen}>
      <span>{label}</span>
      <strong>{nr || "—"}</strong>
      {detail ? <em>{detail}</em> : null}
    </button>
  );
}

function StaticFact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="psm-part is-static">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function Dossier({ part }: { part: Part }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["monitoring", "component", part.kind, part.nr],
    queryFn: () => monitoringApi.component(part),
  });
  const data = query.data;
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  return (
    <div className="psm-dossier">
      <div className="psm-dossier-head">
        <strong>
          {t(`monitoring.part.${data.kind}`)} {data.nr}
        </strong>
        <span className={`psm-status is-${data.status}`}>{t(`monitoring.partStatus.${data.status}`)}</span>
      </div>
      {data.place?.electrolyzer ? (
        <p className="psm-place">
          {data.place.electrolyzer}-{String(data.place.position || "").padStart(3, "0")}
          {data.place.rack ? ` · ${t(data.place.rack === "1" ? "monitoring.rack1" : "monitoring.rack2")}` : ""}
          {data.place.train ? ` · ${t(data.place.train === "1" ? "monitoring.train1" : "monitoring.train2")}` : ""}
        </p>
      ) : null}
      <Catalog catalog={data.catalog} />
      <Installations rows={data.installations} kind={data.kind} />
      <Maintenance rows={data.maintenance} kind={data.kind} />
      <Reports rows={data.reports} />
    </div>
  );
}

function Catalog({ catalog }: { catalog: ComponentDossier["catalog"] }) {
  const { t } = useI18n();
  if (!catalog) return <p className="psm-muted">{t("monitoring.noCatalog")}</p>;
  const facts = [
    [t("monitoring.manufacturer"), catalog.manufacturer],
    [t("monitoring.coating"), catalog.coating],
    [t("monitoring.membraneType"), catalog.membrane_type],
    [t("monitoring.generation"), catalog.generation],
    [t("monitoring.batch"), catalog.batch],
    [t("monitoring.received"), catalog.received_date ? formatDate(catalog.received_date) : null],
    [t("monitoring.decommissioned"), catalog.decommission_date ? formatDate(catalog.decommission_date) : null],
  ].filter(([, value]) => value);
  if (!facts.length && !catalog.remarks) return <p className="psm-muted">{t("monitoring.noCatalog")}</p>;
  return (
    <div className="psm-facts">
      {facts.map(([label, value]) => (
        <div key={label} className={label === t("monitoring.coating") ? "is-coating" : undefined}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {catalog.remarks ? <p className="psm-remarks">{catalog.remarks}</p> : null}
    </div>
  );
}

function Installations({
  rows,
  kind,
}: {
  rows: ComponentDossier["installations"];
  kind: string;
}) {
  const { t } = useI18n();
  const showCoating = kind === "anode" || kind === "cathode";
  return (
    <div className="psm-block">
      <h4>{t("monitoring.installations")}</h4>
      {rows.length === 0 ? <p className="psm-muted">{t("monitoring.noPartHistory")}</p> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t("monitoring.elementNr")}</th>
              <th>{t("monitoring.place")}</th>
              {showCoating ? <th>{t("monitoring.coating")}</th> : null}
              <th>{t("fields.assemblyDate")}</th>
              <th>{t("fields.commissioningDate")}</th>
              <th>{t("fields.disassemblyDate")}</th>
              <th>{t("monitoring.dol")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.element_nr || "—"}</td>
                <td>
                  {row.electrolyzer || "—"}
                  {row.position ? `-${String(row.position).padStart(3, "0")}` : ""}
                  {row.active ? ` · ${t("monitoring.partStatus.mounted")}` : ""}
                </td>
                {showCoating ? (
                  <td>{(kind === "anode" ? row.anode_coating : row.cathode_coating) || "—"}</td>
                ) : null}
                <td>{formatDate(row.assembly_date) || "—"}</td>
                <td>{formatDate(row.commissioning_date) || "—"}</td>
                <td>{formatDate(row.disassembly_date) || "—"}</td>
                <td>{row.dol_days ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Maintenance({ rows, kind }: { rows: ComponentDossier["maintenance"]; kind: string }) {
  const { t } = useI18n();
  return (
    <div className="psm-block">
      <h4>{t("monitoring.maintenanceLog")}</h4>
      {rows.length === 0 ? <p className="psm-muted">{t("monitoring.noPartHistory")}</p> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>{t("fields.date")}</th>
              {kind === "membrane" ? <th>{t("fields.repairWork")}</th> : (
                <>
                  <th>{t("fields.findings")}</th>
                  <th>{t("fields.action")}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.date) || "—"}</td>
                {kind === "membrane" ? (
                  <td>{row.action || "—"}</td>
                ) : (
                  <>
                    <td>{row.finding || "—"}</td>
                    <td>{row.action || "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Reports({ rows }: { rows: ComponentDossier["reports"] }) {
  const { t } = useI18n();
  return (
    <div className="psm-block">
      <h4>{t("monitoring.uploadedReports")}</h4>
      {rows.length === 0 ? <p className="psm-muted">{t("monitoring.noPartHistory")}</p> : null}
      {rows.map((row) => (
        <article key={row.id} className="psm-report">
          <strong>
            {formatDate(row.report_date) || "—"}
            {row.title ? ` · ${row.title}` : ""}
          </strong>
          {row.notes ? <p>{row.notes}</p> : null}
          <span>{t("monitoring.fileCount", { count: row.file_count })}</span>
        </article>
      ))}
    </div>
  );
}

export function CellPropertiesPanel({ electrolyzer, position }: { electrolyzer: string; position: string }) {
  const { t } = useI18n();
  const [part, setPart] = useState<Part | null>(null);
  const query = useQuery({
    queryKey: ["monitoring", "cell", electrolyzer, position],
    queryFn: () => monitoringApi.cell({ electrolyzer, position }),
  });
  const healthQuery = useQuery({
    queryKey: ["monitoring", "cell-health", electrolyzer, position],
    queryFn: () => monitoringApi.cellHealth({ electrolyzer, position }),
  });
  const current = query.data?.current;
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState message={(query.error as Error).message} />;
  const data = query.data;
  const health = healthQuery.data?.cell;
  return (
    <div className="psm-props">
      <div className="psm-props-head">
        <strong>
          {data?.electrolyzer}-{data?.position_label}
        </strong>
        <span>
          {data?.train ? t(data.train === "1" ? "monitoring.train1" : "monitoring.train2") : ""}
          {data?.rack ? ` · ${t(data.rack === "1" ? "monitoring.rack1" : "monitoring.rack2")}` : ""}
        </span>
      </div>
      {health ? (
        <CellHealthCard
          score={health.health_score}
          status={health.status}
          dolDays={health.dol_days}
          cePct={health.ce_pct}
          unAvg={health.un_avg}
          avgVoltage={health.avg_voltage}
          avgCurrentKa={health.avg_current_ka}
          reason={health.reasons[0] || null}
        />
      ) : null}
      {!current ? <p className="psm-muted">{t("monitoring.noElement")}</p> : null}
      <div className="psm-parts">
        <PartButton
          label={t("monitoring.anodeNr")}
          nr={current?.anode_nr}
          detail={current?.anode_coating}
          active={part?.kind === "anode" && part.nr === current?.anode_nr}
          onOpen={() => current?.anode_nr && setPart({ kind: "anode", nr: current.anode_nr })}
        />
        <PartButton
          label={t("monitoring.cathodeNr")}
          nr={current?.cathode_nr}
          detail={current?.cathode_coating}
          active={part?.kind === "cathode" && part.nr === current?.cathode_nr}
          onOpen={() => current?.cathode_nr && setPart({ kind: "cathode", nr: current.cathode_nr })}
        />
        <PartButton
          label={t("monitoring.membraneNr")}
          nr={current?.membrane_nr}
          active={part?.kind === "membrane" && part.nr === current?.membrane_nr}
          onOpen={() => current?.membrane_nr && setPart({ kind: "membrane", nr: current.membrane_nr })}
        />
        <StaticFact label={t("monitoring.membraneType")} value={current?.membrane_type} />
        <StaticFact label={t("fields.anodeCoating")} value={current?.anode_coating} />
        <StaticFact label={t("fields.cathodeCoating")} value={current?.cathode_coating} />
      </div>
      {current ? (
        <p className="psm-place">
          {t("monitoring.elementNr")} {current.element_nr || "—"}
          {" · "}
          {t("monitoring.dol")} {current.dol_days ?? "—"}
          {current.commissioning_date ? ` · ${formatDate(current.commissioning_date)}` : ""}
        </p>
      ) : null}
      <p className="psm-muted">{t("monitoring.clickPart")}</p>
      {part ? <Dossier part={part} /> : null}
      {data && data.history.length > 1 ? (
        <div className="psm-block">
          <h4>{t("monitoring.slotHistory")}</h4>
          <table>
            <thead>
              <tr>
                <th>{t("monitoring.elementNr")}</th>
                <th>{t("monitoring.anodeNr")}</th>
                <th>{t("fields.anodeCoating")}</th>
                <th>{t("monitoring.cathodeNr")}</th>
                <th>{t("fields.cathodeCoating")}</th>
                <th>{t("monitoring.membraneNr")}</th>
                <th>{t("fields.disassemblyDate")}</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((row) => (
                <tr key={row.id}>
                  <td>{row.element_nr || "—"}</td>
                  <td>{row.anode_nr || "—"}</td>
                  <td>{row.anode_coating || "—"}</td>
                  <td>{row.cathode_nr || "—"}</td>
                  <td>{row.cathode_coating || "—"}</td>
                  <td>{row.membrane_nr || "—"}</td>
                  <td>{row.active ? t("monitoring.partStatus.mounted") : formatDate(row.disassembly_date) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
