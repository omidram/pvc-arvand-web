"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { electrodeSegregationsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { ElectrodeSegregation } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { Upload } from "lucide-react";

export default function SegregationPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("anodes");
  const [showImport, setShowImport] = useState(false);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrodeSegregation>(
    "electrode-segregations",
    electrodeSegregationsApi,
    { limit: 500 }
  );

  const fields: FieldDef[] = [
    { name: "serial_nr", label: t("segregation.serialNr"), required: true },
    {
      name: "electrode_kind",
      label: t("segregation.kind"),
      type: "select",
      options: [
        { label: t("segregation.anode"), value: "anode" },
        { label: t("segregation.cathode"), value: "cathode" },
        { label: t("segregation.unknown"), value: "unknown" },
      ],
    },
    { name: "company", label: t("segregation.company") },
    { name: "service_life", label: t("segregation.serviceLife") },
    { name: "install_date", label: t("segregation.installDate"), type: "date" },
    { name: "dismantle_date", label: t("segregation.dismantleDate"), type: "date" },
    { name: "inspection_date", label: t("segregation.inspectionDate"), type: "date" },
    { name: "xrf", label: "XRF" },
    { name: "voltage_quality", label: t("segregation.voltageQuality") },
    { name: "warranty", label: t("segregation.warranty") },
    { name: "coating_quality", label: t("segregation.coatingQuality") },
    { name: "decision", label: t("segregation.decision") },
    { name: "problems", label: t("segregation.problems"), type: "textarea", span: 2 },
    { name: "segregation", label: t("segregation.segregationDecision"), type: "textarea", span: 2 },
    { name: "pallet", label: t("segregation.pallet") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<ElectrodeSegregation>[] = [
    { key: "serial_nr", header: t("segregation.serialNr") },
    { key: "electrode_kind", header: t("segregation.kind") },
    { key: "company", header: t("segregation.company") },
    { key: "voltage_quality", header: t("segregation.voltageQuality") },
    { key: "decision", header: t("segregation.decision") },
    { key: "pallet", header: t("segregation.pallet") },
    { key: "inspection_date", header: t("fields.date"), render: (r) => formatDate(r.inspection_date) },
  ];

  return (
    <>
      <AccessWorkspace<ElectrodeSegregation>
        caption={t("segregation.title")}
        helpKey="anodes"
        backHref="/elements"
        backLabel={t("elements.title")}
        records={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error as Error | null}
        fields={fields}
        columns={columns}
        idField="id"
        canEdit={editable}
        onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
        onCreate={(values) => createMutation.mutate(values as never)}
        onDelete={(id) => removeMutation.mutate(id)}
        confirmDelete={(row) => t("segregation.confirmDelete", { nr: row.serial_nr })}
        submitting={createMutation.isPending || updateMutation.isPending}
        exportPrefix="/electrode-segregations"
        filenameBase="electrode-segregations"
        commands={
          editable ? (
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={14} /> {t("segregation.importTafkik")}
            </Button>
          ) : null
        }
      />
      {editable && showImport ? <ImportTafkikModal onClose={() => setShowImport(false)} /> : null}
    </>
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
      setResult(t("segregation.importedRows", { n: data.imported_rows }));
      queryClient.invalidateQueries({ queryKey: ["electrode-segregations"] });
    },
  });

  return (
    <Modal open onClose={onClose} title={t("segregation.importTitle")}>
      <div className="space-y-3">
        <p className="text-xs text-[var(--win-muted)]">{t("segregation.importHelp")}</p>
        <div>
          <Label>{t("segregation.excelFile")}</Label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
        </div>
        {result && (
          <div className="border-2 border-[#5fa85f] bg-[#d9f0d9] px-3 py-2 text-sm font-semibold text-[#0d5c0d]">
            {result}
          </div>
        )}
        {mutation.isError && <ErrorState message={(mutation.error as Error).message} />}
        <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-3">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? t("common.saving") : t("common.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
