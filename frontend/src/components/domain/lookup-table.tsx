"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCrudResource } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "./export-buttons";

interface CrudApi<T> {
  list: (p?: Record<string, unknown>) => Promise<T[]>;
  create: (p: Partial<T>) => Promise<T>;
  update: (id: string | number, p: Partial<T>) => Promise<T>;
  remove: (id: string | number) => Promise<void>;
}

/** Generic small lookup table with inline add/edit/delete, for simple reference entities. */
export function LookupTable<T extends object>({
  queryKey,
  api,
  columns,
  fields,
  title,
  keyField = "id",
  formKey = "settings",
}: {
  queryKey: string;
  api: CrudApi<T>;
  columns: Column<T>[];
  fields: FieldDef[];
  title: string;
  keyField?: string;
  formKey?: string;
}) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit(formKey);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<T>(queryKey, api, {
    limit: 500,
  });

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <ExportButtons prefix={`/${queryKey}`} filenameBase={queryKey} />
        {editable && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus size={14} /> {t("common.addNew", { item: title })}
          </Button>
        )}
      </div>
      {listQuery.isLoading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField={keyField as keyof T}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const id = (row as Record<string, unknown>)[keyField] as string | number;
                        if (confirm(t("common.confirmDeleteNamed", { item: title }))) removeMutation.mutate(id);
                      }}
                    >
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
        title={editing ? t("common.editItem", { item: title }) : t("common.newItem", { item: title })}
      >
        <ResourceForm<T>
          fields={fields}
          initialValues={editing ?? undefined}
          onSubmit={(values) => {
            if (editing) {
              const id = (editing as Record<string, unknown>)[keyField] as string | number;
              updateMutation.mutate(
                { id, payload: values as Partial<T> },
                { onSuccess: () => setShowForm(false) }
              );
            } else {
              createMutation.mutate(values as Partial<T>, { onSuccess: () => setShowForm(false) });
            }
          }}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
