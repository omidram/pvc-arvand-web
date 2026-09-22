"use client";

import { membranesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Membrane } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { MembraneRelations } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";

export default function MembranesPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Membrane>(
    "membranes",
    membranesApi,
    { limit: 500 }
  );

  const fields: FieldDef[] = [
    { name: "membrane_nr", label: t("fields.membraneNr"), required: true },
    { name: "membrane_type", label: t("fields.membraneType") },
    { name: "received_date", label: t("fields.receivedDate"), type: "date" },
    { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
    { name: "batch", label: t("fields.batch") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.type") },
    { key: "batch", header: t("fields.batch") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
  ];

  return (
    <AccessWorkspace<Membrane>
      caption="Membrane Details"
      helpKey="membranes"
      backHref="/elements"
      backLabel="Element Administration"
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
