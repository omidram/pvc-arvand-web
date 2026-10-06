"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AssemblyInspectionSheet,
  assemblyInspectionPayload,
} from "@/components/domain/assembly-inspection-sheet";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import type { Column } from "@/components/ui/data-table";
import { emptyAssemblyCheckRemarks, emptyAssemblyChecks } from "@/lib/assembly-inspection";
import { useAuth } from "@/lib/auth/context";
import { assemblyInspectionsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import type { AssemblyInspectionReport } from "@/lib/types";
import { useCrudResource } from "@/lib/use-resource";
import { formatDate } from "@/lib/utils";
import { assemblyInspectionDatasheetFields } from "@/lib/access-datasheet-fields";
import { appAlert, appConfirm } from "@/lib/dialog";

function checklistSummary(checks: Record<string, boolean> | null | undefined): string {
  const entries = checks ? Object.entries(checks) : [];
  if (!entries.length) return "";
  const done = entries.filter(([, ok]) => ok).length;
  return `${done}/${entries.length}`;
}

function checklistRemarkCount(remarks: Record<string, string> | null | undefined): string {
  if (!remarks) return "";
  const n = Object.values(remarks).filter((v) => String(v || "").trim()).length;
  return n ? String(n) : "";
}

function saveError(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (err instanceof Error && err.message) return err.message;
  return "";
}

export default function AssemblyInspectionPage() {
  const { t } = useI18n();
  const { canEdit, canView } = useAuth();
  const editable = canEdit("elements") || canEdit("inspections");
  const visible = canView("elements") || canView("inspections") || canView("anodes") || canView("cathodes");
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { listQuery, removeMutation } = useCrudResource<AssemblyInspectionReport>(
    "assembly-inspections",
    assemblyInspectionsApi,
    { limit: 500 }
  );

  if (!visible) return null;

  const fields = assemblyInspectionDatasheetFields(t);

  const columns: Column<AssemblyInspectionReport>[] = [
    { key: "assembly_date", header: t("fields.assemblyDate"), render: (row) => formatDate(row.assembly_date) },
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.membraneType") },
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.position") },
    { key: "group_nr", header: t("fields.group") },
    {
      key: "checks",
      header: t("assemblyInspection.activities"),
      render: (row) => checklistSummary(row.checks) || "—",
      filterText: (row) => checklistSummary(row.checks),
    },
    {
      key: "check_remarks",
      header: t("assemblyInspection.checked"),
      render: (row) => checklistRemarkCount(row.check_remarks) || "—",
      filterText: (row) => checklistRemarkCount(row.check_remarks),
    },
  ];

  async function persist(id: string | number | null, values: Record<string, unknown>) {
    setSaving(true);
    try {
      const payload = assemblyInspectionPayload(values);
      if (id == null) {
        await assemblyInspectionsApi.create(payload as Partial<AssemblyInspectionReport>);
      } else {
        await assemblyInspectionsApi.update(id, payload as Partial<AssemblyInspectionReport>);
      }
      await queryClient.invalidateQueries({ queryKey: ["assembly-inspections"] });
    } catch (err) {
      const detail = saveError(err);
      await appAlert(detail ? `${t("assemblyInspection.saveFailed")} ${detail}` : t("assemblyInspection.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccessWorkspace<AssemblyInspectionReport>
      caption={t("assemblyInspection.title")}
      helpKey="assemblyInspection"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="id"
      canEdit={editable}
      submitting={saving || removeMutation.isPending}
      onSave={(id, values) => persist(id, values)}
      onCreate={(values) => persist(null, values)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("assemblyInspection.confirmDelete", { nr: row.element_nr || row.id })}
      exportPrefix="/assembly-inspections"
      filenameBase="assembly-inspections"
      newDefaults={() => ({
        checks: emptyAssemblyChecks(),
        check_remarks: emptyAssemblyCheckRemarks(),
        assembly_date: new Date().toISOString().slice(0, 10),
      })}
      formBody={(ctx) => (
        <AssemblyInspectionSheet
          values={ctx.values}
          onChange={ctx.onChange}
          onPatch={ctx.onPatch}
          readOnly={ctx.readOnly}
        />
      )}
    />
  );
}
