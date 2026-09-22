"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { electrolyzersApi, reportsApi, statisticsApi } from "@/lib/endpoints";

export default function PowerConsumptionPage() {
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
    <AccessHub title="Power Consumption">
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <div className="grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
        <ReportColumn
          title="Total Plant"
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => setShown({ title: "Total Plant", mode: plant.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: "Results as",
              name: "result",
              options: [
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ],
            },
          ]}
        />
        <ReportColumn
          title="Train"
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => setShown({ title: "Train", mode: train.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: "Results as",
              name: "result",
              options: [
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ],
            },
          ]}
        />
        <ReportColumn
          title="Electrolyzers"
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => setShown({ title: "Electrolyzers", mode: el.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: "Table Un",
              name: "tableUn",
              options: [
                { value: "electrolyzers", label: "Electrolyzers" },
                { value: "all-elements", label: "All Elements per Electrol." },
              ],
            },
            {
              legend: "Basis CE",
              name: "basis",
              options: [
                { value: "anod", label: "Anod. Bal. Electrolyzer" },
                { value: "naoh", label: "NaOH Prod. Electrolyzer" },
              ],
            },
            {
              legend: "Calculation for",
              name: "calc",
              options: [
                { value: "individual", label: "Individual Electrolyzer" },
                { value: "several", label: "Several Electrolyzers" },
                { value: "all", label: "All Electrolyzers" },
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
              legend: "Results as",
              name: "result",
              options: [
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ],
            },
          ]}
        />
        <ReportColumn
          title="Groups"
          values={group.values}
          onChange={group.onChange}
          onDisplay={() => setShown({ title: "Groups", mode: group.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: "Table Un",
              name: "tableUn",
              options: [
                { value: "all-elements", label: "All Elements per Electrol." },
                { value: "groups", label: "Groups" },
              ],
            },
            {
              legend: "Basis CE",
              name: "basis",
              options: [
                { value: "anod", label: "Anodic Bal. Group" },
                { value: "naoh", label: "NaOH Prod. Group" },
              ],
            },
            {
              legend: "Calculation for",
              name: "calc",
              options: [
                { value: "individual", label: "Individual Group" },
                { value: "several", label: "Several Groups" },
                { value: "all", label: "All Groups" },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <input className="access-inset-field mt-1 w-16" value={groupNr} onChange={(e) => setGroupNr(e.target.value)} />
                ) : null,
            },
            {
              legend: "Results as",
              name: "result",
              options: [
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ],
            },
          ]}
        />
        <ReportColumn
          title="Elements"
          values={element.values}
          onChange={element.onChange}
          onDisplay={() => setShown({ title: "Elements", mode: element.values.result === "table" ? "table" : "chart" })}
          groups={[
            {
              legend: "Table Un",
              name: "tableUn",
              options: [
                { value: "all-elements", label: "All Elements per Electrol." },
                { value: "individual", label: "Individual Element" },
              ],
            },
            {
              legend: "Basis CE",
              name: "basis",
              options: [
                { value: "anod", label: "Anodic Bal. Element" },
                { value: "naoh", label: "NaOH Prod. Element" },
              ],
            },
            {
              legend: "Calculation for",
              name: "calc",
              options: [
                { value: "individual", label: "Individual Element" },
                { value: "several", label: "Several Elements" },
                { value: "all", label: "All Elements" },
              ],
            },
            {
              legend: "Results as",
              name: "result",
              options: [
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
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
