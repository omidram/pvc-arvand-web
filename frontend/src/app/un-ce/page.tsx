"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { AccessDataTable, type AccessTableColumn } from "@/components/layout/access-report";
import { UnCeSettingsPanel } from "@/components/domain/un-ce-board";
import { ElectrolyzerCombo, useElectrolyzerNames } from "@/components/ui/electrolyzer-combo";
import { LoadingState } from "@/components/ui/spinner";
import { unCeApi } from "@/lib/un-ce";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { monthStartIso, todayIsoLocal } from "@/lib/date-range";
import { formatDisplayedDate } from "@/lib/utils";

type Shown = { scope: "electrolyzer" | "plant"; calc: "individual" | "all"; el: string; unTable: "1" | "2"; ceBasis: "anodic" | "naoh" };

function avg(vals: number[]): number | undefined {
  if (!vals.length) return undefined;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
}

const COLUMNS: AccessTableColumn[] = [
  { key: "electrolyzer", header: "Electrolyzer" },
  { key: "date", header: "Date" },
  { key: "i", header: "i [kA/m²]", align: "right" },
  { key: "un", header: "Un [V]", align: "right" },
  { key: "ce", header: "CE [%]", align: "right" },
  { key: "spc", header: "Energy [kWh/t NaOH]", align: "right" },
  { key: "iref", header: "iRef", align: "right" },
];

/**
 * Un / CE main menu: Un (standardized voltage) and CE of the same electrolyzer and day, plus the
 * specific energy consumption SPC = Un * 100000 / (1.4923 * CE) of the Access `qrySPC*` queries.
 * All numbers come from the server-side Access-exact engine (`/un-ce/spc`).
 */
export default function UnCePage() {
  const { t } = useI18n();
  useCalendar();
  const [from, setFrom] = useState(monthStartIso);
  const [till, setTill] = useState(todayIsoLocal);
  const [elNr, setElNr] = useState("");
  const [unTable, setUnTable] = useState<"1" | "2">("1");
  const [ceBasis, setCeBasis] = useState<"anodic" | "naoh">("anodic");
  const [shown, setShown] = useState<Shown | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const names = useElectrolyzerNames();
  const elSel = elNr || names[0] || "";

  const query = useQuery({
    queryKey: ["un-ce", "spc", shown, from, till],
    queryFn: () =>
      unCeApi.spc(
        {
          scope: shown!.scope,
          calc: shown!.calc,
          dateFrom: from,
          dateTill: till,
          electrolyzers: shown!.calc === "individual" ? [shown!.el] : undefined,
        },
        shown!.unTable,
        shown!.ceBasis
      ),
    enabled: Boolean(shown),
  });

  const rows = useMemo(() => (query.data?.rows || []) as Record<string, unknown>[], [query.data]);
  const chartRows = useMemo(() => {
    const byDate: Record<string, { un: number[]; ce: number[] }> = {};
    for (const r of rows) {
      const day = String(r.date || "");
      if (!day) continue;
      const bucket = (byDate[day] ||= { un: [], ce: [] });
      if (typeof r.un === "number") bucket.un.push(r.un);
      if (typeof r.ce === "number") bucket.ce.push(r.ce);
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({ date, un: avg(byDate[date].un), ce: avg(byDate[date].ce) }));
  }, [rows]);

  const go = (scope: Shown["scope"], calc: Shown["calc"]) =>
    setShown({ scope, calc, el: elSel, unTable, ceBasis });

  return (
    <AccessHub title={t("mainMenu.unCe")} titleBlue>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <UnCeSettingsPanel />
      {/* Single stacked column - matches the real Access "Un / CE" form: an Electrolyzer picker + Graph
          button, directly above an All Electrolyzers + Graph button. */}
      <div className="access-col flex max-w-[260px] flex-col">
        <div className="access-col-title">{t("mainMenu.unCe")}</div>
        <div className="access-group">
          <div className="mb-1 text-[12px] font-bold">Un</div>
          <select className="access-inset-field mb-2 w-full" value={unTable} onChange={(e) => setUnTable(e.target.value === "2" ? "2" : "1")}>
            <option value="1">{t("menus.electrolyzers")}</option>
            <option value="2">{t("menus.allElementsPerEl")}</option>
          </select>
          <div className="mb-1 text-[12px] font-bold">CE</div>
          <select
            className="access-inset-field w-full"
            value={ceBasis}
            onChange={(e) => setCeBasis(e.target.value === "naoh" ? "naoh" : "anodic")}
          >
            <option value="anodic">{t("menus.anodBalEls")}</option>
            <option value="naoh">{t("menus.naohEl")}</option>
          </select>
        </div>
        <div className="access-group">
          <div className="mb-1 text-[12px] font-bold">{t("menus.electrolyzer")}</div>
          <ElectrolyzerCombo className="mb-3 w-full" variant="access" value={elSel} onChange={setElNr} />
          <AccessBtn onClick={() => go("electrolyzer", "individual")} disabled={!elSel}>
            {t("menus.graph")}
          </AccessBtn>
        </div>
        <div className="access-group">
          <div className="mb-2 text-[12px] font-bold">{t("menus.allElectrolyzers")}</div>
          <AccessBtn onClick={() => go("electrolyzer", "all")}>{t("menus.graph")}</AccessBtn>
        </div>
        <div className="access-group">
          <div className="mb-2 text-[12px] font-bold">{t("menus.totalPlant")}</div>
          <AccessBtn onClick={() => go("plant", "all")}>{t("menus.graph")}</AccessBtn>
        </div>
      </div>

      {shown ? (
        <div className="access-sunken mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="font-bold">
              {shown.scope === "plant"
                ? t("menus.totalPlant")
                : shown.calc === "all"
                  ? t("menus.allElectrolyzers")
                  : `${t("menus.electrolyzer")}: ${shown.el}`}
            </span>
            <span className="flex gap-1">
              <AccessBtn className="!w-auto px-3" onClick={() => setView("chart")}>
                {t("menus.chart")}
              </AccessBtn>
              <AccessBtn className="!w-auto px-3" onClick={() => setView("table")}>
                {t("menus.table")}
              </AccessBtn>
            </span>
          </div>
          {query.isLoading ? (
            <LoadingState />
          ) : query.isError ? (
            <div className="p-3 text-[12px] text-[var(--win-danger)]">
              {(query.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(query.error)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-3 text-[12px]">{t("menus.noUnCe")}</div>
          ) : view === "table" ? (
            <AccessDataTable columns={COLUMNS} rows={rows.slice(0, 1500)} />
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
                <XAxis dataKey="date" stroke="#000" fontSize={11} tickFormatter={(value) => formatDisplayedDate(value)} />
                <YAxis
                  yAxisId="left"
                  stroke="#0a246a"
                  fontSize={11}
                  domain={["auto", "auto"]}
                  label={{ value: t("menus.graphUn"), angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#c41212"
                  fontSize={11}
                  domain={["auto", "auto"]}
                  label={{ value: t("menus.graphCe"), angle: 90, position: "insideRight", style: { fontSize: 11 } }}
                />
                <Tooltip labelFormatter={(value) => formatDisplayedDate(value)} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="un" name={t("menus.graphUn")} stroke="#0a246a" dot={{ r: 2 }} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="ce" name={t("menus.graphCe")} stroke="#c41212" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : null}
    </AccessHub>
  );
}
