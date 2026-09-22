"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCrudResource } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "./export-buttons";

interface CrudApi<TRead, TWrite> {
  list: (params?: Record<string, unknown>) => Promise<TRead[]>;
  create: (payload: TWrite) => Promise<TRead>;
  update: (id: string | number, payload: TWrite) => Promise<TRead>;
  remove: (id: string | number) => Promise<void>;
}

/** Generic list+CRUD panel for records scoped to a parent (e.g. anode maintenance for a given anode_nr). */
export function SubResourcePanel<TRow extends object>({
  queryKey,
  api,
  parentField,
  parentValue,
  columns,
  fields,
  keyField,
  title,
  formKey,
}: {
  queryKey: string;
  api: CrudApi<TRow, Partial<TRow>>;
  parentField: string;
  parentValue: string;
  columns: Column<TRow>[];
  fields: FieldDef[];
  keyField: keyof TRow;
  title: string;
  formKey: string;
}) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit(formKey);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TRow | null>(null);

  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<TRow>(
    `${queryKey}:${parentValue}`,
    api,
    { q: parentValue, limit: 200 }
  );

  const rows = (listQuery.data || []).filter((r) => (r as Record<string, unknown>)[parentField] === parentValue);

  function handleSubmit(values: Record<string, unknown>) {
    const payload = { ...values, [parentField]: parentValue } as Partial<TRow>;
    if (editing) {
      const id = (editing as Record<string, unknown>)[keyField as string] as string | number;
      updateMutation.mutate({ id, payload }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(payload, { onSuccess: () => setShowForm(false) });
    }
  }

  function handleDelete(row: TRow) {
    if (confirm(t("common.confirmDeleteGeneric"))) {
      const id = (row as Record<string, unknown>)[keyField as string] as string | number;
      removeMutation.mutate(id);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-bold text-[var(--win-navy)]">{title}</h4>
        <div className="flex items-center gap-2">
          <ExportButtons prefix={`/${queryKey}`} params={{ q: parentValue }} filenameBase={`${queryKey}-${parentValue}`} />
          {editable && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus size={14} /> {t("common.add")}
            </Button>
          )}
        </div>
      </div>
      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          keyField={keyField}
          isLoading={listQuery.isLoading}
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
                      <Pencil size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                      <Trash2 size={13} className="text-[var(--win-danger)]" />
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
        title={editing ? t("common.editItem", { item: title }) : t("common.addNew", { item: title })}
      >
        <ResourceForm<TRow>
          fields={fields}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
