"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { membranesApi, membraneMaintenanceApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Membrane, MembraneMaintenance } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { SubResourcePanel } from "@/components/domain/sub-resource-panel";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

type T = ReturnType<typeof useI18n>["t"];

function membraneFields(t: T): FieldDef[] {
  return [
    { name: "membrane_nr", label: t("fields.membraneNr"), required: true },
    { name: "membrane_type", label: t("fields.membraneType") },
    { name: "received_date", label: t("fields.receivedDate"), type: "date" },
    { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
    { name: "batch", label: t("fields.batch") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
}

function maintenanceFields(t: T): FieldDef[] {
  return [
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "repair_work", label: t("fields.repairWork"), type: "textarea", span: 2 },
  ];
}

export default function MembranesPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("membranes");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Membrane | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Membrane | null>(null);

  const listParams = q ? { q, limit: 500 } : { limit: 500 };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Membrane>(
    "membranes",
    membranesApi,
    listParams
  );

  const columns: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.type") },
    { key: "batch", header: t("fields.batch") },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "decommission_date", header: t("fields.decommissioned"), render: (r) => formatDate(r.decommission_date) },
  ];

  function handleSubmit(values: Record<string, unknown>) {
    if (editing) {
      updateMutation.mutate({ id: editing.membrane_nr, payload: values }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
    }
  }

  function handleDelete(row: Membrane) {
    if (confirm(t("membranes.confirmDelete", { nr: row.membrane_nr }))) removeMutation.mutate(row.membrane_nr);
  }

  return (
    <div>
      <PageHeader
        title={t("membranes.title")}
        description={t("membranes.description")}
        helpKey="membranes"
        actions={
          <>
            <ExportButtons prefix="/membranes" params={listParams} filenameBase="membranes" />
            {editable && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus size={16} /> {t("membranes.newMembrane")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Input
          placeholder={t("membranes.searchPlaceholder")}
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
          keyField="membrane_nr"
          isLoading={listQuery.isLoading}
          onRowClick={(row) => setDetail(row)}
          emptyTitle={t("membranes.noMembranesFound")}
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
        title={editing ? t("membranes.editMembrane", { nr: editing.membrane_nr }) : t("membranes.newMembraneTitle")}
      >
        <ResourceForm<Membrane>
          fields={membraneFields(t)}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      {detail && (
        <Modal open onClose={() => setDetail(null)} title={t("membranes.maintenanceTitle", { nr: detail.membrane_nr })} wide>
          <SubResourcePanel<MembraneMaintenance>
            queryKey="membrane-maintenance"
            api={membraneMaintenanceApi}
            parentField="membrane_nr"
            parentValue={detail.membrane_nr}
            keyField="id"
            title={t("componentTabs.maintenance")}
            fields={maintenanceFields(t)}
            formKey="membranes"
            columns={[
              { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
              { key: "repair_work", header: t("fields.repairWork") },
            ]}
          />
        </Modal>
      )}
    </div>
  );
}
