"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { electrolyzersApi, reportsApi, statisticsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";

export default function PowerConsumptionPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState("2006-06-01");
  const [till, setTill] = useState("2016-10-04");
  const [shown, setShown] = useState<{ title: string; mode: "chart" | "table" } | null>(null);
  const plant = useColumnState({ result: "chart" });
  const train = useColumnState({ result: "chart" });
  const el = useColumnState({ tableUn: "all-elements", basis: "naoh", calc: "individual", result: "chart" });
  const group = useColumnState({ tableUn: "groups", basis: "anod", calc: "individual", result: "chart" });
  const element = useColumnState({ tableUn: "all-elements", basis: "anod", calc: "individual", result: "chart" });
  const [elNr, setElNr] = useState("2C");
  const [groupNr, setGroupNr] = useState("1");

  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const powerQuery = useQuery({
    queryKey: ["statistics", "power-consumption", shown?.title],
    queryFn: () => statisticsApi.powerConsumption(shown?.title === "Electrolyzers" ? elNr : undefined),
    enabled: Boolean(shown),
  });
  const trendsQuery = useQuery({
    queryKey: ["reports", "trends"],
    queryFn: () => reportsApi.trends(),
    enabled: Boolean(shown),
  });

  const elNames = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);
  const rows = useMemo(() => {
    const trend = (trendsQuery.data as { dates?: string[]; spc?: number[] } | undefined) || {};
    if (Array.isArray(trend.dates) && Array.isArray(trend.spc)) {
      return trend.dates.map((d, i) => ({ label: d, value: trend.spc?.[i] }));
    }
    const raw = powerQuery.data || {};
    return Object.entries(raw).map(([k, v]) => ({ label: k, value: typeof v === "number" ? v : Number(v) || 0 }));
  }, [powerQuery.data, trendsQuery.data]);

  return (
    <AccessHub title={t("mainMenu.powerConsumption")}>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <div className="grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
        <ReportColumn
          title={t("menus.totalPlant")}
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => setShown({ title: "Total Plant", mode: plant.values.result === "table" ? "table" : "chart" })}
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
        <ReportColumn
          title={t("menus.train")}
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => setShown({ title: "Train", mode: train.values.result === "table" ? "table" : "chart" })}
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
        <ReportColumn
          title={t("menus.electrolyzers")}
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => setShown({ title: "Electrolyzers", mode: el.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "electrolyzers", label: t("menus.electrolyzers") },
                { value: "all-elements", label: t("menus.allElementsPerEl") },
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
                  <select className="access-inset-field mt-1 w-full" value={elNr} onChange={(e) => setElNr(e.target.value)}>
                    {(elNames.length ? elNames : ["2C"]).map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
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
        <ReportColumn
          title={t("menus.groups")}
          values={group.values}
          onChange={group.onChange}
          onDisplay={() => setShown({ title: "Groups", mode: group.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "all-elements", label: t("menus.allElementsPerEl") },
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
                  <input className="access-inset-field mt-1 w-16" value={groupNr} onChange={(e) => setGroupNr(e.target.value)} />
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
        <ReportColumn
          title={t("menus.elements")}
          values={element.values}
          onChange={element.onChange}
          onDisplay={() => setShown({ title: "Elements", mode: element.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: t("menus.tableUn"),
              name: "tableUn",
              options: [
                { value: "all-elements", label: t("menus.allElementsPerEl") },
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
        <ResultsPane mode={shown.mode} title={shown.title} rows={rows} xKey="label" yKey="value" yLabel="SPC [kWh/t NaOH]" />
      ) : null}
    </AccessHub>
  );
}
