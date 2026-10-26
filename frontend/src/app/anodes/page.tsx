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
import Link from "next/link";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { AnodeRelations } from "@/components/domain/access-relations";
import {
  AnodeCoatingCheckForm,
  AnodeMaintenanceForm,
  AnodeRecoatingForm,
} from "@/components/domain/electrode-subforms";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { LoadingState } from "@/components/ui/spinner";
import { useFieldOptions, withCombos } from "@/lib/use-field-options";
import { ANODE_REQUIRED, requiredError, withRequired } from "@/lib/required-fields";

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
  const fields = withRequired(withCombos(baseFields, opts, ANODE_COMBO_FIELDS), ANODE_REQUIRED);

  const columns: Column<Anode>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "generation", header: t("fields.generation") },
    { key: "assembly_group", header: t("fields.assemblyGroup") },
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
      validate={(values, { isNew }) => (isNew ? requiredError(values, fields, ANODE_REQUIRED, t) : null)}
      idField="anode_nr"
      canEdit={canEdit("anodes")}
      onSave={(id, values) => updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => createMutation.mutateAsync(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("anodes.confirmDelete", { nr: row.anode_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/anodes"
      filenameBase="anodes"
      commands={
        <>
          <Link href="/anodes?tab=maintenance" className="access-menu-btn !w-auto px-3">
            {t("menus.anodeMaintenance")}
          </Link>
          <Link href="/anodes?tab=recoating" className="access-menu-btn !w-auto px-3">
            {t("menus.anodeRecoating")}
          </Link>
          <Link href="/anodes?tab=coating" className="access-menu-btn !w-auto px-3">
            {t("menus.checkAnodeCoating")}
          </Link>
          <Link href="/maintenance-reports?kind=anode" className="access-menu-btn !w-auto px-3">
            {t("menus.anodeMaintenanceReport")}
          </Link>
        </>
      }
      related={(row) => <AnodeRelations anodeNr={row.anode_nr} />}
    />
  );
}

function AnodeMaintenanceTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<AnodeMaintenance>("anode-maintenance", anodeMaintenanceApi, { limit: 20000 });
  return <AnodeMaintenanceForm crud={crud} canEdit={canEdit("anodes")} />;
}

function AnodeRecoatingTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<AnodeRecoating>("anode-recoating", anodeRecoatingApi, { limit: 20000 });
  return <AnodeRecoatingForm crud={crud} canEdit={canEdit("anodes")} />;
}

function AnodeCoatingTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<AnodeCoatingCheck>("anode-coating-checks", anodeCoatingChecksApi, { limit: 20000 });
  return <AnodeCoatingCheckForm crud={crud} canEdit={canEdit("anodes")} />;
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
