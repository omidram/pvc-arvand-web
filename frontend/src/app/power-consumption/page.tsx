"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { statisticsApi } from "@/lib/endpoints";
import { ElectrolyzerCombo, useElectrolyzerNames } from "@/components/ui/electrolyzer-combo";
import { AccessSeveralBox } from "@/components/ui/access-several-box";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Access default window on the classic Energieverbrauch form. */
function accessDefaultFrom() {
  return "2016-06-01";
}

type Scope = "plant" | "train" | "electrolyzer" | "group" | "element";

export default function PowerConsumptionPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(accessDefaultFrom);
  const [till, setTill] = useState(todayIso);
  const [shown, setShown] = useState<{
    scope: Scope;
    title: string;
    mode: "chart" | "table";
    calc: string;
    tableUn: string;
    basis: string;
    ref: string;
  } | null>(null);

  const plant = useColumnState({ result: "chart" });
  const train = useColumnState({ result: "chart" });
  const el = useColumnState({
    tableUn: "electrolyzers",
    basis: "anod",
    calc: "individual",
    result: "chart",
  });
  const group = useColumnState({
    tableUn: "allElements",
    basis: "anod",
    calc: "individual",
    result: "chart",
  });
  const element = useColumnState({
    tableUn: "allElements",
    basis: "anod",
    calc: "individual",
    result: "chart",
  });

  const [elNr, setElNr] = useState("1B");
  const [groupNr, setGroupNr] = useState("1");
  const [elementNr, setElementNr] = useState("");
  const [severalEl, setSeveralEl] = useState<string[]>([]);
  const [severalGroups, setSeveralGroups] = useState<string[]>([]);
  const [severalElements, setSeveralElements] = useState<string[]>([]);
  const elNames = useElectrolyzerNames();

  const apiGroup =
    shown?.scope === "train"
      ? "train"
      : shown?.scope === "plant"
        ? "plant"
        : shown?.scope === "group"
          ? "rack"
          : "electrolyzer";

  const powerQuery = useQuery({
    queryKey: ["statistics", "power-consumption", apiGroup, from, till, shown?.ref, shown?.calc],
    queryFn: () =>
      statisticsApi.powerConsumption({
        group: apiGroup,
        date_from: from,
        date_till: till,
        electrolyzer: shown?.scope === "electrolyzer" && shown.calc === "individual" ? shown.ref : undefined,
      }),
    enabled: !!shown,
  });

  const rows = useMemo(() => {
    const items = powerQuery.data?.rows || [];
    return items.map((row) => ({
      label: row.key,
      value: Number(row.energy_kwh) || 0,
      current: row.current_ka,
      power: row.avg_kw,
      hours: row.hours,
    }));
  }, [powerQuery.data]);

  function display(
    scope: Scope,
    title: string,
    col: { values: Record<string, string> },
    ref = ""
  ) {
    setShown({
      scope,
      title,
      mode: col.values.result === "table" ? "table" : "chart",
      calc: col.values.calc || "all",
      tableUn: col.values.tableUn || "",
      basis: col.values.basis || "",
      ref,
    });
  }

  return (
    <AccessHub title={t("mainMenu.powerConsumption")}>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />

      <div className="pc-access-grid">
        {/* Total Plant — Access leaves middle empty */}
        <ReportColumn
          title={t("menus.totalPlant")}
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => display("plant", t("menus.totalPlant"), plant)}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [
                { value: "chart", label: t("menus.chart") },
                { value: "table", label: t("menus.table") },
              ],
            },
          ]}
        />

        {/* Train — Access leaves middle empty */}
        <ReportColumn
          title={t("menus.train")}
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => display("train", t("menus.train"), train)}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [
                { value: "chart", label: t("menus.chart") },
                { value: "table", label: t("menus.table") },
              ],
            },
          ]}
        />

        {/* Electrolyzers */}
        <ReportColumn
          title={t("menus.electrolyzers")}
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => display("electrolyzer", t("menus.electrolyzers"), el, elNr)}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "electrolyzers", label: t("menus.electrolyzers") },
                { value: "allElements", label: t("menus.allElementsPerEl") },
              ],
            },
            {
              legend: t("menus.basisCe"),
              name: "basis",
              options: [
                { value: "anod", label: t("menus.anodBalEl") },
                { value: "naoh", label: t("menus.naohEl") },
              ],
            },
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualEl") },
                { value: "several", label: t("menus.severalElectrolyzers") },
                { value: "all", label: t("menus.allElectrolyzers") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <ElectrolyzerCombo variant="access" className="mt-1 w-full max-w-[120px]" value={elNr} onChange={setElNr} />
                ) : v === "several" ? (
                  <AccessSeveralBox
                    mode="electrolyzer"
                    values={severalEl}
                    onChange={setSeveralEl}
                    options={elNames}
                    placeholder="A1, B2, …"
                    aria-label={t("menus.severalElectrolyzers")}
                  />
                ) : null,
            },
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [
                { value: "chart", label: t("menus.chart") },
                { value: "table", label: t("menus.table") },
              ],
            },
          ]}
        />

        {/* Groups */}
        <ReportColumn
          title={t("menus.groups")}
          values={group.values}
          onChange={group.onChange}
          onDisplay={() => display("group", t("menus.groups"), group, groupNr)}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "allElements", label: t("menus.allElementsPerEl") },
                { value: "groups", label: t("menus.groups") },
              ],
            },
            {
              legend: t("menus.basisCe"),
              name: "basis",
              options: [
                { value: "anod", label: t("menus.anodBalGroup") },
                { value: "naoh", label: t("menus.naohGroup") },
              ],
            },
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualGroup") },
                { value: "several", label: t("menus.severalGroups") },
                { value: "all", label: t("menus.allGroups") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <input
                    className="access-inset-field mt-1 w-16"
                    value={groupNr}
                    onChange={(e) => setGroupNr(e.target.value)}
                  />
                ) : v === "several" ? (
                  <AccessSeveralBox
                    mode="free"
                    values={severalGroups}
                    onChange={setSeveralGroups}
                    options={["1", "2", "3", "4", "5"]}
                    placeholder="1, 2, …"
                    aria-label={t("menus.severalGroups")}
                  />
                ) : null,
            },
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [
                { value: "chart", label: t("menus.chart") },
                { value: "table", label: t("menus.table") },
              ],
            },
          ]}
        />

        {/* Elements */}
        <ReportColumn
          title={t("menus.elements")}
          values={element.values}
          onChange={element.onChange}
          onDisplay={() => display("element", t("menus.elements"), element, elementNr)}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "allElements", label: t("menus.allElementsPerEl") },
                { value: "individual", label: t("menus.individualElement") },
              ],
            },
            {
              legend: t("menus.basisCe"),
              name: "basis",
              options: [
                { value: "anod", label: t("menus.anodBalElement") },
                { value: "naoh", label: t("menus.naohElement") },
              ],
            },
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualElement") },
                { value: "several", label: t("menus.severalElements") },
                { value: "all", label: t("menus.allElements") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <input
                    className="access-inset-field mt-1 w-full max-w-[120px]"
                    value={elementNr}
                    onChange={(e) => setElementNr(e.target.value)}
                  />
                ) : v === "several" ? (
                  <AccessSeveralBox
                    mode="pair"
                    values={severalElements}
                    onChange={setSeveralElements}
                    options={elNames}
                    placeholder="A1|12"
                    aria-label={t("menus.severalElements")}
                  />
                ) : null,
            },
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [
                { value: "chart", label: t("menus.chart") },
                { value: "table", label: t("menus.table") },
              ],
            },
          ]}
        />
      </div>

      {shown ? (
        <>
          <p className="mt-3 text-[11px] text-[#404040]">
            {powerQuery.data?.formula || "kWh = V_total × I_kA × hours"}
            {shown.basis ? ` · ${t("menus.basisCe")}: ${shown.basis === "anod" ? "Anodic Balance" : "NaOH Production"}` : ""}
            {shown.tableUn ? ` · ${t("menus.tableUn")}: ${shown.tableUn}` : ""}
            {shown.calc === "individual" && shown.ref ? ` · ${shown.ref}` : ""}
            {powerQuery.data?.total_kwh != null
              ? ` · ${t("monitoring.energyKwh")} ${formatNumber(powerQuery.data.total_kwh, 0)}`
              : ""}
          </p>
          {powerQuery.isFetching ? <p className="mt-1 text-[11px]">{t("common.loading")}</p> : null}
          <ResultsPane
            mode={shown.mode}
            title={`${t("mainMenu.powerConsumption")} · ${shown.title}`}
            rows={rows}
            xKey="label"
            yKey="value"
            yLabel="kWh"
          />
        </>
      ) : null}
    </AccessHub>
  );
}
