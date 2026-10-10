"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  cathodeCoatingChecksApi,
  cathodeMaintenanceApi,
  cathodeRecoatingApi,
  cathodesApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Cathode, CathodeCoatingCheck, CathodeMaintenance, CathodeRecoating } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { CathodeRelations } from "@/components/domain/access-relations";
import { ElectrodeSheet, type SheetColumn } from "@/components/domain/electrode-sheet";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { LoadingState } from "@/components/ui/spinner";
import { useFieldOptions, withCombos } from "@/lib/use-field-options";

const CATHODE_COMBO_FIELDS = [
  "assembly_group",
  "manufacturer",
  "tank",
  "contact_strip",
  "electrode_support",
  "electrode_shape",
  "coating",
  "inlet_system",
  "standpipe_diameter",
  "flange_width",
  "batch",
  "generation",
];

function CathodesDetails() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  // URL ?cathode_nr= selects a record only — do not filter the list by it.
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Cathode>(
    "cathodes",
    cathodesApi,
    { limit: 10000 }
  );

  const { opts } = useFieldOptions("cathodes");
  const baseFields: FieldDef[] = [
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
  const fields = withCombos(baseFields, opts, CATHODE_COMBO_FIELDS);

  const columns: Column<Cathode>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
  ];

  return (
    <AccessWorkspace<Cathode>
      caption={t("menus.cathodeDetails")}
      helpKey="cathodes"
      backHref="/elements"
      backLabel={t("elements.title")}
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

function CathodeMaintenanceTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<CathodeMaintenance>(
    "cathode-maintenance",
    cathodeMaintenanceApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<CathodeMaintenance>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNo"), lookup: "cathode-numbers", width: "w-28" },
    { key: "date", header: t("fields.date"), kind: "date" },
    { key: "finding", header: t("fields.findings"), width: "min-w-[180px]" },
    { key: "action", header: t("fields.action"), width: "min-w-[160px]" },
    { key: "dispatch_date", header: t("fields.despatch"), kind: "date" },
    { key: "return_date", header: t("fields.sheetReturn"), kind: "date" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.cathodeMaintenance")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("cathodes")}
      showDate
      nrKey="cathode_nr"
      exportPrefix="/cathode-maintenance"
      reportHref="/maintenance-reports?kind=cathode"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function CathodeRecoatingTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<CathodeRecoating>(
    "cathode-recoating",
    cathodeRecoatingApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<CathodeRecoating>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNumber"), lookup: "cathode-numbers", width: "w-28" },
    { key: "dispatch_date", header: t("fields.shippingDate"), kind: "date" },
    { key: "return_date", header: t("fields.returnDate"), kind: "date" },
    { key: "manufacturer", header: t("fields.manufacturer"), width: "min-w-[140px]" },
    { key: "remarks", header: t("fields.remark"), width: "min-w-[180px]" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.cathodeRecoating")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("cathodes")}
      nrKey="cathode_nr"
      exportPrefix="/cathode-recoating"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function CathodeCoatingTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<CathodeCoatingCheck>(
    "cathode-coating-checks",
    cathodeCoatingChecksApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<CathodeCoatingCheck>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNumber"), lookup: "cathode-numbers", width: "w-28" },
    { key: "residual_thickness", header: t("fields.coatingThicknessPct"), kind: "number", width: "w-24" },
    { key: "potential", header: t("fields.potentialV"), kind: "number", width: "w-24" },
    { key: "inspector", header: t("fields.inspector"), width: "min-w-[120px]" },
    { key: "check_date", header: t("fields.dateOfInspection"), kind: "date" },
    { key: "remarks", header: t("fields.remark"), width: "min-w-[160px]" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.cathodeCoatingInspection")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("cathodes")}
      nrKey="cathode_nr"
      exportPrefix="/cathode-coating-checks"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function CathodesPageInner() {
  const tab = useSearchParams().get("tab");
  if (tab === "maintenance") return <CathodeMaintenanceTab />;
  if (tab === "recoating") return <CathodeRecoatingTab />;
  if (tab === "coating") return <CathodeCoatingTab />;
  return <CathodesDetails />;
}

export default function CathodesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <CathodesPageInner />
    </Suspense>
  );
}
