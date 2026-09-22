"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { currentEfficiencyEntriesApi, electrolyzersApi } from "@/lib/endpoints";
import { formatDate } from "@/lib/utils";

export default function CurrentEfficiencyPage() {
  const [from, setFrom] = useState("2006-06-01");
  const [till, setTill] = useState("2016-10-04");
  const [shown, setShown] = useState<{ title: string; mode: "chart" | "table"; scope: string } | null>(null);
  const plant = useColumnState({ basis: "naoh", result: "chart" });
  const train = useColumnState({ basis: "naoh", calc: "individual", result: "chart" });
  const el = useColumnState({ basis: "naoh", calc: "individual", result: "chart" });
  const group = useColumnState({ basis: "naoh", calc: "individual", result: "chart" });
  const element = useColumnState({ basis: "naoh", calc: "individual", result: "chart" });
  const [trainNr, setTrainNr] = useState("2");
  const [elNr, setElNr] = useState("2C");
  const [groupNr, setGroupNr] = useState("1");

  const ceQuery = useQuery({
    queryKey: ["current-efficiency-entries"],
    queryFn: () => currentEfficiencyEntriesApi.list({ limit: 2000 }),
  });
  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });

  const rows = useMemo(() => {
    const items = ceQuery.data || [];
    return items
      .filter((r) => {
        if (!shown) return false;
        const d = r.date ? r.date.slice(0, 10) : "";
        if (from && d && d < from) return false;
        if (till && d && d > till) return false;
        if (shown.scope === "plant") return r.scope === "plant" || !r.scope_ref;
        if (shown.scope === "train") return r.scope === "sub_plant";
        if (shown.scope === "electrolyzer") return r.scope === "electrolyzer";
        if (shown.scope === "group") return r.scope === "group" || Boolean(r.scope_ref && r.scope !== "electrolyzer" && r.scope !== "element");
        return r.scope === "element";
      })
      .map((r) => ({
        label: r.scope_ref || r.position || formatDate(r.date) || String(r.id),
        value: r.value_pct,
        date: formatDate(r.date),
      }));
  }, [ceQuery.data, shown, from, till]);

  function display(title: string, col: { values: Record<string, string> }, scope: string) {
    setShown({ title, mode: col.values.result === "table" ? "table" : "chart", scope });
  }

  const combo = (value: string, onChange: (v: string) => void, options: string[]) => (
    <select className="access-inset-field mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );

  const elNames = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);

  return (
    <AccessHub title="Current Efficiency">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="access-sunken px-3 py-2">
          <div className="text-[12px] font-bold">Data Input</div>
          <div className="mb-2 text-[11px]">CE from NaOH Production</div>
          <div className="flex flex-wrap gap-1">
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              Total Plant
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              Trains
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              Electrolyzers
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              Groups
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=readings">
              Elements
            </AccessBtn>
          </div>
        </div>
        <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      </div>

      <div className="grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
        <ReportColumn
          title="Total Plant"
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => display("Total Plant", plant, "plant")}
          groups={[
            {
              legend: "Basis",
              name: "basis",
              options: [
                { value: "anod", label: "Anod. Bal. Electrolyzers" },
                { value: "naoh", label: "NaOH Prod. Tot. Plant" },
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
        <ReportColumn
          title="Train"
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => display("Train", train, "train")}
          groups={[
            {
              legend: "Basis",
              name: "basis",
              options: [
                { value: "anod", label: "Anod. Bal. Electrolyzers" },
                { value: "naoh", label: "NaOH Prod. Train" },
              ],
            },
            {
              legend: "Calculation for",
              name: "calc",
              options: [
                { value: "individual", label: "Individual Train" },
                { value: "all", label: "All Trains" },
              ],
              extra: (v) => (v === "individual" ? combo(trainNr, setTrainNr, ["1", "2", ...elNames]) : null),
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
          title="Electrolyzers"
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => display("Electrolyzers", el, "electrolyzer")}
          groups={[
            {
              legend: "Basis",
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
                { value: "various", label: "Various Electrolyseurs" },
                { value: "all", label: "All Electrolyzers" },
              ],
              extra: (v) => (v === "individual" ? combo(elNr, setElNr, elNames.length ? elNames : ["2C"]) : null),
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
          onDisplay={() => display("Groups", group, "group")}
          groups={[
            {
              legend: "Basis",
              name: "basis",
              options: [
                { value: "anod", label: "Anod. Balance Group" },
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
          onDisplay={() => display("Elements", element, "element")}
          groups={[
            {
              legend: "Basis",
              name: "basis",
              options: [
                { value: "anod", label: "Anod. Balance Element" },
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
        <ResultsPane
          mode={shown.mode}
          title={shown.title}
          rows={rows}
          xKey="label"
          yKey="value"
          yLabel="CE [%]"
        />
      ) : null}
    </AccessHub>
  );
}
