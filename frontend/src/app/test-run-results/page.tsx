"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { performanceTestsApi, settingsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { PerformanceTest } from "@/lib/types";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessHub } from "@/components/layout/access-hub";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { DateInput } from "@/components/ui/date-input";
import { PlantPartCombo } from "@/components/ui/plant-part-combo";

type Draft = {
  date: string;
  plant_part: string;
  ce_pct: string;
  spc_kwh: string;
};

const emptyDraft = (): Draft => ({ date: "", plant_part: "", ce_pct: "", spc_kwh: "" });

export default function TestRunResultsPage() {
  const { canEdit } = useAuth();
  const { t } = useI18n();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const { listQuery, createMutation, updateMutation } = useCrudResource<PerformanceTest>(
    "performance-tests",
    performanceTestsApi,
    { limit: 500 }
  );
  const [active, setActive] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const rows = listQuery.data || [];
  const s = settingsQuery.data;
  const editable = canEdit("voltage");

  function save(row: PerformanceTest, patch: Partial<PerformanceTest>) {
    if (!editable) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, ...patch } });
  }

  function commitDraft(next: Draft) {
    setDraft(next);
    if (!editable || !next.date || !next.plant_part) return;
    createMutation.mutate(
      {
        date: next.date,
        plant_part: next.plant_part,
        ce_pct: next.ce_pct === "" ? null : Number(next.ce_pct),
        spc_kwh: next.spc_kwh === "" ? null : Number(next.spc_kwh),
      } as never,
      { onSuccess: () => setDraft(emptyDraft()) }
    );
  }

  return (
    <AccessHub
      title={t("menus.performanceTests")}
      titleBlue
      extraButtons={<ExportButtons prefix="/performance-tests" filenameBase="performance-tests" />}
    >
      <div className="access-plant-bar">
        <span>{s?.customer || "PVC Arvand"}</span>
        <span>{s?.plant_type === "KOH" ? t("menus.kohElectrolysis") : t("menus.naclElectrolysis")}</span>
        <span>{s?.uan || "03-3039"}</span>
      </div>
      <table className="access-cont-table">
        <thead>
          <tr>
            <th className="w-4" />
            <th className="w-40">{t("menus.date")}</th>
            <th>{t("menus.partOfPlant")}</th>
            <th className="w-28">CE [%]</th>
            <th className="w-40">SPC [kWh/t NaOH]</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)} className={active === row.id ? "is-active-row" : undefined}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <DateInput
                  value={row.date?.slice(0, 10) || ""}
                  onChange={(e) => save(row, { date: e.target.value || null })}
                  disabled={!editable}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                {editable ? (
                  <PlantPartCombo
                    variant="access"
                    className="w-full min-w-[8rem]"
                    value={row.plant_part || ""}
                    onChange={(v) => save(row, { plant_part: v || null })}
                    aria-label={t("menus.partOfPlant")}
                  />
                ) : (
                  <span className="block px-1">{row.plant_part || "—"}</span>
                )}
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  step="0.01"
                  className="w-24"
                  value={row.ce_pct ?? ""}
                  onChange={(e) => save(row, { ce_pct: e.target.value === "" ? null : Number(e.target.value) })}
                  disabled={!editable}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  step="0.01"
                  className="w-28"
                  value={row.spc_kwh ?? ""}
                  onChange={(e) => save(row, { spc_kwh: e.target.value === "" ? null : Number(e.target.value) })}
                  disabled={!editable}
                />
              </td>
            </tr>
          ))}
          {editable ? (
            <tr onClick={() => setActive("new")} className={active === "new" ? "is-active-row" : undefined}>
              <td className="access-selector">*</td>
              <td onClick={(e) => e.stopPropagation()}>
                <DateInput
                  value={draft.date}
                  onChange={(e) => commitDraft({ ...draft, date: e.target.value })}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <PlantPartCombo
                  variant="access"
                  className="w-full min-w-[8rem]"
                  value={draft.plant_part}
                  onChange={(v) => commitDraft({ ...draft, plant_part: v })}
                  aria-label={t("menus.partOfPlant")}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  step="0.01"
                  className="w-24"
                  value={draft.ce_pct}
                  onChange={(e) => setDraft((d) => ({ ...d, ce_pct: e.target.value }))}
                  onBlur={() => {
                    if (draft.date && draft.plant_part) commitDraft(draft);
                  }}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="number"
                  step="0.01"
                  className="w-28"
                  value={draft.spc_kwh}
                  onChange={(e) => setDraft((d) => ({ ...d, spc_kwh: e.target.value }))}
                  onBlur={() => {
                    if (draft.date && draft.plant_part) commitDraft(draft);
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </AccessHub>
  );
}
