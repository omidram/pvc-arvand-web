"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { analysesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { AnalysisSample } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

const SCOPES = ["plant", "sub_plant", "electrolyzer", "group", "element"];

export default function AnalysesPage() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("analyses");
  const [analysisType, setAnalysisType] = useState("");
  const [scope, setScope] = useState("");
  const [electrolyzer, setElectrolyzer] = useState("");
  const [editing, setEditing] = useState<AnalysisSample | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

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
      render: (r) => (
        <span className="text-xs text-[var(--win-muted)]">
          {Object.entries(r.parameters || {})
            .slice(0, 4)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "—"}
        </span>
      ),
    },
  ];

  function handleDelete(row: AnalysisSample) {
    if (confirm(t("analyses.confirmDelete", { type: row.analysis_type }))) removeMutation.mutate(row.id);
  }

  return (
    <div>
      <PageHeader
        title={t("analyses.title")}
        description={t("analyses.description")}
        helpKey="analyses"
        actions={
          <>
            <ExportButtons prefix="/analyses" params={params} filenameBase="analyses" />
            {editable && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Upload size={16} /> Excel
              </Button>
            )}
            {editable && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
                disabled={!metaQuery.data}
              >
                <Plus size={16} /> {t("analyses.newAnalysis")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
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

      {metaQuery.data && (
        <Modal
          open={showForm}
          onClose={() => setShowForm(false)}
          title={editing ? t("analyses.editAnalysis") : t("analyses.newAnalysisTitle")}
          wide
        >
          <AnalysisForm
            meta={metaQuery.data}
            initial={editing}
            onCancel={() => setShowForm(false)}
            submitting={createMutation.isPending || updateMutation.isPending}
            onSubmit={(payload) => {
              if (editing) {
                updateMutation.mutate({ id: editing.id, payload }, { onSuccess: () => setShowForm(false) });
              } else {
                updateMutation.reset();
                createMutation.mutate(payload as never, { onSuccess: () => setShowForm(false) });
              }
            }}
          />
        </Modal>
      )}
      {showImport && <ImportLabModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function ImportLabModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => analysesApi.importLabExcel(file!),
    onSuccess: (data) => {
      setResult(String(data.imported_samples));
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
  });
  return (
    <Modal open onClose={onClose} title="Import lab Excel">
      <div className="space-y-3">
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {result && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Imported {result} samples</div>}
        {mutation.isError && <ErrorState message={(mutation.error as Error).message} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>
          <Button disabled={!file || mutation.isPending} onClick={() => mutation.mutate()}>{t("common.import")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AnalysisForm({
  meta,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  meta: { types: string[]; parameter_units: Record<string, Record<string, string>> };
  initial: AnalysisSample | null;
  onSubmit: (payload: Partial<AnalysisSample>) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const { t } = useI18n();
  const [analysisType, setAnalysisType] = useState(initial?.analysis_type || meta.types[0]);
  const [scope, setScope] = useState(initial?.scope || "electrolyzer");
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
          <Label>
            {t("analyses.analysisType")} <span className="text-[var(--win-danger)]">*</span>
          </Label>
          <Select value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} required>
            {meta.types.map((ty) => (
              <option key={ty} value={ty}>
                {t(`enums.analysisType.${ty}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>
            {t("analyses.scope")} <span className="text-[var(--win-danger)]">*</span>
          </Label>
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
          <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="HH:MM" />
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

      <div className="border-t-2 border-[var(--win-face-dark)] pt-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--win-muted)]">{t("analyses.parameters")}</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Object.entries(unitMap).map(([key, unit]) => (
            <div key={key}>
              <Label>
                {key} {unit && <span className="text-[#6b6b6b]">({unit})</span>}
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
      </div>

      <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-4">
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
