"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cellComponentsApi } from "@/lib/endpoints";
import type { CellComponent } from "@/lib/types";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessHub } from "@/components/layout/access-hub";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import { cellComponentLabel } from "@/lib/cell-component-names";

function num(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function show(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Access Einzelteile formulas. Header fields are form-level, not stored per row. */
function totals(row: CellComponent, elementNo: number | null, spareNo: number | null) {
  const per = row.parts_per_element;
  if (per == null || elementNo == null) {
    return { total: null as number | null, recommended: null as number | null, calculated: null as number | null };
  }
  const total = per * elementNo;
  const recommended = total * 0.02;
  const calculated = spareNo == null ? null : per * spareNo * (row.reserve_index || 0);
  return { total, recommended, calculated };
}

export default function CellComponentsPage() {
  const { t, locale } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("elements");
  useCalendar();
  const queryClient = useQueryClient();
  const listQuery = useQuery({ queryKey: ["cell-components"], queryFn: cellComponentsApi.list });
  const [elementNo, setElementNo] = useState("");
  const [spareNo, setSpareNo] = useState("");
  const [active, setActive] = useState<number | "new" | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const save = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CellComponent> }) => cellComponentsApi.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cell-components"] }),
  });
  const create = useMutation({
    mutationFn: (payload: Partial<CellComponent>) => cellComponentsApi.create(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cell-components"] }),
  });

  const rows = listQuery.data || [];
  const elementCount = num(elementNo);
  const spareCount = num(spareNo);

  function patch(row: CellComponent, payload: Partial<CellComponent>) {
    if (!editable) return;
    save.mutate({ id: row.id, payload });
  }

  return (
    <AccessHub
      title={t("cellComponents.title")}
      backHref="/elements"
      backLabel={t("elements.title")}
      extraButtons={
        <>
          <ExportButtons prefix="/cell-components" filenameBase="cell-components" />
          <Link href="/" className="access-menu-btn access-hub-menu-btn">
            {t("common.mainMenu")}
          </Link>
        </>
      }
    >
      <div className="cell-sheet-bar flex flex-wrap items-end justify-between gap-4 text-[12px]">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t("cellComponents.noOfElements")}</span>
            <input className="access-inset-field w-24" value={elementNo} onChange={(e) => setElementNo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold">{t("cellComponents.spareElements")}</span>
            <input className="access-inset-field w-24" value={spareNo} onChange={(e) => setSpareNo(e.target.value)} />
          </label>
        </div>
        <div className="cell-sheet-date access-inset-field flex h-[22px] w-[110px] items-center px-2">{formatDate(today)}</div>
      </div>

      {listQuery.isLoading ? <LoadingState /> : null}
      {listQuery.isError ? <ErrorState message={(listQuery.error as Error).message} /> : null}

      {listQuery.data ? (
        <div className="cell-sheet overflow-auto">
          <table className="access-cont-table min-w-[980px]">
            <thead>
              <tr>
                <th className="w-4" />
                <th>{t("cellComponents.partNo")}</th>
                <th>{t("cellComponents.description")}</th>
                <th>{t("cellComponents.drawingNo")}</th>
                <th>{t("cellComponents.rev")}</th>
                <th>{t("cellComponents.perElement")}</th>
                <th>{t("cellComponents.total")}</th>
                <th>{t("cellComponents.recommended")}</th>
                <th>{t("cellComponents.calculated")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const calc = totals(row, elementCount, spareCount);
                const description = cellComponentLabel(row, t);
                return (
                  <tr key={row.id} className={active === row.id ? "is-active" : undefined} onClick={() => setActive(row.id)}>
                    <td className="access-selector">{active === row.id ? "►" : ""}</td>
                    <td>
                      <input
                        className="w-16"
                        defaultValue={row.part_nr || ""}
                        disabled={!editable}
                        onBlur={(e) => e.target.value !== (row.part_nr || "") && patch(row, { part_nr: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        key={`${row.id}-${locale}-${row.name || ""}`}
                        className="w-full min-w-[180px]"
                        defaultValue={description}
                        disabled={!editable}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next === description || next === (row.name || "")) return;
                          patch(row, { name: e.target.value });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="w-28"
                        defaultValue={row.drawing_nr || ""}
                        disabled={!editable}
                        onBlur={(e) => e.target.value !== (row.drawing_nr || "") && patch(row, { drawing_nr: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-14"
                        defaultValue={row.revision || ""}
                        disabled={!editable}
                        onBlur={(e) => e.target.value !== (row.revision || "") && patch(row, { revision: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="w-16"
                        defaultValue={show(row.parts_per_element)}
                        disabled={!editable}
                        onBlur={(e) => {
                          const next = num(e.target.value);
                          if (next !== row.parts_per_element) patch(row, { parts_per_element: next });
                        }}
                      />
                    </td>
                    <td className="is-calc px-2">{show(calc.total)}</td>
                    <td className="is-calc px-2">{show(calc.recommended)}</td>
                    <td className="is-calc px-2">{show(calc.calculated)}</td>
                  </tr>
                );
              })}
              {editable ? (
                <tr className={active === "new" ? "is-active" : undefined} onClick={() => setActive("new")}>
                  <td className="access-selector">*</td>
                  <td>
                    <input
                      className="w-16"
                      onBlur={(e) => {
                        if (e.target.value.trim()) create.mutate({ part_nr: e.target.value.trim(), reserve_index: 0 });
                      }}
                    />
                  </td>
                  <td colSpan={7} />
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </AccessHub>
  );
}
