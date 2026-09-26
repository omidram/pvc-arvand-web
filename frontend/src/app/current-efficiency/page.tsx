"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { currentEfficiencyEntriesApi, electrolyzersApi } from "@/lib/endpoints";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export default function CurrentEfficiencyPage() {
  const { t } = useI18n();
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
    <AccessHub title={t("mainMenu.currentEfficiency")}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="access-sunken px-3 py-2">
          <div className="text-[12px] font-bold">{t("menus.dataInput")}</div>
          <div className="mb-2 text-[11px]">{t("menus.ceFromNaoh")}</div>
          <div className="flex flex-wrap gap-1">
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              {t("menus.totalPlant")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              {t("menus.trains")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              {t("menus.electrolyzers")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=normalizations">
              {t("menus.groups")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/voltage?form=readings">
              {t("menus.elements")}
            </AccessBtn>
          </div>
        </div>
        <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      </div>

      <div className="grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
        <ReportColumn
          title={t("menus.totalPlant")}
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => display("Total Plant", plant, "plant")}
          groups={[
            {
              legend: t("menus.basis"),
              name: "basis",
              options: [
                { value: "anod", label: t("menus.anodBalEls") },
                { value: "naoh", label: t("menus.naohPlant") },
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
        <ReportColumn
          title={t("menus.train")}
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => display("Train", train, "train")}
          groups={[
            {
              legend: t("menus.basis"),
              name: "basis",
              options: [
                { value: "anod", label: t("menus.anodBalEls") },
                { value: "naoh", label: t("menus.naohTrain") },
              ],
            },
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualTrain") },
                { value: "all", label: t("menus.allTrains") },
              ],
              extra: (v) => (v === "individual" ? combo(trainNr, setTrainNr, ["1", "2", ...elNames]) : null),
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
          title={t("menus.electrolyzers")}
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => display("Electrolyzers", el, "electrolyzer")}
          groups={[
            {
              legend: t("menus.basis"),
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
                { value: "various", label: t("menus.variousEls") },
                { value: "all", label: t("menus.allElectrolyzers") },
              ],
              extra: (v) => (v === "individual" ? combo(elNr, setElNr, elNames.length ? elNames : ["2C"]) : null),
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
          onDisplay={() => display("Groups", group, "group")}
          groups={[
            {
              legend: t("menus.basis"),
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
          onDisplay={() => display("Elements", element, "element")}
          groups={[
            {
              legend: t("menus.basis"),
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
