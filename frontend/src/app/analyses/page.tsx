"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analysesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { AnalysisSample } from "@/lib/types";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

const SCOPES = ["plant", "sub_plant", "electrolyzer", "group", "element"] as const;

const COLUMNS: { titleKey: string; scope: string; items: { labelKey: string; type: string }[] }[] = [
  {
    titleKey: "menus.totalPlant",
    scope: "plant",
    items: [
      { labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { labelKey: "enums.analysisType.chlorine_gas", type: "chlorine_gas" },
      { labelKey: "enums.analysisType.hydrogen", type: "hydrogen" },
      { labelKey: "menus.hclToAnolyte", type: "hcl" },
      { labelKey: "enums.analysisType.demin_water", type: "demin_water" },
      { labelKey: "menus.leanCaustic", type: "caustic_feed" },
    ],
  },
  {
    titleKey: "menus.train",
    scope: "sub_plant",
    items: [
      { labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { labelKey: "enums.analysisType.chlorine_gas", type: "chlorine_gas" },
      { labelKey: "menus.hclToAnolyte", type: "hcl" },
      { labelKey: "menus.leanCausticFeed", type: "caustic_feed" },
    ],
  },
  {
    titleKey: "menus.electrolyzer",
    scope: "electrolyzer",
    items: [
      { labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { labelKey: "enums.analysisType.chlorine_gas", type: "chlorine_gas" },
      { labelKey: "menus.hclAcidification", type: "hcl" },
    ],
  },
  {
    titleKey: "menus.groups",
    scope: "group",
    items: [
      { labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { labelKey: "enums.analysisType.chlorine_gas", type: "chlorine_gas" },
    ],
  },
  {
    titleKey: "menus.elements",
    scope: "element",
    items: [
      { labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { labelKey: "enums.analysisType.chlorine_gas", type: "chlorine_gas" },
    ],
  },
];

function AnalysisMenu() {
  const { t } = useI18n();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <AccessHub
      title={t("analyses.title")}
      extraButtons={
        <>
          <AccessBtn className="!w-auto px-3" href="/current-efficiency">
            {t("mainMenu.currentEfficiency")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-3" onClick={() => setImportOpen(true)}>
            {t("menus.importAnalyses")}
          </AccessBtn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((col) => (
          <div key={col.titleKey} className="access-sunken">
            <div className="access-col-title mb-3">{t(col.titleKey)}</div>
            <div className="flex flex-col gap-2">
              {col.items.map((item) => (
                <AccessBtn key={item.labelKey} href={`/analyses?type=${item.type}&scope=${col.scope}`}>
                  {t(item.labelKey)}
                </AccessBtn>
              ))}
            </div>
          </div>
        ))}
      </div>
      {importOpen ? <ImportAnalysesDialog onClose={() => setImportOpen(false)} /> : null}
    </AccessHub>
  );
}

function ImportAnalysesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => analysesApi.importLabExcel(file!),
    onSuccess: (data) => {
      setResult(t("analyses.importedSamples", { n: data.imported_samples }));
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="access-import-dialog">
        <div className="mb-3 flex items-center justify-between border-b border-[#808080] pb-1 text-[12px] font-bold">
          {t("analyses.importLabTitle")}
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="mb-3 text-[11px] text-[var(--win-muted)]">{t("analyses.importLabHelp")}</p>
        <label className="mb-3 block text-[12px]">
          {t("analyses.labExcelFile")}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="mt-1 block w-full text-[12px]"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {result ? (
          <div className="mb-3 border border-[#5fa85f] bg-[#d9f0d9] px-2 py-1 text-[12px] font-semibold text-[#0d5c0d]">
            {result}
          </div>
        ) : null}
        {mutation.isError ? (
          <div className="mb-3 text-[12px] text-red-700">{(mutation.error as Error).message}</div>
        ) : null}
        <div className="flex justify-between">
          <AccessBtn
            className="!w-auto px-4"
            onClick={() => mutation.mutate()}
            disabled={!file || mutation.isPending}
          >
            {mutation.isPending ? t("common.importing") : t("common.import")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-4" onClick={onClose}>
            {t("common.close")}
          </AccessBtn>
        </div>
      </div>
    </div>
  );
}

function AnalysisEntry() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("analyses");
  const searchParams = useSearchParams();
  const [analysisType, setAnalysisType] = useState(searchParams.get("type") || "");
  const [scope, setScope] = useState(searchParams.get("scope") || "");
  const [electrolyzer, setElectrolyzer] = useState("");
  const [editing, setEditing] = useState<AnalysisSample | null>(null);
  const [showForm, setShowForm] = useState(false);
  const metaQuery = useQuery({ queryKey: ["analyses", "meta"], queryFn: analysesApi.meta });
  const params: Record<string, unknown> = { limit: 500 };
  if (analysisType) params.analysis_type = analysisType;
  if (scope) params.scope = scope;
  if (electrolyzer) params.electrolyzer = electrolyzer;
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<AnalysisSample>(
    "analyses",
    analysesApi,
    params
  );
  const columns: Column<AnalysisSample>[] = [
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "analysis_type", header: t("fields.type"), render: (r) => t(`enums.analysisType.${r.analysis_type}`) },
    { key: "scope", header: t("fields.scopeValue"), render: (r) => t(`enums.scope.${r.scope}`) },
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.position") },
    { key: "group_nr", header: t("fields.groupNr") },
    {
      key: "parameters",
      header: t("analyses.parameters"),
      render: (r) =>
        Object.entries(r.parameters || {})
          .slice(0, 4)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "—",
    },
  ];

  return (
    <AccessFormWindow caption={t("analyses.title")} helpKey="analyses" backHref="/analyses" backLabel={t("analyses.title")}>
      <div className="mb-4 flex flex-wrap gap-3">
        <ExportButtons prefix="/analyses" params={params} filenameBase="analyses" />
        {editable && (
          <Button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            disabled={!metaQuery.data}
          >
            New
          </Button>
        )}
        <Select value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} className="max-w-[200px]">
          <option value="">{t("analyses.allTypes")}</option>
          {metaQuery.data?.types.map((ty) => (
            <option key={ty} value={ty}>
              {t(`enums.analysisType.${ty}`)}
            </option>
          ))}
        </Select>
        <Select value={scope} onChange={(e) => setScope(e.target.value)} className="max-w-[180px]">
          <option value="">{t("analyses.allScopes")}</option>
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {t(`enums.scope.${s}`)}
            </option>
          ))}
        </Select>
        <Input
          placeholder={t("analyses.filterElectrolyzer")}
          value={electrolyzer}
          onChange={(e) => setElectrolyzer(e.target.value)}
          className="max-w-[200px]"
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
          emptyTitle={t("analyses.noSamplesFound")}
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
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(row.id)}>
                      Delete
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}
      {metaQuery.data && (
        <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "Edit Analysis" : "New Analysis"} wide>
          <AnalysisForm
            meta={metaQuery.data}
            initial={editing}
            defaultType={analysisType}
            defaultScope={scope}
            onCancel={() => setShowForm(false)}
            submitting={createMutation.isPending || updateMutation.isPending}
            onSubmit={(payload) => {
              if (editing) updateMutation.mutate({ id: editing.id, payload }, { onSuccess: () => setShowForm(false) });
              else createMutation.mutate(payload as never, { onSuccess: () => setShowForm(false) });
            }}
          />
        </Modal>
      )}
    </AccessFormWindow>
  );
}

