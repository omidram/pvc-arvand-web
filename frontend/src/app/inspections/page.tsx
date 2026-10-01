"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { inspectionGridsApi, inspectionsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { InspectionReport } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { InspectionRelations } from "@/components/domain/access-relations";
import { InspectionSheet, inspectionSheetGrids, inspectionSheetPayload } from "@/components/domain/inspection-sheet";
import type { Column } from "@/components/ui/data-table";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { canWorkInspections } from "@/lib/inspection-access";
import { inspectionReasonLabel } from "@/lib/inspection-reason-names";

function saveError(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return "";
}

export default function InspectionsPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canWorkInspections(canEdit);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { listQuery, removeMutation } = useCrudResource<InspectionReport>("inspections", inspectionsApi, { limit: 500 });

  const columns: Column<InspectionReport>[] = [
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.position") },
    { key: "inspection_reason", header: t("inspections.reason"), render: (row) => inspectionReasonLabel(row.inspection_reason, t) },
    { key: "inspector_name", header: t("fields.inspector") },
    { key: "inspection_date", header: t("fields.date"), render: (row) => formatDateTime(row.inspection_date) },
  ];

  async function persist(id: string | number | null, values: Record<string, unknown>) {
    setSaving(true);
    try {
      const payload = inspectionSheetPayload(values);
      const saved =
        id == null
          ? await inspectionsApi.create(payload as Partial<InspectionReport>)
          : await inspectionsApi.update(id, payload as Partial<InspectionReport>);
      const grids = inspectionSheetGrids(values);
      await Promise.all(
        Object.entries(grids).map(([gridType, data]) => inspectionGridsApi.upsert(saved.id, gridType, data))
      );
      await queryClient.invalidateQueries({ queryKey: ["inspections"] });
      await queryClient.invalidateQueries({ queryKey: ["inspection-grids", saved.id] });
    } catch (err) {
      const detail = saveError(err);
      window.alert(detail ? `${t("inspections.saveFailed")} ${detail}` : t("inspections.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessWorkspace<InspectionReport>
      caption={t("menus.elementInspection")}
      helpKey="inspections"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={[]}
      columns={columns}
      idField="id"
      canEdit={editable}
      submitting={saving || removeMutation.isPending}
      onSave={(id, values) => persist(id, values)}
      onCreate={(values) => persist(null, values)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("inspections.confirmDelete", { nr: row.element_nr })}
      exportPrefix="/inspections"
      filenameBase="inspections"
      formBody={(ctx) => (
        <InspectionSheet
          values={ctx.values}
          onChange={ctx.onChange}
          onPatch={ctx.onPatch}
          readOnly={ctx.readOnly}
          recordId={ctx.recordId}
        />
      )}
      related={(row) => <InspectionRelations row={row} />}
    />
  );
}
