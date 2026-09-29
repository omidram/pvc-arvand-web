"use client";

import { useState } from "react";
import { remarksApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Remark } from "@/lib/types";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessHub } from "@/components/layout/access-hub";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { DateInput } from "@/components/ui/date-input";

export default function RemarksPage() {
  const { canEdit } = useAuth();
  const { t } = useI18n();
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Remark>(
    "remarks",
    remarksApi,
    { limit: 500 }
  );
  const [active, setActive] = useState<number | "new" | null>(null);
  const rows = listQuery.data || [];

  function saveRow(row: Remark, patch: Partial<Remark>) {
    if (!canEdit("remarks")) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, ...patch } });
  }

  return (
    <AccessHub
      title={t("remarks.title")}
      titleBlue
      extraButtons={<ExportButtons prefix="/remarks" filenameBase="remarks" />}
    >
      <table className="access-cont-table">
        <thead>
          <tr>
            <th className="w-4" />
            <th className="w-16">{t("menus.number")}</th>
            <th className="w-36">{t("menus.date")}</th>
            <th>{t("menus.remark")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input className="w-14" value={row.id} readOnly />
              </td>
              <td>
                <DateInput
                  value={row.date?.slice(0, 10) || ""}
                  onChange={(e) => saveRow(row, { date: e.target.value || null })}
                  disabled={!canEdit("remarks")}
                />
              </td>
              <td>
                <input
                  className="w-full"
                  value={row.text || ""}
                  onChange={(e) => saveRow(row, { text: e.target.value })}
                  disabled={!canEdit("remarks")}
                />
              </td>
            </tr>
          ))}
          {canEdit("remarks") ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">{active === "new" ? "*" : "*"}</td>
              <td />
              <td>
                <DateInput
                  onChange={(e) => {
                    if (e.target.value) createMutation.mutate({ date: e.target.value, text: "" } as never);
                  }}
                />
              </td>
              <td>
                <input
                  className="w-full"
                  placeholder=""
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const text = (e.target as HTMLInputElement).value;
                      if (text) createMutation.mutate({ text } as never);
                    }
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {listQuery.isError ? <div className="mt-2 text-[12px] text-red-800">{(listQuery.error as Error).message}</div> : null}
      {removeMutation.isError ? null : null}
    </AccessHub>
  );
}
