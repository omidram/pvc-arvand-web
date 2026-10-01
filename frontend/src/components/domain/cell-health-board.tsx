"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, HeartPulse, Search } from "lucide-react";
import { monitoringApi, type CellHealthBoard, type CellHealthRow } from "@/lib/endpoints";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import { VoltageHistoryDialog } from "@/components/domain/voltage-history-dialog";
import { CellHealthMini } from "@/components/domain/cell-health-chip";

function healthClass(status: string): string {
  if (status === "critical") return "is-danger";
  if (status === "investigate") return "is-warning";
  if (status === "watch") return "is-watch";
  if (status === "ok") return "is-ok";
  return "is-unknown";
}

function HealthKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "ok" | "warning" | "danger" | "neutral" | "info";
}) {
  return (
    <div className={`mon-kpi mon-kpi-${tone}`}>
      <div className="mon-kpi-icon">
        <HeartPulse size={18} />
      </div>
      <div>
        <div className="mon-kpi-value">{value}</div>
        <div className="mon-kpi-label">{label}</div>
      </div>
    </div>
  );
}

function EnvelopeCard({ board }: { board: CellHealthBoard }) {
  const { t } = useI18n();
  const env = board.envelope;
  const items = [
    { label: t("monitoring.healthLoadKa"), value: env.total_current_ka != null ? formatNumber(env.total_current_ka, 1) : "—" },
    { label: t("monitoring.healthAnolyteTemp"), value: env.anolyte_temp != null ? `${formatNumber(env.anolyte_temp, 1)} °C` : "—" },
    { label: t("monitoring.healthNaoh"), value: env.naoh_pct != null ? `${formatNumber(env.naoh_pct, 2)} %` : "—" },
    { label: t("monitoring.healthDeltaP"), value: env.delta_p != null ? formatNumber(env.delta_p, 2) : "—" },
    { label: "Cl₂", value: env.cl2_pct != null ? `${formatNumber(env.cl2_pct, 2)} %` : "—" },
    { label: "H₂", value: env.h2_pct != null ? `${formatNumber(env.h2_pct, 2)} %` : "—" },
  ];
  return (
    <section className="mon-panel ch-panel">
      <div className="ch-panel-head">
        <h3>{t("monitoring.healthEnvelope")}</h3>
        <span className={`mon-sev-badge ${healthClass(env.envelope_status)}`}>
          {t(`monitoring.healthStatus.${env.envelope_status}`)} · {env.envelope_score ?? "—"}
        </span>
      </div>
      <p className="mon-help">{t("monitoring.healthEnvelopeHelp")}</p>
      <div className="ch-envelope-grid">
        {items.map((item) => (
          <div key={item.label} className="ch-fact">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      {env.brine_flags.length ? (
        <div className="ch-brine-flags">
          <strong>{t("monitoring.healthBrineFlags")}</strong>
          <ul>
            {env.brine_flags.map((flag) => (
              <li key={flag.parameter}>
                {flag.parameter}: {formatNumber(flag.value, 2)} &gt; {formatNumber(flag.limit, 2)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mon-sub">{t("monitoring.healthBrineOk")}</p>
      )}
    </section>
  );
}

function InvestigationList({
  rows,
  onOpen,
}: {
  rows: CellHealthRow[];
  onOpen: (row: CellHealthRow) => void;
}) {
  const { t } = useI18n();
  if (!rows.length) {
    return <div className="mon-empty">{t("monitoring.healthNoInvestigation")}</div>;
  }
  return (
    <div className="ch-invest-list">
      {rows.map((row) => (
        <button
          key={`${row.electrolyzer}-${row.position}`}
          type="button"
          className={`ch-invest-row ${healthClass(row.status)}`}
          onClick={() => onOpen(row)}
        >
          <div className="ch-invest-main">
            <strong>
              {row.electrolyzer}-{row.position_label}
            </strong>
            <CellHealthMini score={row.health_score} status={row.status} />
            <span className={`mon-sev-badge ${healthClass(row.status)}`}>
              {t(`monitoring.healthStatus.${row.status}`)}
            </span>
            <span className="ch-score">{row.health_score ?? "—"}</span>
          </div>
          <div className="ch-invest-meta">
            V={row.avg_voltage != null ? formatNumber(row.avg_voltage, 3) : "—"}
            {row.ce_pct != null ? ` · CE ${formatNumber(row.ce_pct, 1)}%` : ""}
            {row.un_avg != null ? ` · Un ${formatNumber(row.un_avg, 3)}` : ""}
            {row.dol_days != null ? ` · DOL ${row.dol_days}d` : ""}
          </div>
          {row.reasons[0] ? <div className="ch-reason">{row.reasons[0]}</div> : null}
        </button>
      ))}
    </div>
  );
}

function PeerTable({
  rows,
  onOpen,
}: {
  rows: CellHealthRow[];
  onOpen: (row: CellHealthRow) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.position_label, row.element_nr, row.anode_nr, row.cathode_nr, row.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [q, rows]);

  return (
    <section className="mon-panel ch-panel">
      <div className="ch-panel-head">
        <h3>{t("monitoring.healthPeerTable")}</h3>
        <label className="ch-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("common.search")} />
        </label>
      </div>
      <div className="ch-table-wrap">
        <table className="ch-table">
          <thead>
            <tr>
              <th>{t("monitoring.healthPos")}</th>
              <th>V</th>
              <th>Δ peers</th>
              <th>{t("monitoring.healthTrend")}</th>
              <th>{t("monitoring.healthScore")}</th>
              <th>{t("monitoring.healthStatusLabel")}</th>
              <th>DOL</th>
              <th>{t("monitoring.healthCycles")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.position} className={healthClass(row.status)} onClick={() => onOpen(row)}>
                <td>{row.position_label}</td>
                <td>{row.voltage != null ? formatNumber(row.voltage, 3) : "—"}</td>
                <td>
                  {row.peer_delta_v != null
                    ? `${row.peer_delta_v > 0 ? "+" : ""}${formatNumber(row.peer_delta_v, 3)}`
                    : "—"}
                </td>
                <td>{row.trend_mv_day != null ? formatNumber(row.trend_mv_day, 2) : "—"}</td>
                <td>
                  <div className="ch-table-health">
                    <CellHealthMini score={row.health_score} status={row.status} />
                    <span>{row.health_score ?? "—"}</span>
                  </div>
                </td>
                <td>
                  <span className={`mon-sev-badge ${healthClass(row.status)}`}>
                    {t(`monitoring.healthStatus.${row.status}`)}
                  </span>
                </td>
                <td>{row.dol_days ?? "—"}</td>
                <td>{row.install_cycles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CellHealthBoardPanel({ electrolyzers }: { electrolyzers: string[] }) {
  const { t } = useI18n();
  const [el, setEl] = useState(electrolyzers[0] || "A1");
  const [selected, setSelected] = useState<CellHealthRow | null>(null);

  const query = useQuery({
    queryKey: ["monitoring", "cell-health-board", el],
    queryFn: () => monitoringApi.cellHealthBoard({ electrolyzer: el }),
    enabled: !!el,
  });

  return (
    <div className="mon-page ch-page">
      <div className="mon-toolbar">
        <div>
          <h2 className="mon-heading">{t("monitoring.healthTitle")}</h2>
          <p className="mon-sub">{t("monitoring.healthHelp")}</p>
        </div>
        <label className="ch-el-pick">
          <span>{t("monitoring.healthElectrolyzer")}</span>
          <select className="mon-select" value={el} onChange={(e) => setEl(e.target.value)}>
            {electrolyzers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : query.data ? (
        <>
          <div className="mon-kpi-row">
            <HealthKpi label={t("monitoring.healthOk")} value={query.data.summary.ok} tone="ok" />
            <HealthKpi label={t("monitoring.healthWatch")} value={query.data.summary.watch} tone="info" />
            <HealthKpi label={t("monitoring.healthInvestigate")} value={query.data.summary.investigate} tone="warning" />
            <HealthKpi label={t("monitoring.healthCritical")} value={query.data.summary.critical} tone="danger" />
            <HealthKpi
              label={t("monitoring.healthMedianV")}
              value={query.data.median_voltage != null ? formatNumber(query.data.median_voltage, 3) : "—"}
              tone="neutral"
            />
          </div>

          <div className="ch-levels">
            <div className="ch-level">
              <Activity size={14} />
              <div>
                <strong>L1 Online</strong>
                <p>{query.data.levels.l1_online}</p>
              </div>
            </div>
            <div className="ch-level">
              <HeartPulse size={14} />
              <div>
                <strong>L2 Condition</strong>
                <p>{query.data.levels.l2_condition}</p>
              </div>
            </div>
            <div className="ch-level">
              <AlertTriangle size={14} />
              <div>
                <strong>L3 Overhaul</strong>
                <p>{query.data.levels.l3_overhaul}</p>
              </div>
            </div>
          </div>

          <div className="ch-grid">
            <EnvelopeCard board={query.data} />
            <section className="mon-panel ch-panel">
              <div className="ch-panel-head">
                <h3>{t("monitoring.healthInvestigation")}</h3>
                <span className="mon-sub">
                  {t("monitoring.healthShutdowns")}: {query.data.shutdown_stats.shutdowns} ·{" "}
                  {t("monitoring.healthTrips")}: {query.data.shutdown_stats.trips}
                </span>
              </div>
              <p className="mon-help">{t("monitoring.healthInvestigationHelp")}</p>
              <InvestigationList rows={query.data.investigation} onOpen={setSelected} />
            </section>
          </div>

          <PeerTable rows={query.data.cells} onOpen={setSelected} />
        </>
      ) : null}

      {selected ? (
        <VoltageHistoryDialog
          electrolyzer={selected.electrolyzer}
          position={selected.position}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
