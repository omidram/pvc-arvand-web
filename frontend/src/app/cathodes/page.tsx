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
import Link from "next/link";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { CathodeRelations } from "@/components/domain/access-relations";
import {
  CathodeCoatingCheckForm,
  CathodeMaintenanceForm,
  CathodeRecoatingForm,
} from "@/components/domain/electrode-subforms";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { LoadingState } from "@/components/ui/spinner";
import { useFieldOptions, withCombos } from "@/lib/use-field-options";
import { CATHODE_REQUIRED, requiredError, withRequired } from "@/lib/required-fields";

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
  const fields = withRequired(withCombos(baseFields, opts, CATHODE_COMBO_FIELDS), CATHODE_REQUIRED);

  const columns: Column<Cathode>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "generation", header: t("fields.generation") },
    { key: "assembly_group", header: t("fields.assemblyGroup") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
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
      validate={(values, { isNew }) => (isNew ? requiredError(values, fields, CATHODE_REQUIRED, t) : null)}
      idField="cathode_nr"
      canEdit={canEdit("cathodes")}
      onSave={(id, values) => updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => createMutation.mutateAsync(values as never)}
      onDelete={(id) => removeMutation.mutate(id)}
      confirmDelete={(row) => t("cathodes.confirmDelete", { nr: row.cathode_nr })}
      submitting={createMutation.isPending || updateMutation.isPending}
      exportPrefix="/cathodes"
      filenameBase="cathodes"
      commands={
        <>
          <Link href="/cathodes?tab=maintenance" className="access-menu-btn !w-auto px-3">
            {t("menus.cathodeMaintenance")}
          </Link>
          <Link href="/cathodes?tab=recoating" className="access-menu-btn !w-auto px-3">
            {t("menus.cathodeRecoating")}
          </Link>
          <Link href="/cathodes?tab=coating" className="access-menu-btn !w-auto px-3">
            {t("menus.checkCathodeCoating")}
          </Link>
          <Link href="/maintenance-reports?kind=cathode" className="access-menu-btn !w-auto px-3">
            {t("menus.cathodeMaintenanceReport")}
          </Link>
        </>
      }
      related={(row) => <CathodeRelations cathodeNr={row.cathode_nr} />}
    />
  );
}

function CathodeMaintenanceTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<CathodeMaintenance>("cathode-maintenance", cathodeMaintenanceApi, { limit: 20000 });
  return <CathodeMaintenanceForm crud={crud} canEdit={canEdit("cathodes")} />;
}

function CathodeRecoatingTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<CathodeRecoating>("cathode-recoating", cathodeRecoatingApi, { limit: 20000 });
  return <CathodeRecoatingForm crud={crud} canEdit={canEdit("cathodes")} />;
}

function CathodeCoatingTab() {
  const { canEdit } = useAuth();
  const crud = useCrudResource<CathodeCoatingCheck>("cathode-coating-checks", cathodeCoatingChecksApi, { limit: 20000 });
  return <CathodeCoatingCheckForm crud={crud} canEdit={canEdit("cathodes")} />;
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
