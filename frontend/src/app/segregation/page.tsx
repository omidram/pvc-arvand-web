"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { electrodeSegregationsApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { useCrudResource } from "@/lib/use-resource";
import type { ElectrodeSegregation } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { SegregationRelations } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { canSeeSegregation, canWorkSegregation } from "@/lib/inspection-access";
import { Upload } from "lucide-react";

export default function SegregationPage() {
  const { t } = useI18n();
  const { canEdit, canView, isAdmin } = useAuth();
  const allowed = canSeeSegregation(canView);
  const editable = canWorkSegregation(canEdit);
  const [showImport, setShowImport] = useState(false);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrodeSegregation>(
    "electrode-segregations",
    electrodeSegregationsApi,
    { limit: 5000 }
  );
  if (!allowed) return null;

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
    { name: "decommission_date", label: t("segregation.decommissionDate"), type: "date" },
    { name: "disassemble_date", label: t("segregation.disassembleDate"), type: "date" },
    { name: "inspection_date", label: t("segregation.inspectionDate"), type: "date" },
    { name: "xrf", label: "XRF" },
    { name: "pair_serial_nr", label: t("segregation.pairSerial") },
    { name: "pair_xrf", label: t("segregation.pairXrf") },
    { name: "decommission_voltage", label: t("segregation.decommissionVoltage"), type: "number" },
    { name: "decommission_ka", label: t("segregation.decommissionKa"), type: "number" },
    { name: "decommission_temp", label: t("segregation.decommissionTemp"), type: "number" },
    { name: "voltage_quality", label: t("segregation.voltageQuality") },
    { name: "warranty", label: t("segregation.warranty") },
    { name: "coating_quality", label: t("segregation.coatingQuality") },
    { name: "decision", label: t("segregation.decision") },
    { name: "problems", label: t("segregation.problems"), type: "textarea", span: 2 },
    { name: "segregation", label: t("segregation.segregationDecision"), type: "textarea", span: 2 },
    { name: "pallet", label: t("segregation.pallet") },
    { name: "inspection_form_serial", label: t("segregation.inspectionFormSerial") },
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<ElectrodeSegregation>[] = [
    { key: "serial_nr", header: t("segregation.serialNr") },
    { key: "electrode_kind", header: t("segregation.kind") },
    { key: "company", header: t("segregation.company") },
    { key: "pair_serial_nr", header: t("segregation.pairSerial") },
    { key: "voltage_quality", header: t("segregation.voltageQuality") },
    { key: "decision", header: t("segregation.decision") },
    { key: "pallet", header: t("segregation.pallet") },
    { key: "inspection_date", header: t("fields.date"), render: (r) => formatDate(r.inspection_date) },
  ];

  return (
    <>
      <AccessWorkspace<ElectrodeSegregation>
        caption={t("segregation.title")}
        helpKey="segregation"
        backHref="/elements"
        backLabel={t("elements.title")}
        records={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error as Error | null}
        fields={fields}
        columns={columns}
        idField="id"
        recordParam="serial_nr"
        canEdit={editable}
        onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
        onCreate={(values) => createMutation.mutate(values as never)}
        onDelete={(id) => removeMutation.mutate(id)}
        confirmDelete={(row) => t("segregation.confirmDelete", { nr: row.serial_nr })}
        submitting={createMutation.isPending || updateMutation.isPending}
        exportPrefix="/electrode-segregations"
        filenameBase="electrode-segregations"
        related={(row) => <SegregationRelations row={row} />}
        onSuggest={async (name, value, current) => {
          if (name !== "serial_nr") return null;
          const serial = String(value ?? "").trim();
          if (serial.length < 4) return null;
          const data = await electrodeSegregationsApi.fromAssembly(
            serial,
            String(current.service_life ?? "").trim() || null
          );
          if (!data || (!data.company && !data.pair_serial_nr && !data.install_date)) return null;
          return {
            electrode_kind: data.electrode_kind ?? null,
            company: data.company ?? null,
            service_life: data.service_life ?? null,
            install_date: data.install_date ?? null,
            decommission_date: data.decommission_date ?? null,
            disassemble_date: data.disassemble_date ?? null,
            pair_serial_nr: data.pair_serial_nr ?? null,
            pair_xrf: data.pair_xrf ?? null,
            decommission_voltage: data.decommission_voltage ?? null,
            decommission_ka: data.decommission_ka ?? null,
            decommission_temp: data.decommission_temp ?? null,
            problems: data.problems ?? null,
            inspection_form_serial: data.inspection_form_serial ?? null,
          };
        }}
        commands={
          editable && isAdmin ? (
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={14} /> {t("segregation.importTafkik")}
            </Button>
          ) : null
        }
      />
      {editable && isAdmin && showImport ? <ImportTafkikModal onClose={() => setShowImport(false)} /> : null}
    </>
  );
}

function ImportTafkikModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return electrodeSegregationsApi.importTafkikExcel(file!, undefined, setProgress);
    },
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
        {progress && mutation.isPending ? <ImportProgressBar progress={progress} wide /> : null}
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
