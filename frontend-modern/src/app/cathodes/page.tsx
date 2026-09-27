"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  cathodesApi,
  cathodeMaintenanceApi,
  cathodeRecoatingApi,
  cathodeCoatingChecksApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Cathode, CathodeCoatingCheck, CathodeMaintenance, CathodeRecoating } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { SubResourcePanel } from "@/components/domain/sub-resource-panel";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

type T = ReturnType<typeof useI18n>["t"];

function cathodeFields(t: T): FieldDef[] {
  return [
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
}

function maintenanceFields(t: T): FieldDef[] {
  return [
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "finding", label: t("fields.finding"), type: "textarea", span: 2 },
    { name: "action", label: t("fields.action"), type: "textarea", span: 2 },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
  ];
}

function recoatingFields(t: T): FieldDef[] {
  return [
    { name: "manufacturer", label: t("fields.manufacturer") },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
}

function coatingCheckFields(t: T): FieldDef[] {
  return [
    { name: "check_date", label: t("fields.checkDate"), type: "date" },
    { name: "inspector", label: t("fields.inspector") },
    { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
    { name: "potential", label: t("fields.potential"), type: "number", step: "0.01" },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
}

export default function CathodesPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("cathodes");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Cathode | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Cathode | null>(null);

  const listParams = q ? { q, limit: 500 } : { limit: 500 };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Cathode>(
    "cathodes",
    cathodesApi,
    listParams
  );

  const columns: Column<Cathode>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer") },
    { key: "coating", header: t("fields.coating") },
    { key: "batch", header: t("fields.batch") },
    { key: "generation", header: t("fields.generation") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
  ];

  function handleSubmit(values: Record<string, unknown>) {
    if (editing) {
      updateMutation.mutate({ id: editing.cathode_nr, payload: values }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
    }
  }

  function handleDelete(row: Cathode) {
    if (confirm(t("cathodes.confirmDelete", { nr: row.cathode_nr }))) removeMutation.mutate(row.cathode_nr);
  }

  return (
    <div>
      <PageHeader
        title={t("cathodes.title")}
        description={t("cathodes.description")}
        helpKey="cathodes"
        actions={
          <>
            <ExportButtons prefix="/cathodes" params={listParams} filenameBase="cathodes" />
            {editable && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus size={16} /> {t("cathodes.newCathode")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Input
          placeholder={t("cathodes.searchPlaceholder")}
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
          keyField="cathode_nr"
          isLoading={listQuery.isLoading}
          onRowClick={(row) => setDetail(row)}
          emptyTitle={t("cathodes.noCathodesFound")}
          actions={
            editable
              ? (row) => (
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
                )
              : undefined
          }
        />
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("cathodes.editCathode", { nr: editing.cathode_nr }) : t("cathodes.newCathodeTitle")}
        wide
      >
        <ResourceForm<Cathode>
          fields={cathodeFields(t)}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      {detail && (
        <Modal open onClose={() => setDetail(null)} title={t("cathodes.historyTitle", { nr: detail.cathode_nr })} wide>
          <Tabs
            tabs={[
              {
                key: "maintenance",
                label: t("componentTabs.maintenance"),
                content: (
                  <SubResourcePanel<CathodeMaintenance>
                    queryKey="cathode-maintenance"
                    api={cathodeMaintenanceApi}
                    parentField="cathode_nr"
                    parentValue={detail.cathode_nr}
                    keyField="id"
                    title={t("componentTabs.maintenance")}
                    fields={maintenanceFields(t)}
                    formKey="cathodes"
                    columns={[
                      { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
                      { key: "finding", header: t("fields.finding") },
                      { key: "action", header: t("fields.action") },
                      { key: "dispatch_date", header: t("fields.dispatched"), render: (r) => formatDate(r.dispatch_date) },
                      { key: "return_date", header: t("fields.returned"), render: (r) => formatDate(r.return_date) },
                    ]}
                  />
                ),
              },
              {
                key: "recoating",
                label: t("componentTabs.recoating"),
                content: (
                  <SubResourcePanel<CathodeRecoating>
                    queryKey="cathode-recoating"
                    api={cathodeRecoatingApi}
                    parentField="cathode_nr"
                    parentValue={detail.cathode_nr}
                    keyField="id"
                    title={t("componentTabs.recoating")}
                    fields={recoatingFields(t)}
                    formKey="cathodes"
                    columns={[
                      { key: "manufacturer", header: t("fields.manufacturer") },
                      { key: "dispatch_date", header: t("fields.dispatched"), render: (r) => formatDate(r.dispatch_date) },
                      { key: "return_date", header: t("fields.returned"), render: (r) => formatDate(r.return_date) },
                    ]}
                  />
                ),
              },
              {
                key: "coating-checks",
                label: t("componentTabs.coatingChecks"),
                content: (
                  <SubResourcePanel<CathodeCoatingCheck>
                    queryKey="cathode-coating-checks"
                    api={cathodeCoatingChecksApi}
                    parentField="cathode_nr"
                    parentValue={detail.cathode_nr}
                    keyField="id"
                    title={t("componentTabs.coatingChecks")}
                    fields={coatingCheckFields(t)}
                    formKey="cathodes"
                    columns={[
                      { key: "check_date", header: t("fields.date"), render: (r) => formatDate(r.check_date) },
                      { key: "inspector", header: t("fields.inspector") },
                      { key: "residual_thickness", header: t("fields.residualThickness") },
                      { key: "potential", header: t("fields.potential") },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
