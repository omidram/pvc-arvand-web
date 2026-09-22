"use client";

import { cathodesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Cathode } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { CathodeRelations } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";

export default function CathodesPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Cathode>(
    "cathodes",
    cathodesApi,
    { limit: 500 }
  );

  const fields: FieldDef[] = [
    { name: "cathode_nr", label: t("fields.cathodeNr"), required: true },
    { name: "assembly_group", label: t("fields.assemblyGroup") },
    { name: "component_nr", label: t("fields.componentNr") },
    { name: "customer_drawing_nr", label: t("fields.customerDrawingNr") },
    { name: "manufacturer", label: t("fields.manufacturer") },
    { name: "manufacturer_order_nr", label: t("fields.manufacturerOrderNr") },
    { name: "manufacturer_drawing_nr", label: t("fields.manufacturerDrawingNr") },
    { name: "manufacturer_date", label: t("fields.manufacturerDate"), type: "date" },
    { name: "tank", label: t("fields.tank") },
    { name: "contact_strip", label: t("fields.contactStrip") },
    { name: "electrode_support", label: t("fields.electrodeSupport") },
    { name: "electrode_shape", label: t("fields.electrodeShape") },
    { name: "coating", label: t("fields.coating") },
    { name: "inlet_system", label: t("fields.inletSystem") },
    { name: "standpipe_diameter", label: t("fields.standpipeDiameter") },
    { name: "flange_width", label: t("fields.flangeWidth") },
    { name: "received_date", label: t("fields.receivedDate"), type: "date" },
    { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
    { name: "batch", label: t("fields.batch") },
    { name: "generation", label: t("fields.generation") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<Cathode>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
  ];

  return (
    <AccessWorkspace<Cathode>
      caption="Cathode Details"
      helpKey="cathodes"
      backHref="/elements"
      backLabel="Element Administration"
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="cathode_nr"
      canEdit={canEdit("cathodes")}
      onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
      onCreate={(values) => createMutation.mutate(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("cathodes.confirmDelete", { nr: row.cathode_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/cathodes"
      filenameBase="cathodes"
      related={(row) => <CathodeRelations cathodeNr={row.cathode_nr} />}
    />
  );
}
