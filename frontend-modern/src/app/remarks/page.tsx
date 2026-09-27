"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { remarksApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Remark } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

export default function RemarksPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("remarks");
  const FIELDS: FieldDef[] = [
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "author", label: t("fields.author") },
    { name: "category", label: t("fields.category") },
    { name: "text", label: t("fields.text"), type: "textarea", span: 2, required: true },
  ];

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Remark | null>(null);
  const [showForm, setShowForm] = useState(false);

  const listParams = q ? { q, limit: 500 } : { limit: 500 };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Remark>(
    "remarks",
    remarksApi,
    listParams
  );

  const columns: Column<Remark>[] = [
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "author", header: t("fields.author") },
    { key: "category", header: t("fields.category") },
    { key: "text", header: t("fields.text") },
  ];

  function handleSubmit(values: Record<string, unknown>) {
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
    }
  }

  return (
    <div>
      <PageHeader
        title={t("remarks.title")}
        description={t("remarks.description")}
        helpKey="remarks"
        actions={
          <>
            <ExportButtons prefix="/remarks" params={listParams} filenameBase="remarks" />
            {editable && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                <Plus size={16} /> {t("remarks.newRemark")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <Input
          placeholder={t("remarks.searchPlaceholder")}
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
          keyField="id"
          isLoading={listQuery.isLoading}
          emptyTitle={t("remarks.noRemarks")}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(t("remarks.confirmDelete")) && removeMutation.mutate(row.id)}
                    >
                      <Trash2 size={14} className="text-[var(--win-danger)]" />
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t("remarks.editRemark") : t("remarks.newRemarkTitle")}>
        <ResourceForm<Remark>
          fields={FIELDS}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}
