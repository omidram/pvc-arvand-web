"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { RelatedLinks } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { relationsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { mergeOptions, useFieldOptions } from "@/lib/use-field-options";

type Crud<T> = {
  listQuery: { data: T[] | undefined; isLoading: boolean; error: Error | null };
  createMutation: { mutateAsync: (v: never) => Promise<T>; isPending: boolean };
  updateMutation: { mutateAsync: (p: { id: string | number; payload: Record<string, unknown> }) => Promise<T>; isPending: boolean };
  removeMutation: { mutate: (id: string | number) => void };
};

function useSerialCombo({
  name,
  label,
  lookup,
}: {
  name: string;
  label: string;
  lookup: "anode-numbers" | "cathode-numbers" | "membrane-numbers";
}): FieldDef {
  const nums = useQuery({
    queryKey: ["relations", "lookups", lookup],
    queryFn: () => relationsApi.lookup(lookup),
    staleTime: 60_000,
  });
  return {
    name,
    label,
    required: true,
    type: "combo",
    options: mergeOptions(nums.data),
  };
}

function Commands({
  masterHref,
  masterLabel,
  reportHref,
  cartable,
}: {
  masterHref: string;
  masterLabel: string;
  reportHref?: string;
  cartable?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <Link href={masterHref} className="access-menu-btn !w-auto px-3">
        {masterLabel}
      </Link>
      {reportHref ? (
        <Link href={reportHref} className="access-menu-btn !w-auto px-3">
          {t("menus.maintenanceReport")}
        </Link>
      ) : null}
      {cartable ? (
        <Link href="/cartable" className="access-menu-btn !w-auto px-3">
          {t("nav.cartable")}
        </Link>
      ) : null}
    </>
  );
}

