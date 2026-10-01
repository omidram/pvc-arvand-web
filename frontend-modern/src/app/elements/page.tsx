"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, History, X, Upload } from "lucide-react";
import { elementsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Element } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge, statusColor } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";
import { assemblyPositionError, normalizeCellPosition } from "@/lib/assembly-rules";
import Link from "next/link";

function buildFields(t: ReturnType<typeof useI18n>["t"]): FieldDef[] {
  return [
    { name: "element_nr", label: t("fields.elementNr"), required: true },
    { name: "electrolyzer", label: t("fields.electrolyzer") },
    { name: "position", label: t("fields.position"), placeholder: t("elements.positionPlaceholder") },
    { name: "group_nr", label: t("fields.groupNr") },
    { name: "generation", label: t("fields.generation") },
    { name: "anode_nr", label: t("fields.anodeNr") },
    { name: "cathode_nr", label: t("fields.cathodeNr") },
    { name: "membrane_nr", label: t("fields.membraneNr") },
    { name: "membrane_type", label: t("fields.membraneType") },
    { name: "gap_mm", label: t("fields.gapMm") },
    { name: "assembly_date", label: t("fields.assemblyDate"), type: "date" },
    { name: "commissioning_date", label: t("fields.commissioningDate"), type: "date" },
    { name: "decommissioning_date", label: t("fields.decommissioningDate"), type: "date" },
    { name: "disassembly_date", label: t("fields.disassemblyDate"), type: "date" },
    { name: "dol_days", label: t("fields.dolDaysOverride"), type: "number" },
    { name: "decommission_reason", label: t("fields.decommissionReason") },
    { name: "ispb", label: t("fields.ispb") },
    { name: "anode_coating", label: t("fields.anodeCoating") },
    { name: "anode_electrode", label: t("fields.anodeElectrode") },
    { name: "anode_shell", label: t("fields.anodeShell") },
    { name: "cathode_coating", label: t("fields.cathodeCoating") },
    { name: "cathode_electrode", label: t("fields.cathodeElectrode") },
    { name: "cathode_shell", label: t("fields.cathodeShell") },
    { name: "membrane_info", label: t("fields.membraneInfo") },
    { name: "membrane_remark", label: t("fields.membraneRemark"), type: "textarea", span: 2 },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];
}

