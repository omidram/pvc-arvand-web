"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { electrolyzersApi, statisticsApi, voltageCalcApi } from "@/lib/endpoints";
import { AccessFormWindow } from "@/components/layout/access-form";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { DateInput } from "@/components/ui/date-input";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { compareElectrolyzers, formatElectrolyzer } from "@/lib/plant-topology";

const CHART_TOOLTIP = {
  background: "#ffffff",
  border: "1px solid #808080",
  borderRadius: 0,
  fontSize: 12,
  color: "#000",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmt(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "";
  return formatNumber(v, digits);
}

function StatQuad({
  label,
  unit,
  stats,
}: {
  label: string;
  unit: string;
  stats?: { min?: number | null; max?: number | null; avg?: number | null; std?: number | null } | null;
}) {
  return (
    <>
      <th colSpan={4}>
        {label} {unit ? `[${unit}]` : ""}
      </th>
    </>
  );
}

function StatisticsMenu() {
  const { t } = useI18n();
  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const names = useMemo(() => {
    const raw = (elQuery.data || []).map((e) => formatElectrolyzer(e.name || String(e.nr))).filter(Boolean);
    return Array.from(new Set(raw)).sort(compareElectrolyzers);
  }, [elQuery.data]);
  const [elNr, setElNr] = useState("A1");

  useEffect(() => {
    if (names.length && !names.includes(formatElectrolyzer(elNr))) setElNr(names[0]);
  }, [names, elNr]);

  return (
    <AccessHub title={t("statistics.title")}>
      <div className="stats-access-grid">
        <div className="stats-access-panel">
          <h3>{t("menus.singleElementVoltages")}</h3>
          <label className="mb-2 block text-[12px]">
            {t("menus.electrolyzer")}
            <select className="access-inset-field mt-1" value={elNr} onChange={(e) => setElNr(e.target.value)}>
              {(names.length ? names : ["A1"]).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <AccessBtn href={`/statistics?form=voltages&electrolyzer=${encodeURIComponent(elNr)}`}>
              {t("menus.elementVoltages")}
            </AccessBtn>
            <AccessBtn href={`/statistics?form=high&electrolyzer=${encodeURIComponent(elNr)}`}>
              {t("menus.highVoltages")}
            </AccessBtn>
            <AccessBtn href={`/statistics?form=distribution&electrolyzer=${encodeURIComponent(elNr)}`}>
              {t("menus.distributionUn")}
            </AccessBtn>
          </div>
        </div>
        <div className="stats-access-panel">
          <h3>{t("mainMenu.powerConsumption")}</h3>
          <div className="mt-8 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=power">{t("menus.electrolyzers")}</AccessBtn>
          </div>
        </div>
        <div className="stats-access-panel">
          <h3>{t("menus.membranes")}</h3>
          <div className="mt-8 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=dol">{t("menus.dol")}</AccessBtn>
          </div>
        </div>
        <div className="stats-access-panel">
          <h3>{t("menus.groups")}</h3>
          <div className="mt-4 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=groups&mode=avg-date">{t("menus.groupAvgByDate")}</AccessBtn>
            <AccessBtn href="/statistics?form=groups&mode=by-date">{t("menus.groupByDate")}</AccessBtn>
            <AccessBtn href="/statistics?form=groups&mode=avg-el-date">{t("menus.groupAvgByElDate")}</AccessBtn>
          </div>
        </div>
      </div>
    </AccessHub>
  );
}

function MembraneDolForm() {
  const { t } = useI18n();
  const dolQuery = useQuery({ queryKey: ["statistics", "dol-by-membrane-type"], queryFn: statisticsApi.dolByMembraneType });
  const rows = dolQuery.data || [];

  return (
    <AccessHub
      title={t("menus.membraneStatistics")}
      titleBlue
      backHref="/statistics"
      backLabel={t("statistics.title")}
      extraButtons={<AccessBtn href="/statistics">{t("statistics.title")}</AccessBtn>}
    >
      {dolQuery.isLoading ? <LoadingState /> : null}
      {dolQuery.isError ? <ErrorState message={(dolQuery.error as Error).message} /> : null}
      <div className="overflow-auto">
        <table className="stats-hier-table min-w-[1200px]">
          <thead>
            <tr>
              <th rowSpan={3}>{t("fields.membraneType")}</th>
              <th rowSpan={3}>{t("statistics.totalNumber")}</th>
              <th rowSpan={3}>{t("statistics.withoutDol")}</th>
              <th colSpan={5}>{t("statistics.activeElements")}</th>
              <th colSpan={5}>{t("statistics.passiveElements")}</th>
              <th colSpan={5}>{t("statistics.activeAndPassive")}</th>
            </tr>
            <tr>
              {[0, 1, 2].map((i) => (
                <FragmentGroup key={i} />
              ))}
            </tr>
            <tr>
              {[0, 1, 2].flatMap((g) => [
                <th key={`${g}-min`}>{t("statistics.min")}</th>,
                <th key={`${g}-max`}>{t("statistics.max")}</th>,
                <th key={`${g}-avg`}>{t("statistics.avg")}</th>,
                <th key={`${g}-std`}>{t("statistics.stdDev")}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.membrane_type}>
                <td className="is-left">{row.membrane_type}</td>
                <td>{row.total ?? (row.active_count || 0) + (row.passive_count || 0)}</td>
                <td>{row.without_dol ?? ""}</td>
                <DolCells bucket={typeof row.active === "object" ? row.active : undefined} />
                <DolCells bucket={typeof row.passive === "object" ? row.passive : undefined} />
                <DolCells bucket={row.combined} />
              </tr>
            ))}
            {!rows.length && !dolQuery.isLoading ? (
              <tr>
                <td colSpan={18}>{t("statistics.noData")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </AccessHub>
  );
}

function FragmentGroup() {
  const { t } = useI18n();
  return (
    <>
      <th rowSpan={2}>{t("menus.number")}</th>
      <th colSpan={4}>{t("menus.dol")}</th>
    </>
  );
}

function DolCells({
  bucket,
}: {
  bucket?: {
    number?: number;
    dol?: { min?: number | null; max?: number | null; avg?: number | null; std?: number | null };
  };
}) {
  return (
    <>
      <td>{bucket?.number ?? ""}</td>
      <td>{fmt(bucket?.dol?.min, 0)}</td>
      <td>{fmt(bucket?.dol?.max, 0)}</td>
      <td>{fmt(bucket?.dol?.avg, 1)}</td>
      <td>{fmt(bucket?.dol?.std, 1)}</td>
    </>
  );
}

function AveragePowerForm() {
  const { t } = useI18n();
  const [from, setFrom] = useState("2016-06-01");
  const [till, setTill] = useState(todayIso());
  const [applied, setApplied] = useState({ from: "2016-06-01", till: todayIso() });

  const powerQuery = useQuery({
    queryKey: ["statistics", "average-power", applied.from, applied.till],
    queryFn: () => statisticsApi.averagePower({ date_from: applied.from, date_till: applied.till }),
  });

  const rows = powerQuery.data?.rows || [];
  const plant = powerQuery.data?.plant_total;

  return (
    <AccessHub
      title={t("statistics.averagePowerTitle")}
      titleBlue
      backHref="/statistics"
      backLabel={t("statistics.title")}
      extraButtons={<AccessBtn href="/statistics">{t("statistics.title")}</AccessBtn>}
    >
      <div className="mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <span className="font-bold">{t("statistics.averagePowerFrom")}</span>
        <DateInput className="access-inset-field" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>{t("menus.till")}</span>
        <DateInput className="access-inset-field" value={till} onChange={(e) => setTill(e.target.value)} />
        <AccessBtn onClick={() => setApplied({ from, till })}>{t("menus.updateDisplay")}</AccessBtn>
        <AccessBtn href="/statistics">{t("statistics.title")}</AccessBtn>
        <span className="ms-auto border border-[#808080] bg-white px-2 py-1">{todayIso()}</span>
      </div>
      <p className="mb-2 text-[11px] text-[#404040]">{powerQuery.data?.basis}</p>
      {powerQuery.isLoading ? <LoadingState /> : null}
      {powerQuery.isError ? <ErrorState message={(powerQuery.error as Error).message} /> : null}
      <div className="overflow-auto">
        <table className="stats-hier-table min-w-[1100px]">
          <thead>
            <tr>
              <th rowSpan={2}>{t("menus.electrolyzer")}</th>
              <th rowSpan={2}>{t("statistics.records")}</th>
              <StatQuad label="i" unit="kA/m²" />
              <StatQuad label="Un" unit="V" />
              <StatQuad label="CE" unit="%" />
              <StatQuad label="SPC" unit="kWh/t NaOH" />
            </tr>
            <tr>
              {["i", "un", "ce", "spc"].flatMap((metric) => [
                <th key={`${metric}-min`}>{t("statistics.min")}</th>,
                <th key={`${metric}-max`}>{t("statistics.max")}</th>,
                <th key={`${metric}-avg`}>{t("statistics.avg")}</th>,
                <th key={`${metric}-std`}>{t("statistics.stdDev")}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.electrolyzer}>
                <td className="is-left">{row.electrolyzer}</td>
                <td>{row.records}</td>
                <MetricCells stats={row.i} />
                <MetricCells stats={row.un} />
                <MetricCells stats={row.ce} />
                <MetricCells stats={row.spc} digits={1} />
              </tr>
            ))}
            {!rows.length && !powerQuery.isLoading ? (
              <tr>
                <td colSpan={18}>{t("statistics.noData")}</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td className="is-left" colSpan={2}>
                {t("menus.totalPlant")}
              </td>
              <td colSpan={2} />
              <td>{fmt(plant?.i?.avg)}</td>
              <td>{fmt(plant?.i?.std)}</td>
              <td colSpan={2} />
              <td>{fmt(plant?.un?.avg)}</td>
              <td>{fmt(plant?.un?.std)}</td>
              <td colSpan={2} />
              <td>{fmt(plant?.ce?.avg)}</td>
              <td>{fmt(plant?.ce?.std)}</td>
              <td colSpan={2} />
              <td>{fmt(plant?.spc?.avg, 1)}</td>
              <td>{fmt(plant?.spc?.std, 1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AccessHub>
  );
}

function MetricCells({
  stats,
  digits = 3,
}: {
  stats?: { min?: number | null; max?: number | null; avg?: number | null; std?: number | null };
  digits?: number;
}) {
  return (
    <>
      <td>{fmt(stats?.min, digits)}</td>
      <td>{fmt(stats?.max, digits)}</td>
      <td>{fmt(stats?.avg, digits)}</td>
      <td>{fmt(stats?.std, digits)}</td>
    </>
  );
}

function GroupsForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") || "avg-date";
  const title =
    mode === "by-date"
      ? t("menus.groupByDate")
      : mode === "avg-el-date"
        ? t("menus.groupAvgByElDate")
        : t("menus.groupAvgByDate");
  const groupsQuery = useQuery({ queryKey: ["statistics", "groups"], queryFn: statisticsApi.groups });
  return (
    <AccessHub title={title} titleBlue backHref="/statistics" backLabel={t("statistics.title")}>
      <p className="mb-2 text-[11px] text-[#404040]">{t("statistics.groupStatsTitle")}</p>
      {groupsQuery.isLoading ? <LoadingState /> : null}
      {groupsQuery.isError ? <ErrorState message={(groupsQuery.error as Error).message} /> : null}
      <div className="overflow-auto">
        <table className="stats-hier-table">
          <thead>
            <tr>
              <th>{t("fields.groupNr")}</th>
              <th>{t("fields.elementCount")}</th>
              <th>{t("fields.anodeCoating")}</th>
              <th>{t("fields.cathodeCoating")}</th>
              <th>{t("fields.membraneType")}</th>
              <th>{t("fields.gapMm")}</th>
            </tr>
          </thead>
          <tbody>
            {(groupsQuery.data || []).map((row) => (
              <tr key={row.group_nr}>
                <td>{row.group_nr}</td>
                <td>{row.element_count}</td>
                <td>{row.anode_coating || ""}</td>
                <td>{row.cathode_coating || ""}</td>
                <td>{row.membrane_type || ""}</td>
                <td>{row.gap_mm || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccessHub>
  );
}

function ElectrolyzerPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const names = useMemo(() => {
    const raw = (elQuery.data || []).map((e) => formatElectrolyzer(e.name || String(e.nr))).filter(Boolean) as string[];
    return Array.from(new Set(raw)).sort(compareElectrolyzers);
  }, [elQuery.data]);
  const display = formatElectrolyzer(value) || value;
  useEffect(() => {
    if (!display && names[0]) onChange(names[0]);
    else if (display && names.length && !names.includes(display) && names[0]) onChange(names[0]);
    else if (value && display !== value) onChange(display);
  }, [names, value, display, onChange]);
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span>{t("menus.electrolyzer")}</span>
      <select className="access-inset-field w-[120px]" value={display} onChange={(e) => onChange(formatElectrolyzer(e.target.value) || e.target.value)}>
        {(names.length ? names : display ? [display] : ["A1"]).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

function UnDistributionForm() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialEl = formatElectrolyzer(searchParams.get("electrolyzer")) || "A1";
  const [electrolyzer, setElectrolyzer] = useState(initialEl);
  const [date, setDate] = useState("");
  const [uiMin, setUiMin] = useState("3.000");
  const [uiMax, setUiMax] = useState("3.400");
  const [step, setStep] = useState("0.010");
  const [showChart, setShowChart] = useState(false);
  const [applied, setApplied] = useState({
    electrolyzer: initialEl,
    date: "",
    uiMin: 3,
    uiMax: 3.4,
    step: 0.01,
  });

  const distQuery = useQuery({
    queryKey: ["voltage", "distribution-access", applied],
    queryFn: () =>
      voltageCalcApi.distribution({
        electrolyzer: applied.electrolyzer || undefined,
        date_from: applied.date || undefined,
        date_till: applied.date || undefined,
        ui_min: applied.uiMin,
        ui_max: applied.uiMax,
        step: applied.step,
      }),
    enabled: !!applied.electrolyzer,
  });

  const chartData = useMemo(
    () => (distQuery.data?.buckets || []).map((b) => ({ label: b.label || "", count: b.count })),
    [distQuery.data]
  );
  const rows = distQuery.data?.rows || [];

  function updateDisplay() {
    setApplied({
      electrolyzer,
      date,
      uiMin: Number(uiMin) || 3,
      uiMax: Number(uiMax) || 3.4,
      step: Number(step) || 0.01,
    });
  }

  return (
    <AccessHub title={t("menus.distributionUn")} titleBlue backHref="/statistics" backLabel={t("statistics.title")}>
      <div className="mb-3 flex flex-wrap items-end gap-3 border border-[#808080] bg-[#d4d0c8] p-2 text-[12px]">
        <label className="flex flex-col gap-1">
          <span>Date</span>
          <DateInput className="access-inset-field w-[130px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <ElectrolyzerPicker value={electrolyzer} onChange={setElectrolyzer} />
        <label className="flex flex-col gap-1">
          <span>Ui min [V]</span>
          <input className="access-inset-field w-[90px]" value={uiMin} onChange={(e) => setUiMin(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Ui max [V]</span>
          <input className="access-inset-field w-[90px]" value={uiMax} onChange={(e) => setUiMax(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Step [V]</span>
          <input className="access-inset-field w-[90px]" value={step} onChange={(e) => setStep(e.target.value)} />
        </label>
        <AccessBtn onClick={updateDisplay}>{t("menus.updateDisplay")}</AccessBtn>
        <AccessBtn onClick={() => setShowChart((v) => !v)}>{showChart ? "Table" : "Chart"}</AccessBtn>
        <AccessBtn href="/statistics">{t("statistics.title")}</AccessBtn>
      </div>

      {distQuery.isLoading ? <LoadingState /> : null}
      {distQuery.isError ? <ErrorState message={(distQuery.error as Error).message} /> : null}

      {!distQuery.isLoading && !distQuery.isError ? (
        distQuery.data && distQuery.data.total_readings > 0 ? (
          <div className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
              <div className="overflow-auto border border-[#808080] bg-white">
                <table className="stats-hier-table w-full">
                  <thead>
                    <tr>
                      <th>Class [V]</th>
                      <th>Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(distQuery.data.buckets || []).map((b) => (
                      <tr key={b.label || ""}>
                        <td className="is-left">{b.label}</td>
                        <td>{b.count}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="is-left font-bold">Sum</td>
                      <td className="font-bold">{distQuery.data.class_sum ?? distQuery.data.total_readings}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {showChart ? (
                <div className="access-sunken bg-white p-2" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                      <XAxis dataKey="label" stroke="#3f3f3f" fontSize={9} interval={0} angle={-45} textAnchor="end" height={60} />
                      <YAxis stroke="#3f3f3f" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                      <Bar dataKey="count" name={t("statistics.count")} fill="#0a246a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-[12px] text-[#404040]">
                  {t("statistics.reportDate")}:{" "}
                  {distQuery.data.date
                    ? formatDate(distQuery.data.date)
                    : distQuery.data.date_from
                      ? formatDate(distQuery.data.date_from)
                      : "—"}
                  <div className="mt-1 font-bold">
                    {t("statistics.totalReadings")}: {distQuery.data.total_readings}
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-auto border border-[#808080] bg-white" style={{ maxHeight: "52vh" }}>
              <table className="stats-hier-table min-w-[1100px]">
                <thead>
                  <tr>
                    <th>Electrolyzer</th>
                    <th>Pos</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>I total [kA]</th>
                    <th>i [kA/m²]</th>
                    <th>Co [%]</th>
                    <th>T An [°C]</th>
                    <th>T Ca [°C]</th>
                    <th>Tm [°C]</th>
                    <th>Ui [V]</th>
                    <th>Un [V]</th>
                    <th>Class [V]</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.position}-${row.date}-${idx}`}>
                      <td>{row.electrolyzer}</td>
                      <td>{row.position}</td>
                      <td>{row.date ? formatDate(row.date) : ""}</td>
                      <td>{row.time || ""}</td>
                      <td>{fmt(row.i_total, 2)}</td>
                      <td>{fmt(row.i_density, 3)}</td>
                      <td>{fmt(row.co_pct, 2)}</td>
                      <td>{fmt(row.t_an, 1)}</td>
                      <td>{fmt(row.t_ca, 1)}</td>
                      <td>{fmt(row.tm, 1)}</td>
                      <td>{fmt(row.ui, 3)}</td>
                      <td>{fmt(row.un, 3)}</td>
                      <td className="is-left">{row.class_label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-[12px]">{t("statistics.noVoltageReadings")}</p>
        )
      ) : null}
    </AccessHub>
  );
}

function VoltageForms({ form }: { form: string }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialEl = formatElectrolyzer(searchParams.get("electrolyzer")) || "A1";
  const [electrolyzer, setElectrolyzer] = useState(initialEl);
  const [from, setFrom] = useState("");
  const [till, setTill] = useState("");
  const [minV, setMinV] = useState("");
  const [maxV, setMaxV] = useState("");
  const [applied, setApplied] = useState<{ from: string; till: string; minV: string; maxV: string }>({
    from: "",
    till: "",
    minV: "",
    maxV: "",
  });

  const title = form === "high" ? t("menus.highVoltages") : t("menus.elementVoltages");

  const dateParams = useMemo(() => {
    const params: { date_from?: string; date_till?: string } = {};
    if (applied.from) params.date_from = applied.from;
    if (applied.till) params.date_till = applied.till;
    return params;
  }, [applied.from, applied.till]);

  const highQuery = useQuery({
    queryKey: ["voltage", "high", electrolyzer, dateParams],
    queryFn: () => voltageCalcApi.highDeviation({ electrolyzer: electrolyzer || undefined, ...dateParams }),
    enabled: form === "high" && !!electrolyzer,
  });
  const elementsQuery = useQuery({
    queryKey: ["voltage", "element-voltages", electrolyzer, dateParams],
    queryFn: () => voltageCalcApi.elementVoltages({ electrolyzer, ...dateParams }),
    enabled: form === "voltages" && !!electrolyzer,
  });

  const loading = form === "high" ? highQuery.isLoading : elementsQuery.isLoading;
  const error = form === "high" ? highQuery.error : elementsQuery.error;

  const activeMeta = form === "high" ? highQuery.data : elementsQuery.data;
  const rangeLabel = (() => {
    const a = activeMeta?.date_from || activeMeta?.date;
    const b = activeMeta?.date_till || activeMeta?.date;
    if (!a && !b) return null;
    if (a && b && a !== b) return `${formatDate(a)} – ${formatDate(b)}`;
    return formatDate(a || b || "");
  })();
  const multiDay = !!(
    activeMeta?.date_from &&
    activeMeta?.date_till &&
    activeMeta.date_from !== activeMeta.date_till
  );

  const filterMin = applied.minV.trim() === "" ? null : Number(applied.minV.replace(",", "."));
  const filterMax = applied.maxV.trim() === "" ? null : Number(applied.maxV.replace(",", "."));
  const elementRows = useMemo(() => {
    const rows = elementsQuery.data?.rows || [];
    return rows.filter((row) => {
      const v = row.value;
      if (v == null) return false;
      if (filterMin != null && Number.isFinite(filterMin) && v < filterMin) return false;
      if (filterMax != null && Number.isFinite(filterMax) && v > filterMax) return false;
      return true;
    });
  }, [elementsQuery.data, filterMin, filterMax]);
  const filteredStats = useMemo(() => {
    const values = elementRows.map((r) => r.value).filter((v): v is number => v != null && Number.isFinite(v));
    if (!values.length) return { count: 0, average: null as number | null, min: null as number | null, max: null as number | null };
    const sum = values.reduce((a, b) => a + b, 0);
    return {
      count: values.length,
      average: sum / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [elementRows]);

  return (
    <AccessHub title={title} titleBlue backHref="/statistics" backLabel={t("statistics.title")}>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <ElectrolyzerPicker value={electrolyzer} onChange={setElectrolyzer} />
        <label className="flex flex-col gap-1">
          <span>{t("statistics.dateFrom")}</span>
          <DateInput className="access-inset-field w-[130px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("statistics.dateTill")}</span>
          <DateInput className="access-inset-field w-[130px]" value={till} onChange={(e) => setTill(e.target.value)} />
        </label>
        {form === "voltages" ? (
          <>
            <label className="flex flex-col gap-1">
              <span>{t("statistics.min")} [V]</span>
              <input
                className="access-inset-field w-[90px]"
                value={minV}
                onChange={(e) => setMinV(e.target.value)}
                placeholder="e.g. 2.90"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t("statistics.max")} [V]</span>
              <input
                className="access-inset-field w-[90px]"
                value={maxV}
                onChange={(e) => setMaxV(e.target.value)}
                placeholder="e.g. 3.40"
              />
            </label>
          </>
        ) : null}
        <AccessBtn onClick={() => setApplied({ from, till, minV, maxV })}>{t("statistics.applyDates")}</AccessBtn>
        <AccessBtn
          onClick={() => {
            setFrom("");
            setTill("");
            setMinV("");
            setMaxV("");
            setApplied({ from: "", till: "", minV: "", maxV: "" });
          }}
        >
          {t("statistics.useLatestDay")}
        </AccessBtn>
        <AccessBtn
          onClick={() => {
            const start = from || till || todayIso();
            setFrom(start);
            setTill(todayIso());
            setApplied({ from: start, till: todayIso(), minV, maxV });
          }}
        >
          {t("statistics.untilToday")}
        </AccessBtn>
        {rangeLabel ? (
          <div className="font-bold">
            {t("statistics.reportDate")}: {rangeLabel}
          </div>
        ) : null}
      </div>
      <p className="mb-3 text-[11px] text-[#404040]">{t("statistics.dateRangeHint")}</p>

      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={(error as Error).message} /> : null}

      {form === "high" && !loading && !error ? (
        highQuery.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-[12px] font-bold">
              <span>
                {t("statistics.avgVoltage")}: {highQuery.data.average != null ? fmt(highQuery.data.average, 3) : "—"} V
              </span>
              <span>
                {t("statistics.threshold")}: ±{fmt(highQuery.data.threshold_pct ?? 5, 0)}%
              </span>
              <span>
                {t("statistics.count")}: {highQuery.data.flagged.length}
              </span>
            </div>
            {highQuery.data.flagged.length ? (
              <div className="overflow-auto">
                <table className="stats-hier-table">
                  <thead>
                    <tr>
                      {multiDay ? <th>{t("statistics.reportDate")}</th> : null}
                      <th>{t("menus.electrolyzer")}</th>
                      <th>{t("statistics.position")}</th>
                      <th>{t("fields.elementNr")}</th>
                      <th>{t("statistics.voltageV")}</th>
                      <th>{t("statistics.deviationPct")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highQuery.data.flagged.map((row, idx) => (
                      <tr key={`${row.date}-${row.position}-${row.element_nr}-${idx}`}>
                        {multiDay ? <td>{row.date ? formatDate(row.date) : ""}</td> : null}
                        <td>{formatElectrolyzer(row.electrolyzer) || row.electrolyzer}</td>
                        <td>{row.position}</td>
                        <td>{row.element_nr || ""}</td>
                        <td>{fmt(row.value ?? row.standardized_voltage, 3)}</td>
                        <td>{fmt(row.deviation_pct, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12px]">{t("statistics.noHighVoltages")}</p>
            )}
          </div>
        ) : null
      ) : null}

      {form === "voltages" && !loading && !error ? (
        elementsQuery.data && elementsQuery.data.count > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-[12px] font-bold">
              <span>
                {t("statistics.count")}: {filteredStats.count}
                {filteredStats.count !== elementsQuery.data.count ? ` / ${elementsQuery.data.count}` : ""}
              </span>
              <span>
                {t("statistics.avg")}: {fmt(filteredStats.average, 3)} V
              </span>
              <span>
                {t("statistics.min")}: {fmt(filteredStats.min, 3)} V
              </span>
              <span>
                {t("statistics.max")}: {fmt(filteredStats.max, 3)} V
              </span>
              {filterMin != null || filterMax != null ? (
                <span className="font-normal text-[#404040]">
                  {t("statistics.filterRange")}: {filterMin != null ? fmt(filterMin, 3) : "—"} …{" "}
                  {filterMax != null ? fmt(filterMax, 3) : "—"} V
                </span>
              ) : null}
            </div>
            <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
              <table className="stats-hier-table">
                <thead>
                  <tr>
                    {multiDay ? <th>{t("statistics.reportDate")}</th> : null}
                    <th>{t("statistics.position")}</th>
                    <th>{t("fields.elementNr")}</th>
                    <th>{t("statistics.voltageV")}</th>
                  </tr>
                </thead>
                <tbody>
                  {elementRows.map((row, idx) => (
                    <tr key={`${row.date}-${row.position}-${idx}`}>
                      {multiDay ? <td>{row.date ? formatDate(row.date) : ""}</td> : null}
                      <td>{row.position}</td>
                      <td>{row.element_nr || ""}</td>
                      <td>{fmt(row.value, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-[12px]">{t("statistics.noVoltageReadings")}</p>
        )
      ) : null}
    </AccessHub>
  );
}

function StatisticsDetails() {
  const searchParams = useSearchParams();
  const form = searchParams.get("form");
  if (form === "dol") return <MembraneDolForm />;
  if (form === "power") return <AveragePowerForm />;
  if (form === "groups") return <GroupsForm />;
  if (form === "distribution") return <UnDistributionForm />;
  if (form === "high" || form === "voltages") return <VoltageForms form={form} />;
  return (
    <AccessFormWindow caption="Statistics" backHref="/statistics">
      <StatisticsMenu />
    </AccessFormWindow>
  );
}

function StatisticsInner() {
  const searchParams = useSearchParams();
  if (!searchParams.get("form")) return <StatisticsMenu />;
  return <StatisticsDetails />;
}

export default function StatisticsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <StatisticsInner />
    </Suspense>
  );
}