export function AnodeMaintenanceForm({
  crud,
  canEdit,
}: {
  crud: Crud<{ id: number; anode_nr: string | null; date: string | null; finding: string | null; action: string | null; dispatch_date: string | null; return_date: string | null }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const serial = useSerialCombo({ name: "anode_nr", label: t("fields.anodeNr"), lookup: "anode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "finding", label: t("fields.findings"), type: "textarea", span: 2 },
    { name: "action", label: t("fields.action"), type: "textarea", span: 2 },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "finding", header: t("fields.findings") },
    { key: "action", header: t("fields.action") },
    { key: "dispatch_date", header: t("fields.dispatchDate"), render: (r) => formatDate(r.dispatch_date) },
    { key: "return_date", header: t("fields.returnDate"), render: (r) => formatDate(r.return_date) },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.anodeMaintenance")}
      helpKey="anodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="anode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      exportPrefix="/anode-maintenance"
      filenameBase="anode-maintenance"
      commands={
        <Commands masterHref="/anodes" masterLabel={t("menus.anodeDetails")} reportHref="/maintenance-reports?kind=anode" />
      }
      related={(row) => <RelatedLinks anodeNr={row.anode_nr} serialNr={row.anode_nr} />}
    />
  );
}

export function CathodeMaintenanceForm({
  crud,
  canEdit,
}: {
  crud: Crud<{ id: number; cathode_nr: string | null; date: string | null; finding: string | null; action: string | null; dispatch_date: string | null; return_date: string | null }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const serial = useSerialCombo({ name: "cathode_nr", label: t("fields.cathodeNr"), lookup: "cathode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "finding", label: t("fields.findings"), type: "textarea", span: 2 },
    { name: "action", label: t("fields.action"), type: "textarea", span: 2 },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "finding", header: t("fields.findings") },
    { key: "action", header: t("fields.action") },
    { key: "dispatch_date", header: t("fields.dispatchDate"), render: (r) => formatDate(r.dispatch_date) },
    { key: "return_date", header: t("fields.returnDate"), render: (r) => formatDate(r.return_date) },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.cathodeMaintenance")}
      helpKey="cathodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="cathode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      exportPrefix="/cathode-maintenance"
      filenameBase="cathode-maintenance"
      commands={<Commands masterHref="/cathodes" masterLabel={t("menus.cathodeDetails")} reportHref="/maintenance-reports?kind=cathode" />}
      related={(row) => <RelatedLinks cathodeNr={row.cathode_nr} serialNr={row.cathode_nr} />}
    />
  );
}

export function AnodeRecoatingForm({
  crud,
  canEdit,
}: {
  crud: Crud<{
    id: number;
    anode_nr: string | null;
    coating_nr: string | null;
    dispatch_date: string | null;
    return_date: string | null;
    manufacturer: string | null;
    recoating_number: string | null;
    remarks: string | null;
    warranty_months: number | null;
    warranty_start: string | null;
    prior_service_days: number | null;
  }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const { opts } = useFieldOptions("anodes");
  const serial = useSerialCombo({ name: "anode_nr", label: t("fields.anodeNr"), lookup: "anode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "coating_nr", label: t("fields.coatingNr") },
    { name: "recoating_number", label: t("fields.recoatingNumber") },
    { name: "manufacturer", label: t("fields.manufacturer"), type: "combo", options: opts("manufacturer") },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
    { name: "warranty_months", label: t("wf.coating.warrantyMonths"), type: "number" },
    { name: "warranty_start", label: t("wf.coating.warrantyStart"), type: "date" },
    { name: "prior_service_days", label: t("fields.priorServiceDays"), type: "number", fieldReadOnly: true },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "coating_nr", header: t("fields.coatingNr") },
    { key: "recoating_number", header: t("fields.recoatingNumber") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "dispatch_date", header: t("fields.dispatchDate"), render: (r) => formatDate(r.dispatch_date) },
    { key: "return_date", header: t("fields.returnDate"), render: (r) => formatDate(r.return_date) },
    { key: "warranty_months", header: t("wf.coating.warrantyMonths") },
    { key: "prior_service_days", header: t("fields.priorServiceDays") },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.anodeRecoating")}
      helpKey="anodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="anode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      exportPrefix="/anode-recoating"
      filenameBase="anode-recoating"
      commands={<Commands masterHref="/anodes" masterLabel={t("menus.anodeDetails")} cartable />}
      related={(row) => <RelatedLinks anodeNr={row.anode_nr} serialNr={row.anode_nr} />}
    />
  );
}

export function CathodeRecoatingForm({
  crud,
  canEdit,
}: {
  crud: Crud<{
    id: number;
    cathode_nr: string | null;
    dispatch_date: string | null;
    return_date: string | null;
    manufacturer: string | null;
    remarks: string | null;
    warranty_months: number | null;
    warranty_start: string | null;
    prior_service_days: number | null;
  }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const { opts } = useFieldOptions("cathodes");
  const serial = useSerialCombo({ name: "cathode_nr", label: t("fields.cathodeNr"), lookup: "cathode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "manufacturer", label: t("fields.manufacturer"), type: "combo", options: opts("manufacturer") },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
    { name: "warranty_months", label: t("wf.coating.warrantyMonths"), type: "number" },
    { name: "warranty_start", label: t("wf.coating.warrantyStart"), type: "date" },
    { name: "prior_service_days", label: t("fields.priorServiceDays"), type: "number", fieldReadOnly: true },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "dispatch_date", header: t("fields.dispatchDate"), render: (r) => formatDate(r.dispatch_date) },
    { key: "return_date", header: t("fields.returnDate"), render: (r) => formatDate(r.return_date) },
    { key: "warranty_months", header: t("wf.coating.warrantyMonths") },
    { key: "prior_service_days", header: t("fields.priorServiceDays") },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.cathodeRecoating")}
      helpKey="cathodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="cathode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      exportPrefix="/cathode-recoating"
      filenameBase="cathode-recoating"
      commands={<Commands masterHref="/cathodes" masterLabel={t("menus.cathodeDetails")} cartable />}
      related={(row) => <RelatedLinks cathodeNr={row.cathode_nr} serialNr={row.cathode_nr} />}
    />
  );
}

export function AnodeCoatingCheckForm({
  crud,
  canEdit,
}: {
  crud: Crud<{
    id: number;
    anode_nr: string | null;
    coating_nr: string | null;
    dol_days: number | null;
    check_date: string | null;
    inspector: string | null;
    residual_thickness: number | null;
    potential: number | null;
    remarks: string | null;
  }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const serial = useSerialCombo({ name: "anode_nr", label: t("fields.anodeNr"), lookup: "anode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "coating_nr", label: t("fields.coatingNr") },
    { name: "check_date", label: t("fields.checkDate"), type: "date" },
    { name: "inspector", label: t("fields.inspector") },
    { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
    { name: "potential", label: t("fields.potential"), type: "number", step: "0.01" },
    { name: "dol_days", label: t("fields.dolDays"), type: "number", fieldReadOnly: true },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "coating_nr", header: t("fields.coatingNr") },
    { key: "check_date", header: t("fields.date"), render: (r) => formatDate(r.check_date) },
    { key: "inspector", header: t("fields.inspector") },
    { key: "residual_thickness", header: t("fields.residualThickness") },
    { key: "potential", header: t("fields.potential") },
    { key: "dol_days", header: t("fields.dolDays") },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.checkAnodeCoating")}
      helpKey="anodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="anode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      preferView="form"
      exportPrefix="/anode-coating-checks"
      filenameBase="anode-coating-checks"
      commands={<Commands masterHref="/anodes" masterLabel={t("menus.anodeDetails")} cartable />}
      related={(row) => <RelatedLinks anodeNr={row.anode_nr} serialNr={row.anode_nr} />}
    />
  );
}

export function CathodeCoatingCheckForm({
  crud,
  canEdit,
}: {
  crud: Crud<{
    id: number;
    cathode_nr: string | null;
    check_date: string | null;
    inspector: string | null;
    residual_thickness: number | null;
    potential: number | null;
    remarks: string | null;
  }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const serial = useSerialCombo({ name: "cathode_nr", label: t("fields.cathodeNr"), lookup: "cathode-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "check_date", label: t("fields.checkDate"), type: "date" },
    { name: "inspector", label: t("fields.inspector") },
    { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
    { name: "potential", label: t("fields.potential"), type: "number", step: "0.01" },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "check_date", header: t("fields.date"), render: (r) => formatDate(r.check_date) },
    { key: "inspector", header: t("fields.inspector") },
    { key: "residual_thickness", header: t("fields.residualThickness") },
    { key: "potential", header: t("fields.potential") },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.checkCathodeCoating")}
      helpKey="cathodes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="cathode_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      preferView="form"
      exportPrefix="/cathode-coating-checks"
      filenameBase="cathode-coating-checks"
      commands={<Commands masterHref="/cathodes" masterLabel={t("menus.cathodeDetails")} cartable />}
      related={(row) => <RelatedLinks cathodeNr={row.cathode_nr} serialNr={row.cathode_nr} />}
    />
  );
}

export function MembraneMaintenanceForm({
  crud,
  canEdit,
}: {
  crud: Crud<{ id: number; membrane_nr: string | null; date: string | null; repair_work: string | null }>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const serial = useSerialCombo({ name: "membrane_nr", label: t("fields.membraneNr"), lookup: "membrane-numbers" });
  const fields: FieldDef[] = [
    serial,
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "repair_work", label: t("fields.repairWork"), type: "textarea", span: 2 },
  ];
  const columns: Column<(typeof crud.listQuery.data extends (infer R)[] | undefined ? R : never)>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "repair_work", header: t("fields.repairWork") },
  ];
  return (
    <AccessWorkspace
      caption={t("menus.membraneMaintenance")}
      helpKey="membranes"
      backHref="/elements"
      backLabel={t("elements.title")}
      records={crud.listQuery.data}
      isLoading={crud.listQuery.isLoading}
      error={crud.listQuery.error}
      fields={fields}
      columns={columns}
      idField="id"
      recordParam="membrane_nr"
      canEdit={canEdit}
      onSave={(id, values) => crud.updateMutation.mutateAsync({ id, payload: values })}
      onCreate={(values) => crud.createMutation.mutateAsync(values as never)}
      onDelete={(id) => crud.removeMutation.mutate(id)}
      confirmDelete={() => t("common.confirmDeleteGeneric")}
      submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
      exportPrefix="/membrane-maintenance"
      filenameBase="membrane-maintenance"
      commands={<Commands masterHref="/membranes" masterLabel={t("menus.membraneDetails")} reportHref="/maintenance-reports?kind=membrane" />}
      related={(row) => <RelatedLinks membraneNr={row.membrane_nr} />}
    />
  );
}
