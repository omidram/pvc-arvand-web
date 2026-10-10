"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { membraneMaintenanceApi, membranesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Membrane, MembraneMaintenance } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { MembraneRelations } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { LoadingState } from "@/components/ui/spinner";
import { useFieldOptions, withCombos } from "@/lib/use-field-options";

function MembranesDetails() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  // URL ?membrane_nr= selects a record only — do not filter the list by it.
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Membrane>(
    "membranes",
    membranesApi,
    { limit: 10000 }
  );

  const { opts } = useFieldOptions("membranes");
  const baseFields: FieldDef[] = [
    { name: "membrane_nr", label: t("fields.membraneNr"), required: true },
    { name: "membrane_type", label: t("fields.membraneType") },
    { name: "received_date", label: t("fields.receivedDate"), type: "date" },
    { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
    { name: "batch", label: t("fields.batch") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const fields = withCombos(baseFields, opts, ["membrane_type", "batch"]);

  const columns: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.type") },
    { key: "batch", header: t("fields.batch") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
  ];

  return (
    <AccessWorkspace<Membrane>
      caption={t("menus.membraneDetails")}
      helpKey="membranes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="membrane_nr"
      canEdit={canEdit("membranes")}
      onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
      onCreate={(values) => createMutation.mutate(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("membranes.confirmDelete", { nr: row.membrane_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/membranes"
      filenameBase="membranes"
      related={(row) => <MembraneRelations membraneNr={row.membrane_nr} />}
    />
  );
}

function MembraneMaintenanceTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<MembraneMaintenance>(
    "membrane-maintenance",
    membraneMaintenanceApi,
    { limit: 2000 }
  );
  const fields: FieldDef[] = [
    { name: "membrane_nr", label: t("fields.membraneNr"), required: true },
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "repair_work", label: t("fields.repairWork"), type: "textarea", span: 2 },
  ];
  const columns: Column<MembraneMaintenance>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "repair_work", header: t("fields.repairWork") },
  ];
  return (
    <AccessWorkspace<MembraneMaintenance>
      caption={t("menus.membraneMaintenance")}
      helpKey="membranes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="id"
      canEdit={canEdit("membranes")}
      onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
      onCreate={(values) => createMutation.mutate(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/membrane-maintenance"
      filenameBase="membrane-maintenance"
      commands={
        <Link href="/maintenance-reports?kind=membrane" className="access-menu-btn">
          {t("menus.maintenanceReport")}
        </Link>
      }
    />
  );
}

function MembranesPageInner() {
  const tab = useSearchParams().get("tab");
  if (tab === "maintenance") return <MembraneMaintenanceTab />;
  return <MembranesDetails />;
}

export default function MembranesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MembranesPageInner />
    </Suspense>
  );
}