function AnalysisForm({
  meta,
  initial,
  defaultType,
  defaultScope,
  onSubmit,
  onCancel,
  submitting,
}: {
  meta: { types: string[]; parameter_units: Record<string, Record<string, string>> };
  initial: AnalysisSample | null;
  defaultType?: string;
  defaultScope?: string;
  onSubmit: (payload: Partial<AnalysisSample>) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const { t } = useI18n();
  const [analysisType, setAnalysisType] = useState(initial?.analysis_type || defaultType || meta.types[0]);
  const [scope, setScope] = useState(initial?.scope || defaultScope || "electrolyzer");
  const [electrolyzer, setElectrolyzer] = useState(initial?.electrolyzer || "");
  const [position, setPosition] = useState(initial?.position || "");
  const [groupNr, setGroupNr] = useState(initial?.group_nr || "");
  const [subPlant, setSubPlant] = useState(initial?.sub_plant || "");
  const [date, setDate] = useState(initial?.date?.slice(0, 10) || "");
  const [time, setTime] = useState(initial?.time || "");
  const [params, setParams] = useState<Record<string, string>>(() => {
    const initialParams: Record<string, string> = {};
    if (initial?.parameters) {
      for (const [k, v] of Object.entries(initial.parameters)) initialParams[k] = String(v);
    }
    return initialParams;
  });
  const unitMap = meta.parameter_units[analysisType] || {};

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parameters: Record<string, number> = {};
    for (const key of Object.keys(unitMap)) {
      const raw = params[key];
      if (raw !== undefined && raw !== "") parameters[key] = Number(raw);
    }
    onSubmit({
      analysis_type: analysisType,
      scope,
      electrolyzer: electrolyzer || null,
      position: position || null,
      group_nr: groupNr || null,
      sub_plant: subPlant || null,
      date: date || null,
      time: time || null,
      parameters,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <Label>{t("analyses.analysisType")}</Label>
          <Select value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} required>
            {meta.types.map((ty) => (
              <option key={ty} value={ty}>
                {t(`enums.analysisType.${ty}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("analyses.scope")}</Label>
          <Select value={scope} onChange={(e) => setScope(e.target.value)} required>
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`enums.scope.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("fields.date")}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label>{t("fields.time")}</Label>
          <Input value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <Label>{t("fields.electrolyzer")}</Label>
          <Input value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)} />
        </div>
        <div>
          <Label>{t("fields.position")}</Label>
          <Input value={position} onChange={(e) => setPosition(e.target.value)} />
        </div>
        <div>
          <Label>{t("fields.groupNr")}</Label>
          <Input value={groupNr} onChange={(e) => setGroupNr(e.target.value)} />
        </div>
        <div>
          <Label>{t("fields.subPlant")}</Label>
          <Input value={subPlant} onChange={(e) => setSubPlant(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Object.entries(unitMap).map(([key, unit]) => (
          <div key={key}>
            <Label>
              {key} {unit && <span>({unit})</span>}
            </Label>
            <Input
              type="number"
              step="any"
              value={params[key] ?? ""}
              onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function AnalysesInner() {
  const searchParams = useSearchParams();
  if (searchParams.get("type") || searchParams.get("scope")) return <AnalysisEntry />;
  return <AnalysisMenu />;
}

export default function AnalysesPage() {
  return (
    <Suspense>
      <AnalysesInner />
    </Suspense>
  );
}
