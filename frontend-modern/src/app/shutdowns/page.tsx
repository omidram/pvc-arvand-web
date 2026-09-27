"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { shutdownsApi, shutdownCategoriesApi, shutdownCausesApi, shutdownSummaryApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Shutdown, ShutdownCategory, ShutdownCause } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LookupTable } from "@/components/domain/lookup-table";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { PowerOff, Clock, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

type T = ReturnType<typeof useI18n>["t"];

function shutdownFields(t: T): FieldDef[] {
  return [
    { name: "plant_part", label: t("fields.plantPart"), required: true },
    { name: "shutdown_time", label: t("fields.shutdownTime"), type: "datetime-local", required: true },
    { name: "startup_time", label: t("fields.startupTime"), type: "datetime-local" },
    { name: "code", label: t("fields.code") },
    { name: "category", label: t("fields.category") },
    { name: "cause", label: t("fields.cause") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
}

function categoryFields(t: T): FieldDef[] {
  return [{ name: "category", label: t("fields.category"), required: true }];
}

function causeFields(t: T): FieldDef[] {
  return [
    { name: "code", label: t("fields.code") },
    { name: "cause", label: t("fields.cause"), required: true },
    { name: "category", label: t("fields.category") },
  ];
}

function ShutdownsList() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Shutdown | null>(null);
  const [showForm, setShowForm] = useState(false);

  const summaryQuery = useQuery({ queryKey: ["shutdowns", "summary"], queryFn: shutdownSummaryApi.get });
  const listParams = q ? { q, limit: 500 } : { limit: 500 };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Shutdown>(
    "shutdowns",
    shutdownsApi,
    listParams
  );

  const columns: Column<Shutdown>[] = [
    { key: "plant_part", header: t("fields.plantPart") },
    { key: "shutdown_time", header: t("fields.shutdownTime"), render: (r) => formatDateTime(r.shutdown_time) },
    { key: "startup_time", header: t("fields.startupTime"), render: (r) => formatDateTime(r.startup_time) },
    { key: "duration_hours", header: t("fields.durationHours"), render: (r) => formatNumber(r.duration_hours) },
    { key: "category", header: t("fields.category") },
    { key: "cause", header: t("fields.cause") },
    { key: "code", header: t("fields.code") },
  ];

  function handleSubmit(values: Record<string, unknown>) {
    if (editing) {
      updateMutation.mutate({ id: editing.nr, payload: values }, { onSuccess: () => setShowForm(false) });
    } else {
      createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
    }
  }

  function handleDelete(row: Shutdown) {
    if (confirm(t("shutdowns.confirmDelete", { nr: row.nr }))) removeMutation.mutate(row.nr);
  }

  const avgDuration =
    summaryQuery.data && summaryQuery.data.total_shutdowns > 0
      ? summaryQuery.data.by_category.reduce((s, c) => s + c.total_hours, 0) / summaryQuery.data.total_shutdowns
      : null;

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("shutdowns.totalShutdowns")} value={summaryQuery.data?.total_shutdowns ?? "—"} icon={PowerOff} accent="rose" />
        <StatCard label={t("shutdowns.categoriesCount")} value={summaryQuery.data?.by_category.length ?? "—"} icon={Layers} accent="amber" />
        <StatCard label={t("shutdowns.avgDuration")} value={avgDuration ? `${avgDuration.toFixed(1)} h` : "—"} icon={Clock} accent="cyan" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Input
          placeholder={t("shutdowns.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <ExportButtons prefix="/shutdowns" params={listParams} filenameBase="shutdowns" />
          {editable && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus size={16} /> {t("shutdowns.newShutdown")}
            </Button>
          )}
        </div>
      </div>

      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField="nr"
          isLoading={listQuery.isLoading}
          emptyTitle={t("shutdowns.noShutdowns")}
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
        title={editing ? t("shutdowns.editShutdown", { nr: editing.nr }) : t("shutdowns.newShutdownTitle")}
        wide
      >
        <ResourceForm<Shutdown>
          fields={shutdownFields(t)}
          initialValues={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}

export default function ShutdownsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("shutdowns.title")} description={t("shutdowns.description")} helpKey="shutdowns" />
      <Tabs
        tabs={[
          { key: "log", label: t("shutdowns.log"), content: <ShutdownsList /> },
          {
            key: "categories",
            label: t("shutdowns.categories"),
            content: (
              <Card>
                <CardHeader>
                  <CardTitle>{t("shutdowns.categoriesTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <LookupTable<ShutdownCategory>
                    queryKey="shutdown-categories"
                    api={shutdownCategoriesApi}
                    title={t("fields.category")}
                    fields={categoryFields(t)}
                    columns={[{ key: "category", header: t("fields.category") }]}
                    formKey="shutdowns"
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            key: "causes",
            label: t("shutdowns.causes"),
            content: (
              <Card>
                <CardHeader>
                  <CardTitle>{t("shutdowns.causesTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <LookupTable<ShutdownCause>
                    queryKey="shutdown-causes"
                    api={shutdownCausesApi}
                    title={t("fields.cause")}
                    fields={causeFields(t)}
                    columns={[
                      { key: "code", header: t("fields.code") },
                      { key: "cause", header: t("fields.cause") },
                      { key: "category", header: t("fields.category") },
                    ]}
                    formKey="shutdowns"
                  />
                </CardContent>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}
