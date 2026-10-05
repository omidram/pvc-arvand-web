"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { elementsApi, relationsApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
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
import { assemblyPositionError, normalizeCellPosition } from "@/lib/assembly-rules";

function withAssemblyPayload(values: Record<string, unknown>) {
  return { ...values, position: normalizeCellPosition(values.position) };
}

export function AssemblyDataForm() {
  const { t } = useI18n();
  const { canEdit, isAdmin } = useAuth();
  const editable = canEdit("elements");
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = useState<"assembly" | "disassembly" | null>(null);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Element>(
    "elements",
    elementsApi,
    { limit: 20000 }
  );
  const nextNrQuery = useQuery({
    queryKey: ["elements", "next-number"],
    queryFn: () => elementsApi.nextNumber(),
  });
  const anodes = useQuery({ queryKey: ["relations", "anode-numbers"], queryFn: () => relationsApi.lookup("anode-numbers") });
  const cathodes = useQuery({ queryKey: ["relations", "cathode-numbers"], queryFn: () => relationsApi.lookup("cathode-numbers") });
  const membranes = useQuery({ queryKey: ["relations", "membrane-numbers"], queryFn: () => relationsApi.lookup("membrane-numbers") });
  const membraneTypes = useQuery({ queryKey: ["relations", "membrane-types"], queryFn: () => relationsApi.lookup("membrane-types") });
  const groups = useQuery({ queryKey: ["relations", "groups"], queryFn: () => relationsApi.lookup("groups") });
  const electrolyzers = useQuery({ queryKey: ["relations", "electrolyzers"], queryFn: () => relationsApi.lookup("electrolyzers") });

  const generations = useQuery({ queryKey: ["relations", "generations"], queryFn: () => relationsApi.lookup("generations") });
  const decommissionReasons = useQuery({
    queryKey: ["relations", "decommission-reasons"],
    queryFn: () => relationsApi.lookup("decommission-reasons"),
  });

  useEffect(() => {
    const imp = searchParams.get("import");
    if (imp === "montage" || imp === "assembly") setShowImport("assembly");
    if (imp === "demontage" || imp === "disassembly") setShowImport("disassembly");
  }, [searchParams]);

  const generationOptions = useMemo(() => {
    const fixed = ["3", "4", "5", "5+", "6", "6+", "Blue Star"];
    const fixedKey = new Set(fixed.map((v) => v.toLowerCase()));
    const extras = (generations.data || []).filter((v) => !fixedKey.has(String(v).trim().toLowerCase()));
    return [...fixed, ...extras].map((value) => ({ label: value, value }));
  }, [generations.data]);

  const reasonOptions = useMemo(
    () => (decommissionReasons.data || []).map((value) => ({ label: value, value })),
    [decommissionReasons.data]
  );

  const fields: FieldDef[] = [
    { name: "element_nr", label: t("fields.elementNr"), required: true },
    {
      name: "electrolyzer",
      label: t("fields.electrolyzer"),
      type: "combo",
      options: (electrolyzers.data || []).map((value) => ({ label: value, value })),
    },
    { name: "position", label: t("fields.position"), placeholder: t("elements.positionPlaceholder") },
    {
      name: "group_nr",
      label: t("fields.groupNr"),
      type: "select",
      options: (groups.data || []).map((value) => ({ label: value, value })),
    },
    {
      name: "generation",
      label: t("fields.generation"),
      type: "combo",
      options: generationOptions,
    },
    {
      name: "anode_nr",
      label: t("fields.anodeNr"),
      type: "select",
      options: (anodes.data || []).map((value) => ({ label: value, value })),
    },
    {
      name: "cathode_nr",
      label: t("fields.cathodeNr"),
      type: "select",
      options: (cathodes.data || []).map((value) => ({ label: value, value })),
    },
    {
      name: "membrane_nr",
      label: t("fields.membraneNr"),
      type: "select",
      options: (membranes.data || []).map((value) => ({ label: value, value })),
    },
    {
      name: "membrane_type",
      label: t("fields.membraneType"),
      type: "select",
      options: (membraneTypes.data || []).map((value) => ({ label: value, value })),
    },
    { name: "gap_mm", label: t("fields.gapMm") },
    { name: "assembly_date", label: t("fields.assemblyDate"), type: "date" },
    { name: "commissioning_date", label: t("fields.commissioningDate"), type: "date" },
    { name: "decommissioning_date", label: t("fields.decommissioningDate"), type: "date" },
    { name: "disassembly_date", label: t("fields.disassemblyDate"), type: "date" },
    { name: "dol_days", label: t("fields.dolDaysOverride"), type: "number" },
    {
      name: "decommission_reason",
      label: t("fields.decommissionReason"),
      type: "combo",
      options: reasonOptions,
    },
    { name: "ispb", label: t("fields.ispb") },
    { name: "anode_coating", label: t("fields.anodeCoating") },
    { name: "anode_electrode", label: t("fields.anodeElectrode") },
    { name: "anode_shell", label: t("fields.anodeShell") },
    { name: "cathode_coating", label: t("fields.cathodeCoating") },
    { name: "cathode_electrode", label: t("fields.cathodeElectrode") },
    { name: "cathode_shell", label: t("fields.cathodeShell") },
    { name: "membrane_info", label: t("fields.membraneInfo") },
    { name: "membrane_remark", label: t("fields.membraneRemark"), type: "textarea", span: 2 },
    { name: "anode_remark", label: t("fields.anodeRemark"), type: "textarea", span: 2 },
    { name: "cathode_remark", label: t("fields.cathodeRemark"), type: "textarea", span: 2 },
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
    {
      key: "assembly_date",
      header: t("elements.assembly"),
      render: (row) => formatDate(row.assembly_date),
      filterText: (row) => formatDate(row.assembly_date) || row.assembly_date || "",
    },
    {
      key: "computed_dol_days",
      header: t("fields.dolDays"),
      render: (row) => row.computed_dol_days ?? "—",
      filterText: (row) => (row.computed_dol_days == null ? "" : String(row.computed_dol_days)),
    },
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
        newDefaults={() => ({ element_nr: nextNrQuery.data?.element_nr ?? "" })}
        newDefaultsKey={nextNrQuery.data?.element_nr ?? ""}
        validate={(values) => assemblyPositionError(values.position, t)}
        onSave={async (id, values) => {
          await updateMutation.mutateAsync({ id, payload: withAssemblyPayload(values) });
        }}
        onCreate={async (values) => {
          await createMutation.mutateAsync(withAssemblyPayload(values) as never);
          await queryClient.invalidateQueries({ queryKey: ["elements", "next-number"] });
        }}
        onDelete={(id) => removeMutation.mutate(id)}
        confirmDelete={(el) => t("elements.confirmDelete", { nr: el.element_nr })}
        submitting={createMutation.isPending || updateMutation.isPending}
        exportPrefix="/elements"
        filenameBase="elements"
        onLookup={async (name, _value, values) => {
          const focus = [
            "element_nr",
            "anode_nr",
            "cathode_nr",
            "membrane_nr",
            "electrolyzer",
            "position",
            "membrane_type",
            "group_nr",
          ];
          if (!focus.includes(name)) return null;
          return elementsApi.match({
            focus: name,
            element_nr: String(values.element_nr ?? ""),
            anode_nr: String(values.anode_nr ?? ""),
            cathode_nr: String(values.cathode_nr ?? ""),
            membrane_nr: String(values.membrane_nr ?? ""),
            electrolyzer: String(values.electrolyzer ?? ""),
            position: String(values.position ?? ""),
            membrane_type: String(values.membrane_type ?? ""),
            group_nr: String(values.group_nr ?? ""),
          });
        }}
        related={(row) => <ElementRelations row={row} />}
        commands={
          editable && isAdmin ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowImport("assembly")}>
                <Upload size={14} /> {t("menus.importMontage")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowImport("disassembly")}>
                <Upload size={14} /> {t("menus.importDemontage")}
              </Button>
            </>
          ) : null
        }
      />
      {editable && isAdmin && showImport ? (
        <ImportAssemblyModal mode={showImport} onClose={() => setShowImport(null)} />
      ) : null}
    </>
  );
}

function ImportAssemblyModal({
  mode,
  onClose,
}: {
  mode: "assembly" | "disassembly";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return elementsApi.importAssemblyExcel(
        file!,
        mode === "disassembly" ? "disassembly" : "upsert",
        setProgress
      );
    },
    onSuccess: (data) => {
      setResult(
        t("elements.importedRowsDetail", {
          n: data.imported_rows,
          created: data.created ?? 0,
          updated: data.updated ?? 0,
          skipped: data.skipped ?? 0,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["elements"] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "disassembly" ? t("elements.importDisassemblyTitle") : t("elements.importAssemblyTitle")}
    >
      <div className="space-y-3">
        <p className="text-xs text-[var(--win-muted)]">
          {mode === "disassembly"
            ? t("elements.importDisassemblyHelp")
            : t("elements.importAssemblyHelp")}
        </p>
        <div>
          <Label>{t("elements.assemblyExcelFile")}</Label>
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
            {mutation.isPending ? t("common.importing") : t("common.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
