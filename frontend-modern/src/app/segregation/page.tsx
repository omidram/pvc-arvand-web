"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { electrodeSegregationsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { ElectrodeSegregation } from "@/lib/types";
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

const FIELDS: FieldDef[] = [
  { name: "serial_nr", label: "Serial", required: true },
  { name: "electrode_kind", label: "Kind" },
  { name: "company", label: "Company" },
  { name: "service_life", label: "Service life" },
  { name: "install_date", label: "Install", type: "date" },
  { name: "dismantle_date", label: "Dismantle", type: "date" },
  { name: "inspection_date", label: "Inspection", type: "date" },
  { name: "xrf", label: "XRF" },
  { name: "voltage_quality", label: "Voltage" },
  { name: "warranty", label: "Warranty" },
  { name: "coating_quality", label: "Coating" },
  { name: "decision", label: "Decision" },
  { name: "problems", label: "Problems", type: "textarea", span: 2 },
  { name: "segregation", label: "Segregation", type: "textarea", span: 2 },
  { name: "pallet", label: "Pallet" },
  { name: "remarks", label: "Remarks", type: "textarea", span: 2 },
];

export default function SegregationPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("anodes");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ElectrodeSegregation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const params: Record<string, unknown> = { limit: 500 };
  if (q) params.q = q;
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrodeSegregation>(
    "electrode-segregations",
    electrodeSegregationsApi,
    params
  );

  const columns: Column<ElectrodeSegregation>[] = [
    { key: "serial_nr", header: "Serial" },
    { key: "electrode_kind", header: "Kind" },
    { key: "company", header: "Company" },
    { key: "decision", header: "Decision" },
    { key: "pallet", header: "Pallet" },
    { key: "inspection_date", header: "Date", render: (r) => formatDate(r.inspection_date) },
  ];

  return (
    <div>
      <PageHeader
        title={t("nav.segregation")}
        description="TAFKIK workshop decisions"
        actions={
          <>
            <ExportButtons prefix="/electrode-segregations" filenameBase="segregation" />
            {editable && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Upload size={16} /> TAFKIK
              </Button>
            )}
            {editable && (
              <Button onClick={() => { setEditing(null); setShowForm(true); }}>
                <Plus size={16} /> New
              </Button>
            )}
          </>
        }
      />
      <Input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-xs" />
      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField="id"
          isLoading={listQuery.isLoading}
          actions={
            editable
              ? (row) => (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setShowForm(true); }}>
                      <Pencil size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(row.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? editing.serial_nr : "New"} wide>
        <ResourceForm
          fields={FIELDS}
          initialValues={editing ?? undefined}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
          onSubmit={(values) => {
            if (editing) updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
            else createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
          }}
        />
      </Modal>
      {showImport && <ImportTafkikModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function ImportTafkikModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => electrodeSegregationsApi.importTafkikExcel(file!),
    onSuccess: (data) => {
      setResult(String(data.imported_rows));
      queryClient.invalidateQueries({ queryKey: ["electrode-segregations"] });
    },
  });
  return (
    <Modal open onClose={onClose} title="Import TAFKIK Excel">
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
