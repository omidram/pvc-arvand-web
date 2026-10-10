"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  anodeCoatingChecksApi,
  anodeMaintenanceApi,
  anodeRecoatingApi,
  anodesApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Anode, AnodeCoatingCheck, AnodeMaintenance, AnodeRecoating } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { AnodeRelations } from "@/components/domain/access-relations";
import { ElectrodeSheet, type SheetColumn } from "@/components/domain/electrode-sheet";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { LoadingState } from "@/components/ui/spinner";
import { useFieldOptions, withCombos } from "@/lib/use-field-options";

const ANODE_COMBO_FIELDS = [
  "assembly_group",
  "manufacturer",
  "tank",
  "contact_strip",
  "electrode_support",
  "electrode_shape",
  "coating",
  "baffle_plate",
  "downcomer",
  "inlet_system",
  "standpipe_diameter",
  "flange_width",
  "batch",
  "generation",
];

function AnodesDetails() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  // URL ?anode_nr= is only for selecting/opening a record (AccessWorkspace).
  // Never pass it as list `q` — that collapses the datasheet to one row on click.
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Anode>(
    "anodes",
    anodesApi,
    { limit: 10000 }
  );

  const { opts } = useFieldOptions("anodes");
  const baseFields: FieldDef[] = [
    { name: "anode_nr", label: t("fields.anodeNr"), required: true },
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
    { name: "baffle_plate", label: t("fields.bafflePlate") },
    { name: "downcomer", label: t("fields.downcomer") },
    { name: "inlet_system", label: t("fields.inletSystem") },
    { name: "standpipe_diameter", label: t("fields.standpipeDiameter") },
    { name: "flange_width", label: t("fields.flangeWidth") },
    { name: "received_date", label: t("fields.receivedDate"), type: "date" },
    { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
    { name: "batch", label: t("fields.batch") },
    { name: "generation", label: t("fields.generation") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const fields = withCombos(baseFields, opts, ANODE_COMBO_FIELDS);

  const columns: Column<Anode>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "generation", header: t("fields.generation") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
  ];

  return (
    <AccessWorkspace<Anode>
      caption={t("menus.anodeDetails")}
      helpKey="anodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      fields={fields}
      columns={columns}
      idField="anode_nr"
      canEdit={canEdit("anodes")}
      onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
      onCreate={(values) => createMutation.mutate(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("anodes.confirmDelete", { nr: row.anode_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/anodes"
      filenameBase="anodes"
      related={(row) => <AnodeRelations anodeNr={row.anode_nr} />}
    />
  );
}

function AnodeMaintenanceTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<AnodeMaintenance>(
    "anode-maintenance",
    anodeMaintenanceApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<AnodeMaintenance>[] = [
    { key: "anode_nr", header: t("fields.anodeNo"), lookup: "anode-numbers", width: "w-28" },
    { key: "date", header: t("fields.date"), kind: "date" },
    { key: "finding", header: t("fields.findings"), width: "min-w-[180px]" },
    { key: "action", header: t("fields.action"), width: "min-w-[160px]" },
    { key: "dispatch_date", header: t("fields.despatch"), kind: "date" },
    { key: "return_date", header: t("fields.sheetReturn"), kind: "date" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.anodeMaintenance")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("anodes")}
      showDate
      nrKey="anode_nr"
      exportPrefix="/anode-maintenance"
      reportHref="/maintenance-reports?kind=anode"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function AnodeRecoatingTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<AnodeRecoating>(
    "anode-recoating",
    anodeRecoatingApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<AnodeRecoating>[] = [
    { key: "anode_nr", header: t("fields.anodeNo"), lookup: "anode-numbers", width: "w-28" },
    { key: "dispatch_date", header: t("fields.shippingDate"), kind: "date" },
    { key: "return_date", header: t("fields.returnDate"), kind: "date" },
    { key: "manufacturer", header: t("fields.manufacturer"), width: "min-w-[140px]" },
    { key: "remarks", header: t("fields.remark"), width: "min-w-[180px]" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.anodeRecoating")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("anodes")}
      showDate
      nrKey="anode_nr"
      exportPrefix="/anode-recoating"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function AnodeCoatingTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const { listQuery, createMutation, updateMutation } = useCrudResource<AnodeCoatingCheck>(
    "anode-coating-checks",
    anodeCoatingChecksApi,
    { limit: 2000 }
  );
  const columns: SheetColumn<AnodeCoatingCheck>[] = [
    { key: "anode_nr", header: t("fields.anodeNumber"), lookup: "anode-numbers", width: "w-28" },
    { key: "residual_thickness", header: t("fields.coatingThicknessPct"), kind: "number", width: "w-24" },
    { key: "potential", header: t("fields.potentialV"), kind: "number", width: "w-24" },
    { key: "inspector", header: t("fields.inspector"), width: "min-w-[120px]" },
    { key: "check_date", header: t("fields.dateOfInspection"), kind: "date" },
    { key: "remarks", header: t("fields.remark"), width: "min-w-[160px]" },
  ];
  return (
    <ElectrodeSheet
      title={t("menus.anodeCoatingInspection")}
      rows={listQuery.data}
      isLoading={listQuery.isLoading}
      error={listQuery.error as Error | null}
      columns={columns}
      canEdit={canEdit("anodes")}
      nrKey="anode_nr"
      exportPrefix="/anode-coating-checks"
      onCreate={(payload) => createMutation.mutate(payload)}
      onUpdate={(row, payload) => updateMutation.mutate({ id: row.id, payload })}
    />
  );
}

function AnodesPageInner() {
  const tab = useSearchParams().get("tab");
  if (tab === "maintenance") return <AnodeMaintenanceTab />;
  if (tab === "recoating") return <AnodeRecoatingTab />;
  if (tab === "coating") return <AnodeCoatingTab />;
  return <AnodesDetails />;
}

export default function AnodesPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AnodesPageInner />
    </Suspense>
  );
}
