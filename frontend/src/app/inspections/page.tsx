"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inspectionsApi, inspectionGridsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { InspectionReport } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { AccessSubform } from "@/components/layout/access-form";
import { InspectionRelations } from "@/components/domain/access-relations";
import { InspectionDefectGrid } from "@/components/domain/inspection-defect-grid";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";

const GRID_TYPES = ["anode_half", "cathode_half", "membrane_as", "membrane_ks", "membrane_lt"] as const;

function InspectionGrids({ inspection }: { inspection: InspectionReport }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("inspections");
  const queryClient = useQueryClient();
  const gridsQuery = useQuery({
    queryKey: ["inspection-grids", inspection.id],
    queryFn: () => inspectionGridsApi.list(inspection.id),
  });
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const saveMutation = useMutation({
    mutationFn: ({ gridType, data }: { gridType: string; data: Record<string, unknown> }) =>
      inspectionGridsApi.upsert(inspection.id, gridType, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inspection-grids", inspection.id] }),
  });

  function getDraft(gridType: string): Record<string, unknown> {
    if (drafts[gridType] !== undefined) return drafts[gridType];
    const existing = gridsQuery.data?.find((g) => g.grid_type === gridType);
    return (existing?.grid_data as Record<string, unknown>) ?? {};
  }

  return (
    <AccessSubform caption={t("inspections.halfShellGrids")}>
      {gridsQuery.isLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-4 p-1">
          <p className="text-[11px] text-[var(--win-muted)]">{t("inspections.gridsHelp")}</p>
          {GRID_TYPES.map((gt) => (
            <div key={gt} className="border-b border-[#c0c0c0] pb-3 last:border-0">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-bold">{t(`enums.gridType.${gt}`)}</span>
                {editable && (
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate({ gridType: gt, data: getDraft(gt) })}
                    disabled={saveMutation.isPending}
                  >
                    {t("common.save")}
                  </Button>
                )}
              </div>
              <InspectionDefectGrid
                title={undefined}
                value={getDraft(gt)}
                disabled={!editable}
                onChange={(next) => setDrafts((d) => ({ ...d, [gt]: next }))}
              />
            </div>
          ))}
        </div>
      )}
    </AccessSubform>
  );
}

export default function InspectionsPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<InspectionReport>(
    "inspections",
    inspectionsApi,
    { limit: 500 }
  );

  const fields: FieldDef[] = [
    { name: "element_nr", label: t("fields.elementNr"), required: true },
    { name: "inspection_reason", label: t("fields.inspectionReason") },
    { name: "inspector_name", label: t("fields.inspectorName") },
    { name: "inspection_date", label: t("fields.inspectionDate"), type: "datetime-local" },
    { name: "blister_anode_area", label: t("fields.blisterAnodeArea") },
    { name: "blister_periphery_top", label: t("fields.blisterPeripheryTop") },
    { name: "blister_periphery_bottom", label: t("fields.blisterPeripheryBottom") },
    { name: "blister_periphery_side", label: t("fields.blisterPeripherySide") },
    { name: "blister_corners", label: t("fields.blisterCorners") },
    { name: "folds", label: t("fields.folds") },
    { name: "pressure_marks", label: t("fields.pressureMarks") },
    { name: "visible_holes", label: t("fields.visibleHoles") },
    { name: "cracks", label: t("fields.cracks") },
    { name: "blister_remarks", label: t("fields.blisterRemarks"), type: "textarea", span: 2 },
    { name: "sample_anode", label: t("fields.sampleAnode"), type: "checkbox" },
    { name: "sample_cathode", label: t("fields.sampleCathode"), type: "checkbox" },
    { name: "sample_membrane", label: t("fields.sampleMembrane"), type: "checkbox" },
    { name: "anode_tube_ok", label: t("fields.anodeTubeOk"), type: "checkbox" },
    { name: "anode_tube_remark", label: t("fields.anodeTubeRemark") },
    { name: "cathode_tube_ok", label: t("fields.cathodeTubeOk"), type: "checkbox" },
    { name: "cathode_tube_remark", label: t("fields.cathodeTubeRemark") },
    { name: "anode_spacer_ok", label: t("fields.anodeSpacerOk"), type: "checkbox" },
    { name: "anode_spacer_remark", label: t("fields.anodeSpacerRemark") },
    { name: "cathode_spacer_ok", label: t("fields.cathodeSpacerOk"), type: "checkbox" },
    { name: "cathode_spacer_remark", label: t("fields.cathodeSpacerRemark") },
    { name: "frame_gasket_ok", label: t("fields.frameGasketOk"), type: "checkbox" },
    { name: "frame_gasket_remark", label: t("fields.frameGasketRemark") },
    { name: "general_remarks", label: t("fields.generalRemarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<InspectionReport>[] = [
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "inspection_reason", header: t("inspections.reason") },
    { key: "inspector_name", header: t("fields.inspector") },
    { key: "inspection_date", header: t("fields.date"), render: (r) => formatDateTime(r.inspection_date) },
  ];

  return (
    <AccessWorkspace<InspectionReport>
      caption={t("menus.elementInspection")}
      helpKey="inspections"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="id"
      canEdit={canEdit("inspections")}
      onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
      onCreate={(values) => createMutation.mutate(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("inspections.confirmDelete", { nr: row.element_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/inspections"
      filenameBase="inspections"
      related={(row) => (
        <>
          <InspectionRelations row={row} />
          <InspectionGrids inspection={row} />
        </>
      )}
    />
  );
}
