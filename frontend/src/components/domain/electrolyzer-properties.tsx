"use client";

import { useQuery } from "@tanstack/react-query";
import { monitoringApi, type ElectrolyzerProperties } from "@/lib/endpoints";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { inspectionReasonLabel } from "@/lib/inspection-reason-names";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "" || value === "—") return null;
  return (
    <div className="psm-elo-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChipList({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number }[];
}) {
  if (!items.length) return null;
  return (
    <div className="psm-elo-chips">
      <h5>{title}</h5>
      <div>
        {items.map((item) => (
          <span key={`${item.label}-${item.count}`}>
            {item.label} <b>{item.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="psm-elo-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function ElementTable({
  rows,
  empty,
}: {
  rows: ElectrolyzerProperties["recent_installs"];
  empty: string;
}) {
  const { t } = useI18n();
  if (!rows.length) return <p className="psm-muted">{empty}</p>;
  return (
    <div className="psm-elo-table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("monitoring.elementNr")}</th>
            <th>{t("monitoring.place")}</th>
            <th>{t("fields.anodeNr")}</th>
            <th>{t("fields.cathodeNr")}</th>
            <th>{t("fields.membraneNr")}</th>
            <th>{t("fields.assemblyDate")}</th>
            <th>{t("monitoring.dol")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.element_nr || "—"}</td>
              <td>
                {row.position ? String(row.position).padStart(3, "0") : "—"}
                {row.active ? ` · ${t("monitoring.partStatus.mounted")}` : ""}
              </td>
              <td>{row.anode_nr || "—"}</td>
              <td>{row.cathode_nr || "—"}</td>
              <td>{row.membrane_nr || "—"}</td>
              <td>{formatDate(row.assembly_date) || "—"}</td>
              <td>{row.dol_days ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ElectrolyzerPropertiesPanel({ name }: { name: string }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["monitoring", "electrolyzer", name],
    queryFn: () => monitoringApi.electrolyzer({ electrolyzer: name }),
  });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  const data = query.data;
  const summary = data.summary;
  const layout = data.layout[0];
  const norm = data.normalization;

  return (
    <div className="psm-elo-props">
      <div className="psm-elo-props-head">
        <div>
          <div className="psm-kicker">{t("monitoring.properties")}</div>
          <h4>
            {name.slice(0, -1)}
            <sub>{name.slice(-1)}</sub>
            {data.arrangement ? <span> · {data.arrangement}</span> : null}
          </h4>
        </div>
        <div className="psm-elo-props-kpis">
          <span>
            <small>{t("monitoring.activeCells")}</small>
            <b>{summary.active_cells}</b>
          </span>
          <span>
            <small>{t("monitoring.occupiedCells")}</small>
            <b>{summary.occupied_positions}</b>
          </span>
          <span>
            <small>{t("monitoring.emptyCells")}</small>
            <b>{summary.empty_positions}</b>
          </span>
          <span>
            <small>{t("monitoring.dismantledCells")}</small>
            <b>{summary.dismantled}</b>
          </span>
          <span>
            <small>{t("monitoring.avgDol")}</small>
            <b>{summary.avg_dol_days ?? "—"}</b>
          </span>
        </div>
      </div>

      <div className="psm-elo-grid">
        <Section title={t("monitoring.layout")}>
          <div className="psm-elo-facts">
            <Fact label={t("monitoring.train")} value={data.train === "1" ? t("monitoring.train1") : data.train === "2" ? t("monitoring.train2") : data.train} />
            <Fact label={t("monitoring.arrangement")} value={data.arrangement} />
            <Fact label={t("monitoring.transformer")} value={layout?.transformer} />
            <Fact label={t("monitoring.rectifier")} value={layout?.rectifier} />
            <Fact label={t("monitoring.subPlant")} value={layout?.sub_plant} />
            {data.layout.map((row) => (
              <Fact
                key={`${row.block}-${row.start_position}-${row.end_position}`}
                label={`${t("monitoring.block")} ${row.block || "—"}`}
                value={
                  row.start_position || row.end_position
                    ? `${row.start_position || "—"}–${row.end_position || "—"}`
                    : null
                }
              />
            ))}
          </div>
        </Section>

        <Section title={t("monitoring.liveSnapshot")}>
          <div className="psm-elo-facts">
            <Fact label={t("monitoring.allInstalls")} value={summary.installations} />
            <Fact label={t("monitoring.activeCells")} value={summary.active_cells} />
            <Fact label={t("monitoring.occupiedCells")} value={summary.occupied_positions} />
            <Fact label={t("monitoring.emptyCells")} value={summary.empty_positions} />
            <Fact label={t("monitoring.dismantledCells")} value={summary.dismantled} />
            <Fact label={t("monitoring.avgDol")} value={summary.avg_dol_days} />
          </div>
          <ChipList title={t("monitoring.membraneMix")} items={summary.membrane_types} />
          <ChipList title={t("monitoring.coatingMix")} items={summary.anode_coatings} />
        </Section>

        <Section title={t("monitoring.voltageNorm")}>
          {norm ? (
            <div className="psm-elo-facts">
              <Fact label={t("fields.date")} value={formatDate(norm.date)} />
              <Fact label={t("fields.time")} value={norm.time} />
              <Fact label={t("fields.totalCurrent")} value={formatNumber(norm.total_current, 2)} />
              <Fact label={t("fields.totalVoltage")} value={formatNumber(norm.total_voltage, 2)} />
              <Fact label={t("fields.elementCount")} value={norm.element_count} />
              <Fact label={t("fields.anolyteTemp")} value={formatNumber(norm.anolyte_temp, 1)} />
              <Fact label={t("fields.catholyteTemp")} value={formatNumber(norm.catholyte_temp, 1)} />
              <Fact label={t("monitoring.rackAAvg")} value={formatNumber(norm.rack_a_avg, 3)} />
              <Fact label={t("monitoring.rackBAvg")} value={formatNumber(norm.rack_b_avg, 3)} />
              <Fact label={t("monitoring.cl2Pct")} value={formatNumber(norm.cl2_pct, 2)} />
              <Fact label={t("monitoring.h2Pct")} value={formatNumber(norm.h2_pct, 2)} />
            </div>
          ) : (
            <p className="psm-muted">{t("monitoring.noNormalization")}</p>
          )}
          {data.current_efficiency ? (
            <div className="psm-elo-facts" style={{ marginTop: "0.55rem" }}>
              <Fact
                label={t("monitoring.currentEfficiency")}
                value={`${formatNumber(data.current_efficiency.value_pct, 2)}% · ${formatDate(data.current_efficiency.date) || "—"}`}
              />
            </div>
          ) : null}
        </Section>
      </div>

      <Section title={t("monitoring.recentInstalls")}>
        <ElementTable rows={data.recent_installs} empty={t("monitoring.noRecentInstalls")} />
      </Section>

      <Section title={t("monitoring.recentDismantles")}>
        <ElementTable rows={data.recent_dismantles} empty={t("monitoring.noRecentDismantles")} />
      </Section>

      <div className="psm-elo-grid">
        <Section title={t("monitoring.analyses")}>
          {data.analyses.length === 0 ? <p className="psm-muted">{t("monitoring.noAnalyses")}</p> : null}
          <div className="psm-elo-cards">
            {data.analyses.map((row) => (
              <article key={row.id}>
                <header>
                  <strong>{t(`enums.analysisType.${row.analysis_type}`)}</strong>
                  <span>{formatDate(row.date) || "—"}</span>
                </header>
                <div className="psm-elo-params">
                  {Object.entries(row.parameters || {})
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <span key={key}>
                        {key}: <b>{String(value)}</b>
                      </span>
                    ))}
                </div>
              </article>
            ))}
          </div>
        </Section>

        <Section title={t("monitoring.openAlerts")}>
          {data.alerts.length === 0 ? <p className="psm-muted">{t("monitoring.noAlerts")}</p> : null}
          <div className="psm-elo-cards">
            {data.alerts.map((row) => (
              <article key={row.id} className={`is-${row.severity}`}>
                <header>
                  <strong>{row.title}</strong>
                  <span>{row.severity}</span>
                </header>
                <p>
                  {row.position ? `${name}-${String(row.position).padStart(3, "0")} · ` : ""}
                  {row.message || ""}
                  {row.value != null ? ` · ${Number(row.value).toFixed(3)} V` : ""}
                </p>
              </article>
            ))}
          </div>
        </Section>
      </div>

      <div className="psm-elo-grid">
        <Section title={t("monitoring.shutdowns")}>
          {data.shutdowns.length === 0 ? <p className="psm-muted">{t("monitoring.noShutdowns")}</p> : null}
          <div className="psm-elo-cards">
            {data.shutdowns.map((row) => (
              <article key={row.nr}>
                <header>
                  <strong>{row.plant_part || name}</strong>
                  <span>{formatDateTime(row.shutdown_time) || "—"}</span>
                </header>
                <p>
                  {[row.category, row.cause, row.remarks].filter(Boolean).join(" · ") || "—"}
                  {row.startup_time ? ` · ${formatDateTime(row.startup_time)}` : ""}
                </p>
              </article>
            ))}
          </div>
        </Section>

        <Section title={t("monitoring.inspections")}>
          {data.inspections.length === 0 ? <p className="psm-muted">{t("monitoring.noInspections")}</p> : null}
          <div className="psm-elo-cards">
            {data.inspections.map((row) => (
              <article key={row.id}>
                <header>
                  <strong>{row.element_nr || "—"}</strong>
                  <span>{formatDate(row.inspection_date) || "—"}</span>
                </header>
                <p>
                  {row.position ? `${String(row.position).padStart(3, "0")} · ` : ""}
                  {inspectionReasonLabel(row.inspection_reason, t)}
                  {row.inspector_name ? ` · ${row.inspector_name}` : ""}
                </p>
              </article>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
