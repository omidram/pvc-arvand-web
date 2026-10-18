"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, useColumnState } from "@/components/layout/access-report";
import { CathodicCeSheet } from "@/components/domain/cathodic-ce-sheet";
import { CurrentEfficiencyDataInput, type CeInputMode } from "@/components/domain/current-efficiency-data-input";
import { CeFormulaGuide } from "@/components/domain/ce-formula-guide";
import { UnCeResultsPane, UnCeSettingsPanel } from "@/components/domain/un-ce-board";
import { pairsToElements, unCeApi, type UnCeCalc, type UnCeQuery, type UnCeScope } from "@/lib/un-ce";
import { ElectrolyzerCombo, useElectrolyzerNames } from "@/components/ui/electrolyzer-combo";
import { AccessSeveralBox } from "@/components/ui/access-several-box";
import { CellPicker } from "@/components/ui/cell-picker";
import { LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { monthStartIso, todayIsoLocal } from "@/lib/date-range";

function CeBoard() {
  const { t } = useI18n();
  const [from, setFrom] = useState(monthStartIso);
  const [till, setTill] = useState(todayIsoLocal);
  const [shown, setShown] = useState<{
    title: string;
    mode: "chart" | "table";
    scope: string;
    basis: "anodic" | "naoh";
    stamp: number;
  } | null>(null);
  const plant = useColumnState({ basis: "anod", result: "chart" });
  const train = useColumnState({ basis: "anod", calc: "individual", result: "chart" });
  const el = useColumnState({ basis: "anod", calc: "individual", result: "chart" });
  const group = useColumnState({ basis: "anod", calc: "individual", result: "chart" });
  const element = useColumnState({ basis: "anod", calc: "individual", result: "chart" });
  const [trainNr, setTrainNr] = useState("2");
  const [elNr, setElNr] = useState("");
  const [groupNr, setGroupNr] = useState("1");
  const [severalEl, setSeveralEl] = useState<string[]>([]);
  const [severalGroups, setSeveralGroups] = useState<string[]>([]);
  const [severalElements, setSeveralElements] = useState<string[]>([]);
  const [pickedCellEl, setCellEl] = useState("");
  const [cellPos, setCellPos] = useState("");
  const elNames = useElectrolyzerNames();
  const cellEl = pickedCellEl || elNames[0] || "";
  const elSel = elNr || elNames[0] || "";

  const spec = useMemo(() => {
    if (!shown) return null;
    const col = { plant, train, electrolyzer: el, group, element }[shown.scope as "plant"];
    const rawCalc = col.values.calc === "various" ? "several" : col.values.calc;
    const calc = (shown.scope === "plant" ? "all" : rawCalc || "all") as UnCeCalc;
    const q: UnCeQuery = { scope: shown.scope as UnCeScope, calc, dateFrom: from, dateTill: till };
    if (calc === "individual") {
      if (shown.scope === "train") q.trains = [trainNr];
      if (shown.scope === "electrolyzer") q.electrolyzers = [elSel];
      if (shown.scope === "group") q.groups = [groupNr];
      if (shown.scope === "element") q.elements = cellEl && cellPos ? [`${cellEl}:${cellPos}`] : [];
    } else if (calc === "several") {
      if (shown.scope === "electrolyzer") q.electrolyzers = severalEl.filter(Boolean);
      if (shown.scope === "group") q.groups = severalGroups.filter(Boolean);
      if (shown.scope === "element") q.elements = pairsToElements(severalElements);
    }
    return { query: q, basis: shown.basis };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, from, till]);

  const ceQuery = useQuery({
    queryKey: ["un-ce", "ce", spec],
    queryFn: () => unCeApi.ce(spec!.query, spec!.basis),
    enabled: Boolean(spec),
    placeholderData: (prev) => prev,
  });

  function display(title: string, col: { values: Record<string, string> }, scope: string) {
    setShown({
      title,
      mode: col.values.result === "table" ? "table" : "chart",
      scope,
      basis: col.values.basis === "naoh" ? "naoh" : "anodic",
      stamp: Date.now(),
    });
  }

  const trainCombo = (value: string, onChange: (v: string) => void) => (
    <select className="access-inset-field mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      {["1", "2"].map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <AccessHub title={t("mainMenu.currentEfficiency")}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="access-sunken px-3 py-2">
          <div className="text-[12px] font-bold">{t("menus.dataInput")}</div>
          <div className="mb-2 text-[11px]">{t("menus.ceFromNaoh")}</div>
          <div className="flex flex-wrap gap-1">
            {/* Access Anodische Bilanz → frmTabelleEingabeCE*NaOH */}
            <AccessBtn className="!w-auto" href="/current-efficiency?form=input-plant">
              {t("menus.totalPlant")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=input-train">
              {t("menus.trains")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=input-electrolyzer">
              {t("menus.electrolyzers")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=input-group">
              {t("menus.groups")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=input-element">
              {t("menus.elements")}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=cathodic-1">
              {t("cathodicCe.open", { train: 1 })}
            </AccessBtn>
            <AccessBtn className="!w-auto" href="/current-efficiency?form=cathodic-2">
              {t("cathodicCe.open", { train: 2 })}
            </AccessBtn>
          </div>
        </div>
        <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      </div>

      <div className="mb-2">
        <CeFormulaGuide />
      </div>

      <UnCeSettingsPanel />

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
              extra: (v) => (v === "individual" ? trainCombo(trainNr, setTrainNr) : null),
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
              extra: (v) =>
                v === "individual" ? (
                  <ElectrolyzerCombo variant="access" className="mt-1 w-full" value={elSel} onChange={setElNr} />
                ) : v === "various" || v === "several" ? (
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
              extra: (v) =>
                v === "individual" ? (
                  <CellPicker
                    electrolyzer={cellEl}
                    position={cellPos}
                    onElectrolyzerChange={setCellEl}
                    onPositionChange={setCellPos}
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

      {shown ? <UnCeResultsPane title={shown.title} mode={shown.mode} query={ceQuery} /> : null}
    </AccessHub>
  );
}

const INPUT_FORMS: Record<string, CeInputMode> = {
  "input-plant": "plant",
  "input-train": "train",
  "input-electrolyzer": "electrolyzer",
  "input-group": "group",
  "input-element": "element",
};

function CurrentEfficiencyPageInner() {
  const searchParams = useSearchParams();
  const form = searchParams.get("form") || undefined;
  if (form === "cathodic-1") return <CathodicCeSheet key="cathodic-1" train={1} />;
  if (form === "cathodic-2") return <CathodicCeSheet key="cathodic-2" train={2} />;
  const mode = form ? INPUT_FORMS[form] : undefined;
  if (mode) return <CurrentEfficiencyDataInput mode={mode} />;
  return <CeBoard />;
}

export default function CurrentEfficiencyPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CurrentEfficiencyPageInner />
    </Suspense>
  );
}
