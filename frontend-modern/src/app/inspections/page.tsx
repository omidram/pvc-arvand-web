"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Grid3x3 } from "lucide-react";
import { inspectionsApi, inspectionGridsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { InspectionReport } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { InspectionDefectGrid } from "@/components/domain/inspection-defect-grid";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

type T = ReturnType<typeof useI18n>["t"];

function buildFields(t: T): FieldDef[] {
  return [
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
}

const GRID_TYPES = ["anode_half", "cathode_half", "membrane_as", "membrane_ks", "membrane_lt"] as const;

export default function InspectionsPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("inspections");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<InspectionReport | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [gridsFor, setGridsFor] = useState<InspectionReport | null>(null);

  const listParams = q ? { q, limit: 500 } : { limit: 500 };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<InspectionReport>(
    "inspections",
    inspectionsApi,
    listParams
  );

  const columns: Column<InspectionReport>[] = [
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "inspection_reason", header: t("inspections.reason") },
    { key: "inspector_name", header: t("fields.inspector") },
    { key: "inspection_date", header: t("fields.date"), render: (r) => formatDateTime(r.inspection_date) },
    { key: "general_remarks", header: t("fields.remarks") },
  ];

  function handleSubmit(values: Record<string, unknown>) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
    }
  }

  function handleDelete(row: InspectionReport) {
    if (confirm(t("inspections.confirmDelete", { nr: row.element_nr }))) removeMutation.mutate(row.id);
  }

  return (
    <div>
      <PageHeader
        title={t("inspections.title")}
        description={t("inspections.description")}
        helpKey="inspections"
        actions={
          <>
            <ExportButtons prefix="/inspections" params={listParams} filenameBase="inspections" />
            {editable && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus size={16} /> {t("inspections.newInspection")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Input
          placeholder={t("inspections.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField="id"
          isLoading={listQuery.isLoading}
          emptyTitle={t("inspections.noReportsFound")}
          actions={(row) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => setGridsFor(row)} title={t("inspections.halfShellGrids")}>
                <Grid3x3 size={14} />
              </Button>
              {editable && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row);
                      setShowForm(true);
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )}
            </>
          )}
        />
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("inspections.editInspection", { nr: editing.element_nr }) : t("inspections.newInspectionTitle")}
        wide
      >
        <ResourceForm<InspectionReport>
          fields={buildFields(t)}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      {gridsFor && <GridsModal inspection={gridsFor} onClose={() => setGridsFor(null)} editable={editable} />}
    </div>
  );
}

function GridsModal({ inspection, onClose, editable }: { inspection: InspectionReport; onClose: () => void; editable: boolean }) {
  const { t } = useI18n();
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
    <Modal open onClose={onClose} title={t("inspections.gridsTitle", { nr: inspection.element_nr })} wide>
      {gridsQuery.isLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-[var(--win-muted)]">{t("inspections.gridsHelp")}</p>
          {GRID_TYPES.map((gt) => (
            <div key={gt}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-bold text-[var(--win-text)]">{t(`enums.gridType.${gt}`)}</span>
                {editable && (
                  <Button size="sm" onClick={() => saveMutation.mutate({ gridType: gt, data: getDraft(gt) })} disabled={saveMutation.isPending}>
                    {t("common.save")}
                  </Button>
                )}
              </div>
              <InspectionDefectGrid
                value={getDraft(gt)}
                disabled={!editable}
                onChange={(next) => setDrafts((d) => ({ ...d, [gt]: next }))}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