export default function ElementsPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("elements");
  const [q, setQ] = useState("");
  const [electrolyzer, setElectrolyzer] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [editing, setEditing] = useState<Element | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const queryClient = useQueryClient();

  const params: Record<string, unknown> = { limit: 20000 };
  if (q) params.q = q;
  if (electrolyzer) params.electrolyzer = electrolyzer;
  if (activeOnly) params.active_only = true;

  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Element>(
    "elements",
    elementsApi,
    params
  );
  const nextNrQuery = useQuery({
    queryKey: ["elements", "next-number"],
    queryFn: () => elementsApi.nextNumber(),
  });

  const FIELDS = buildFields(t);

  const columns: Column<Element>[] = [
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.positionShort") },
    {
      key: "status",
      header: t("fields.status"),
      render: (row) => <Badge color={statusColor(row.status)}>{row.status ? t(`status.${row.status}`) : t("common.unknown")}</Badge>,
    },
    { key: "anode_nr", header: t("fields.anode") },
    { key: "cathode_nr", header: t("fields.cathode") },
    { key: "membrane_nr", header: t("fields.membrane") },
    { key: "membrane_type", header: t("fields.membraneType") },
    { key: "assembly_date", header: t("elements.assembly"), render: (row) => formatDate(row.assembly_date) },
    { key: "computed_dol_days", header: t("fields.dolDays"), render: (row) => row.computed_dol_days ?? "—" },
  ];

  function openCreate() {
    setEditing(null);
    setFormError("");
    setShowForm(true);
  }

  function openEdit(el: Element) {
    setEditing(el);
    setFormError("");
    setShowForm(true);
  }

  function handleSubmit(values: Record<string, unknown>) {
    const message = assemblyPositionError(values.position, t);
    if (message) {
      setFormError(message);
      return;
    }
    const payload = { ...values, position: normalizeCellPosition(values.position) };
    setFormError("");
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, payload },
        { onSuccess: () => setShowForm(false) }
      );
    } else {
      createMutation.mutate(payload as never, {
        onSuccess: () => {
          setShowForm(false);
          queryClient.invalidateQueries({ queryKey: ["elements", "next-number"] });
        },
      });
    }
  }

  function handleDelete(el: Element) {
    if (confirm(t("elements.confirmDelete", { nr: el.element_nr }))) {
      removeMutation.mutate(el.id);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("elements.title")}
        description={t("elements.description")}
        helpKey="elements"
        actions={
          <>
            <ExportButtons prefix="/elements" params={params} filenameBase="elements" />
            <Link href="/segregation">
              <Button variant="secondary">{t("elements.segregation")}</Button>
            </Link>
            {editable && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Upload size={16} /> Excel
              </Button>
            )}
            {editable && (
              <Button onClick={openCreate}>
                <Plus size={16} /> {t("elements.newElement")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder={t("elements.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder={t("elements.filterElectrolyzer")}
          value={electrolyzer}
          onChange={(e) => setElectrolyzer(e.target.value)}
          className="max-w-[200px]"
        />
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 accent-[var(--win-navy)]"
          />
          {t("elements.activeOnly")}
        </label>
      </div>

      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField="id"
          isLoading={listQuery.isLoading}
          emptyTitle={t("elements.noElementsFound")}
          actions={(row) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => setHistoryFor(row.element_nr)} title={t("elements.viewHistory")}>
                <History size={14} />
              </Button>
              {editable && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title={t("common.edit")}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(row)} title={t("common.delete")}>
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )}
            </>
          )}
        />
      )}

      {listQuery.data && (
        <div className="mt-3 text-xs text-[var(--win-muted)]">{t("elements.shown", { n: listQuery.data.length })}</div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("elements.editElement", { nr: editing.element_nr }) : t("elements.newElementTitle")}
        wide
      >
        {formError ? (
          <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {formError}
          </p>
        ) : null}
        <ResourceForm<Element>
          key={editing ? `e-${editing.id}` : `n-${nextNrQuery.data?.element_nr || "new"}`}
          fields={FIELDS}
          initialValues={editing ?? { element_nr: nextNrQuery.data?.element_nr ?? "" }}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>

      {historyFor && <HistoryModal elementNr={historyFor} onClose={() => setHistoryFor(null)} />}
      {showImport && <ImportAssemblyModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function ImportAssemblyModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => elementsApi.importAssemblyExcel(file!),
    onSuccess: (data) => {
      setResult(`${data.imported_rows}`);
      queryClient.invalidateQueries({ queryKey: ["elements"] });
    },
  });
  return (
    <Modal open onClose={onClose} title="Import assembly Excel">
      <div className="space-y-3">
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {result && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Imported {result} rows</div>}
        {mutation.isError && <ErrorState message={(mutation.error as Error).message} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
          <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>{t("common.import")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ elementNr, onClose }: { elementNr: string; onClose: () => void }) {
  const { t } = useI18n();
  const historyQuery = useQuery({
    queryKey: ["elements", "history", elementNr],
    queryFn: () => elementsApi.history(elementNr),
  });

  return (
    <Modal open onClose={onClose} title={t("elements.historyTitle", { nr: elementNr })} wide>
      {historyQuery.isLoading ? (
        <LoadingState />
      ) : historyQuery.isError ? (
        <ErrorState message={(historyQuery.error as Error).message} />
      ) : !historyQuery.data || historyQuery.data.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--win-muted)]">{t("elements.noHistory")}</div>
      ) : (
        <div className="space-y-3">
          {historyQuery.data.map((h) => (
            <div key={h.id} className="border-2 border-[var(--win-face-dark)] bg-[var(--win-input)] p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold text-[var(--win-text)]">
                  {h.electrolyzer || "—"} / {h.position || "—"}
                </span>
                <Badge color={statusColor(h.status)}>{h.status ? t(`status.${h.status}`) : ""}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--win-muted)] sm:grid-cols-4">
                <div>{t("elements.assembly")}: {formatDate(h.assembly_date)}</div>
                <div>{t("elements.commissioningShort")}: {formatDate(h.commissioning_date)}</div>
                <div>{t("elements.decommissioningShort")}: {formatDate(h.decommissioning_date)}</div>
                <div>{t("elements.dolShort")}: {h.computed_dol_days ?? "—"} {t("elements.days")}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          <X size={14} /> {t("common.close")}
        </Button>
      </div>
    </Modal>
  );
}
