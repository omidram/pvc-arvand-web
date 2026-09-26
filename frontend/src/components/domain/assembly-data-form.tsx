"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { anodesApi, cathodesApi, elementsApi, groupDefinitionsApi, membranesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Element } from "@/lib/types";
import { AccessWorkspace } from "@/components/layout/access-workspace";
import { ElementRelations } from "@/components/domain/access-relations";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";

export function AssemblyDataForm() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("elements");
  const [showImport, setShowImport] = useState(false);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Element>(
    "elements",
    elementsApi,
    { limit: 500 }
  );
  const anodes = useQuery({ queryKey: ["anodes", { limit: 500 }], queryFn: () => anodesApi.list({ limit: 500 }) });
  const cathodes = useQuery({ queryKey: ["cathodes", { limit: 500 }], queryFn: () => cathodesApi.list({ limit: 500 }) });
  const membranes = useQuery({ queryKey: ["membranes", { limit: 500 }], queryFn: () => membranesApi.list({ limit: 500 }) });
  const groups = useQuery({ queryKey: ["group-definitions"], queryFn: () => groupDefinitionsApi.list() });

  const fields: FieldDef[] = [
    { name: "element_nr", label: t("fields.elementNr"), required: true },
    { name: "electrolyzer", label: t("fields.electrolyzer") },
    { name: "position", label: t("fields.position") },
    {
      name: "group_nr",
      label: t("fields.groupNr"),
      type: "select",
      options: (groups.data || []).map((g) => ({ label: g.group_nr, value: g.group_nr })),
    },
    { name: "generation", label: t("fields.generation") },
    {
      name: "anode_nr",
      label: t("fields.anodeNr"),
      type: "select",
      options: (anodes.data || []).map((a) => ({ label: a.anode_nr, value: a.anode_nr })),
    },
    {
      name: "cathode_nr",
      label: t("fields.cathodeNr"),
      type: "select",
      options: (cathodes.data || []).map((c) => ({ label: c.cathode_nr, value: c.cathode_nr })),
    },
    {
      name: "membrane_nr",
      label: t("fields.membraneNr"),
      type: "select",
      options: (membranes.data || []).map((m) => ({ label: m.membrane_nr, value: m.membrane_nr })),
    },
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
    { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
  ];

  const columns: Column<Element>[] = [
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.positionShort") },
    { key: "status", header: t("fields.status") },
    { key: "anode_nr", header: t("fields.anode") },
    { key: "cathode_nr", header: t("fields.cathode") },
    { key: "membrane_nr", header: t("fields.membrane") },
    { key: "assembly_date", header: t("elements.assembly"), render: (row) => formatDate(row.assembly_date) },
    { key: "computed_dol_days", header: t("fields.dolDays"), render: (row) => row.computed_dol_days ?? "—" },
  ];

  return (
    <>
      <AccessWorkspace<Element>
        caption={t("menus.assemblyData")}
        helpKey="elements"
        backHref="/elements"
        backLabel={t("elements.title")}
        records={listQuery.data}
        isLoading={listQuery.isLoading}
        error={listQuery.error as Error | null}
        fields={fields}
        columns={columns}
        idField="id"
        recordParam="element_nr"
        canEdit={editable}
        onSave={(id, values) => updateMutation.mutate({ id, payload: values })}
        onCreate={(values) => createMutation.mutate(values as never)}
        onDelete={(id) => removeMutation.mutate(id)}
        confirmDelete={(el) => t("elements.confirmDelete", { nr: el.element_nr })}
        submitting={createMutation.isPending || updateMutation.isPending}
        exportPrefix="/elements"
        filenameBase="elements"
        related={(row) => <ElementRelations row={row} />}
        commands={
          editable ? (
            <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={14} /> {t("elements.importAssembly")}
            </Button>
          ) : null
        }
      />
      {editable && showImport ? <ImportAssemblyModal onClose={() => setShowImport(false)} /> : null}
    </>
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
      setResult(t("elements.importedRows", { n: data.imported_rows }));
      queryClient.invalidateQueries({ queryKey: ["elements"] });
    },
  });

  return (
    <Modal open onClose={onClose} title={t("elements.importAssemblyTitle")}>
      <div className="space-y-3">
        <p className="text-xs text-[var(--win-muted)]">{t("elements.importAssemblyHelp")}</p>
        <div>
          <Label>{t("elements.assemblyExcelFile")}</Label>
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
            {mutation.isPending ? t("common.importing") : t("common.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
