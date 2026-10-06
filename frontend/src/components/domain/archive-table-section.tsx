"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { dbTablesApi, type DbArchiveTable } from "@/lib/endpoints";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ExportButtons } from "./export-buttons";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { humanizeKey } from "@/lib/utils";
import { appAlert, appConfirm } from "@/lib/dialog";

type Row = Record<string, unknown> & { _id: number };

function rowId(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const value = row._id;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ArchiveTableSection({ table }: { table: DbArchiveTable }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const editable = canEdit(table.form_key);
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [column, setColumn] = useState("");
  const [columnValue, setColumnValue] = useState("");
  const [appliedColumn, setAppliedColumn] = useState("");
  const [appliedValue, setAppliedValue] = useState("");

  const params = {
    q: query || undefined,
    column: appliedColumn || undefined,
    value: appliedValue || undefined,
    limit: 200,
  };

  const rowsQuery = useQuery({
    queryKey: ["db-table-rows", table.slug, params],
    queryFn: () => dbTablesApi.rows(table.slug, params),
    enabled: open,
    staleTime: 30_000,
  });

  function invalidateTable() {
    queryClient.invalidateQueries({ queryKey: ["db-table-rows", table.slug] });
    queryClient.invalidateQueries({ queryKey: ["db-tables"] });
  }

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => dbTablesApi.createRow(table.slug, values),
    onSuccess: () => {
      invalidateTable();
      setFormMode(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (selectedId == null) throw new Error(t("allTables.selectRowFirst"));
      return dbTablesApi.updateRow(table.slug, selectedId, values);
    },
    onSuccess: () => {
      invalidateTable();
      setFormMode(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => dbTablesApi.deleteRow(table.slug, id),
    onSuccess: () => {
      invalidateTable();
      setSelectedId(null);
    },
  });

  const rows = rowsQuery.data?.rows;
  const columns: Column<Row>[] = useMemo(() => {
    const keys = table.columns.length ? table.columns : rows && rows[0] ? Object.keys(rows[0]) : [];
    return keys
      .filter((k) => k !== "_id" && k !== "_rowid")
      .map((k) => ({ key: k, header: humanizeKey(k) }));
  }, [table.columns, rows]);

  const dataWithKeys: Row[] | undefined = useMemo(
    () =>
      rows?.map((r, idx) => ({
        ...r,
        _id: rowId(r) ?? idx + 1,
      })),
    [rows]
  );

  const selectedRow = dataWithKeys?.find((r) => r._id === selectedId);
  const formBusy = createMutation.isPending || updateMutation.isPending;
  const formError = formMode === "edit" ? updateMutation.error : createMutation.error;

  const formFields: FieldDef[] = useMemo(
    () => table.columns.map((col) => ({ name: col, label: col, type: "text" as const, span: 1 as const })),
    [table.columns]
  );

  function applyFilters() {
    setQuery(term.trim());
    setAppliedColumn(column);
    setAppliedValue(columnValue.trim());
    setSelectedId(null);
  }

  function clearFilters() {
    setTerm("");
    setQuery("");
    setColumn("");
    setColumnValue("");
    setAppliedColumn("");
    setAppliedValue("");
    setSelectedId(null);
  }

  function handleDelete() {
    if (selectedId == null) return;
    void appConfirm(t("allTables.confirmDeleteRecord")).then((ok) => {
      if (ok) deleteMutation.mutate(selectedId);
    });
  }

  const categoryLabel = t(`allTables.cat.${table.category}`);
  const categoryText = categoryLabel.startsWith("allTables.") ? table.category : categoryLabel;

  return (
    <div className="border-2 border-[var(--win-face-dark)] bg-[var(--win-panel)]">
      <button
        type="button"
        onClick={() =>
          setOpen((o) => {
            const next = !o;
            if (!next) setSelectedId(null);
            return next;
          })
        }
        className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-[var(--win-face-hi)]"
      >
        {open ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
        <span className="min-w-0 flex-1 truncate font-bold text-[var(--win-navy)]">{table.name}</span>
        <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--win-muted)] sm:inline">
          {categoryText}
        </span>
        <span className="shrink-0 text-xs text-[var(--win-muted)]">
          {t("allTables.rowCount", { count: table.row_count })}
        </span>
      </button>
      {open && (
        <div className="border-t-2 border-[var(--win-face-dark)] p-3">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <Label>{t("common.search")}</Label>
              <Input
                value={term}
                placeholder={t("allTables.searchRowsPlaceholder")}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <div className="min-w-[140px]">
              <Label>{t("allTables.filterColumn")}</Label>
              <Select value={column} onChange={(e) => setColumn(e.target.value)}>
                <option value="">{t("allTables.anyColumn")}</option>
                {table.columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[140px]">
              <Label>{t("allTables.filterValue")}</Label>
              <Input
                value={columnValue}
                placeholder={t("allTables.filterValuePlaceholder")}
                onChange={(e) => setColumnValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                disabled={!column}
              />
            </div>
            <Button size="sm" onClick={applyFilters}>
              {t("common.filter")}
            </Button>
            <Button size="sm" variant="secondary" onClick={clearFilters}>
              {t("allTables.clearFilters")}
            </Button>
            {editable && (
              <>
                <Button size="sm" onClick={() => setFormMode("add")}>
                  <Plus size={14} /> {t("allTables.addRecord")}
                </Button>
                <Button size="sm" variant="secondary" disabled={selectedId == null} onClick={() => setFormMode("edit")}>
                  <Pencil size={14} /> {t("allTables.editRecord")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={selectedId == null || deleteMutation.isPending}
                  onClick={handleDelete}
                >
                  <Trash2 size={14} /> {t("allTables.deleteRecord")}
                </Button>
              </>
            )}
            <div className="ms-auto">
              <ExportButtons prefix={`/db-tables/${table.slug}`} params={params} filenameBase={table.slug} />
            </div>
          </div>
          {rowsQuery.isLoading ? (
            <LoadingState />
          ) : rowsQuery.isError ? (
            <ErrorState message={(rowsQuery.error as Error).message} />
          ) : (
            <>
              <p className="mb-2 text-xs text-[var(--win-muted)]">
                {t("allTables.showingRows", {
                  shown: rows?.length ?? 0,
                  total: rowsQuery.data?.total ?? 0,
                })}
              </p>
              <DataTable<Row>
                columns={columns}
                data={dataWithKeys}
                keyField="_id"
                selectedKey={selectedId}
                onRowClick={(row) => setSelectedId(row._id)}
                emptyTitle={t("common.noRecordsFound")}
              />
              {deleteMutation.isError && (
                <p className="mt-2 text-xs text-[var(--win-danger)]">{(deleteMutation.error as Error).message}</p>
              )}
            </>
          )}
        </div>
      )}
      <Modal
        open={formMode !== null}
        onClose={() => setFormMode(null)}
        title={`${t(formMode === "edit" ? "allTables.editRecord" : "allTables.addRecord")} — ${table.name}`}
        wide
      >
        <ResourceForm
          key={formMode === "edit" ? String(selectedId ?? "edit") : "new"}
          fields={formFields}
          initialValues={formMode === "edit" ? selectedRow : undefined}
          onSubmit={(values) => {
            if (formMode === "edit") updateMutation.mutate(values);
            else createMutation.mutate(values);
          }}
          onCancel={() => setFormMode(null)}
          submitting={formBusy}
          submitLabel={t("common.save")}
        />
        {formError && <p className="mt-2 text-xs text-[var(--win-danger)]">{(formError as Error).message}</p>}
      </Modal>
    </div>
  );
}
