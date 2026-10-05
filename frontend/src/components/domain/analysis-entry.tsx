"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { analysesApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { AnalysisSample } from "@/lib/types";
import {
  analysisForm,
  brineFieldKey,
  buildParameters,
  calculateBrineHclConcentration,
  cleanAnalysisTime,
  normalizeAnalysisScope,
  readDraftNumber,
  readParam,
  type AnalysisField,
  type AnalysisFormSpec,
  type AnalysisIdentity,
} from "@/lib/analysis-forms";
import { AccessFormWindow, AccessNav } from "@/components/layout/access-form";
import { Input } from "@/components/ui/input";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { type Column } from "@/components/ui/data-table";
import { DatasheetPane } from "@/components/ui/datasheet-pane";
import { ErrorState } from "@/components/ui/spinner";
import { ExportButtons } from "@/components/domain/export-buttons";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";

type Draft = {
  electrolyzer: string;
  position: string;
  group: string;
  train: string;
  date: string;
  time: string;
  params: Record<string, string>;
};

function emptyDraft(form: AnalysisFormSpec): Draft {
  const params: Record<string, string> = {};
  for (const field of form.fields) params[field.key] = "";
  return { electrolyzer: "", position: "", group: "", train: "", date: "", time: "", params };
}

function draftFrom(record: AnalysisSample | null, form: AnalysisFormSpec): Draft {
  if (!record) return emptyDraft(form);
  const params: Record<string, string> = {};
  for (const field of form.fields) params[field.key] = readParam(record.parameters, field);
  return {
    electrolyzer: record.electrolyzer || "",
    position: record.position || "",
    group: record.group_nr || "",
    train: record.sub_plant || "",
    date: record.date ? record.date.slice(0, 10) : "",
    time: cleanAnalysisTime(record.time),
    params,
  };
}

function FieldLine({
  field,
  value,
  disabled,
  onChange,
  label,
  basis,
  compact,
}: {
  field: AnalysisField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  label: string;
  basis: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[9.5rem_7.5rem_6.5rem] items-start gap-x-2 gap-y-0.5"
          : "grid grid-cols-[10.5rem_8.5rem_7.5rem] items-start gap-x-2 gap-y-0.5"
      }
    >
      <label className="pt-1.5 text-right text-[12px]">{label}</label>
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      <span className="pt-1 text-[11px] leading-tight text-[var(--win-muted)]">
        {field.unit ? <span className="block">[{field.unit}]</span> : null}
        {field.range ? <span className="block font-medium text-[var(--win-text)]">{field.range}</span> : null}
        {field.basis ? <span className="block">{basis}</span> : null}
      </span>
    </div>
  );
}

export function AnalysisEntry({ analysisType, scope }: { analysisType: string; scope: string }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  useCalendar();
  const editable = canEdit("analyses");
  const normalizedScope = normalizeAnalysisScope(scope);
  const form = analysisForm(analysisType, normalizedScope);
  const queryClient = useQueryClient();
  const exportColumns = useMemo(() => {
    if (!form) return undefined;
    const identityLabels: Record<string, string> = {
      id: "ID",
      analysis_type: t("analyses.analysisType"),
      scope: t("analyses.scope"),
      date: t("fields.date"),
      time: t("fields.time"),
      electrolyzer: t("fields.electrolyzer"),
      position: t("fields.position"),
      group_nr: t("fields.group"),
      sub_plant: t("fields.subPlant"),
    };
    const cols: { key: string; label: string }[] = [
      { key: "id", label: identityLabels.id },
      { key: "analysis_type", label: identityLabels.analysis_type },
      { key: "scope", label: identityLabels.scope },
    ];
    for (const id of form.identity) {
      const key = id === "train" ? "sub_plant" : id === "group" ? "group_nr" : id;
      cols.push({ key, label: identityLabels[key] || key });
    }
    for (const field of form.fields) {
      const label = field.labelKey ? t(field.labelKey) : field.label;
      const withUnit = field.unit ? `${field.key} [${field.unit.replace(/^\[|\]$/g, "")}]` : field.key;
      cols.push({ key: withUnit, label: field.unit ? `${label} [${field.unit.replace(/^\[|\]$/g, "")}]` : label });
    }
    // de-dupe
    const seen = new Set<string>();
    return cols.filter((col) => {
      if (seen.has(col.key)) return false;
      seen.add(col.key);
      return true;
    });
  }, [form, t]);

  const params: Record<string, unknown> = { limit: 500, analysis_type: analysisType, scope: normalizedScope };
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<
    AnalysisSample,
    Partial<AnalysisSample>
  >("analyses", analysesApi, params);
  const [view, setView] = useState<"form" | "datasheet">("form");
  const [index, setIndex] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [find, setFind] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [booted, setBooted] = useState(false);

  const rows = listQuery.data ?? [];
  const filtered = useMemo(() => {
    const needle = find.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
  }, [rows, find]);

  const current = isNew ? null : filtered[index] ?? null;
  const recordKey = isNew ? "new" : current ? String(current.id) : "empty";

  useEffect(() => {
    if (!form) return;
    setDraft(draftFrom(current, form));
    // Reload the draft only when the selected record changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordKey, form]);

  useEffect(() => {
    if (listQuery.isLoading || booted) return;
    if (rows.length === 0) setIsNew(true);
    setBooted(true);
  }, [listQuery.isLoading, booted, rows.length]);

  useEffect(() => {
    if (pendingId == null) return;
    const found = filtered.findIndex((row) => row.id === pendingId);
    if (found >= 0) {
      setIndex(found);
      setIsNew(false);
      setPendingId(null);
    }
  }, [filtered, pendingId]);

  const title = form ? t(form.titleKey) : t("analyses.title");

  function setParam(key: string, value: string) {
    setDraft((prev) => (prev ? { ...prev, params: { ...prev.params, [key]: value } } : prev));
  }

  async function calculateBrineHcl() {
    if (!form || !draft || analysisType !== "pure_brine") return;
    const date = draft.date.trim();
    const electrolyzer = draft.electrolyzer.trim();
    if (!electrolyzer && !date) {
      window.alert(t("analyses.calcNeedElectrolyzerDate"));
      return;
    }
    if (!date) {
      window.alert(t("analyses.calcNeedDate"));
      return;
    }

    // Access reads tblAnalyseHClElektrolyseur (flow rate, HCl wt.%, Dichte).
    const hclRows = await analysesApi.list({
      analysis_type: "hcl",
      scope: "electrolyzer",
      electrolyzer: electrolyzer || undefined,
      limit: 500,
    });
    const day = date.slice(0, 10);
    const sameDay = hclRows.filter((row) => (row.date || "").slice(0, 10) === day);
    const hcl =
      electrolyzer
        ? sameDay.find((row) => (row.electrolyzer || "").trim() === electrolyzer) || sameDay[0]
        : sameDay.length === 1
          ? sameDay[0]
          : undefined;
    if (!hcl) {
      window.alert(electrolyzer || sameDay.length === 0 ? t("analyses.calcNoHclSample") : t("analyses.calcNeedElectrolyzer"));
      return;
    }
    const bag = hcl.parameters || {};
    const num = (keys: string[]) => {
      for (const key of keys) {
        const raw = bag[key];
        if (raw === undefined || raw === null || String(raw) === "") continue;
        const n = Number(String(raw).replace(",", "."));
        if (Number.isFinite(n)) return n;
      }
      return null;
    };
    const vHclLh = num(["flow rate", "flow_rate"]);
    const cHclWtPct = num(["HCl"]);
    const rhoHclGl = num(["Dichte", "density", "density_20C"]);
    if (vHclLh == null) {
      window.alert(t("analyses.calcNoHclFlow"));
      return;
    }
    if (cHclWtPct == null) {
      window.alert(t("analyses.calcNoHclConc"));
      return;
    }
    if (rhoHclGl == null) {
      window.alert(t("analyses.calcNoHclDensity"));
      return;
    }

    const flowKey = brineFieldKey(form, "flow rate");
    const naohKey = brineFieldKey(form, "NaOH");
    const na2co3Key = brineFieldKey(form, "Na2CO3");
    const hclKey = brineFieldKey(form, "HCl");
    const brineFlowM3h = readDraftNumber(draft.params, flowKey);
    const naohGl = readDraftNumber(draft.params, naohKey);
    const na2co3Gl = readDraftNumber(draft.params, na2co3Key);
    if (brineFlowM3h == null) {
      window.alert(t("analyses.calcNeedBrineFlow"));
      return;
    }
    if (na2co3Gl == null) {
      window.alert(t("analyses.calcNeedNa2CO3"));
      return;
    }
    if (naohGl == null) {
      window.alert(t("analyses.calcNeedNaOH"));
      return;
    }
    if ((draft.params[hclKey] || "").trim() && !window.confirm(t("analyses.calcOverwriteHcl"))) return;

    const result = calculateBrineHclConcentration({
      vHclLh,
      cHclWtPct,
      rhoHclGl,
      brineFlowM3h,
      naohGl,
      na2co3Gl,
    });
    if (!Number.isFinite(result)) {
      window.alert(t("analyses.calcNoHclSample"));
      return;
    }
    const rounded = Math.round((result + Number.EPSILON) * 1e6) / 1e6;
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            params: {
              ...prev.params,
              [hclKey]: String(rounded),
              [naohKey]: "0",
              [na2co3Key]: "0",
            },
          }
        : prev
    );
  }

  function save() {
    if (!form || !draft) return;
    const shown = new Set(form.identity);
    const payload: Partial<AnalysisSample> = {
      analysis_type: analysisType,
      scope: normalizedScope,
      date: draft.date || null,
      time: cleanAnalysisTime(draft.time) || null,
      electrolyzer: shown.has("electrolyzer") ? draft.electrolyzer.trim() || null : isNew ? null : current?.electrolyzer ?? null,
      position: shown.has("position") ? draft.position.trim() || null : isNew ? null : current?.position ?? null,
      group_nr: shown.has("group") ? draft.group.trim() || null : isNew ? null : current?.group_nr ?? null,
      sub_plant: shown.has("train") ? draft.train.trim() || null : isNew ? null : current?.sub_plant ?? null,
      parameters: buildParameters(current?.parameters, form, draft.params),
    };
    if (current && !isNew) {
      updateMutation.mutate({ id: current.id, payload });
    } else {
      setFind("");
      createMutation.mutate(payload, {
        onSuccess: (created) => setPendingId(created.id),
      });
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;
  const error = (createMutation.error || updateMutation.error || removeMutation.error) as Error | null;

  const columns: Column<AnalysisSample>[] = form
    ? [
        ...identityColumns(form, t),
        ...form.fields.map((field) => {
          const label = fieldLabel(field, t);
          const unit = field.unit ? ` [${field.unit.replace(/^\[|\]$/g, "")}]` : "";
          const range = field.range ? ` ${field.range}` : "";
          return {
            key: field.key,
            header: `${label}${unit}${range}`,
            render: (row: AnalysisSample) => readParam(row.parameters, field) || "—",
            filterText: (row: AnalysisSample) => readParam(row.parameters, field),
          };
        }),
      ]
    : [];

  if (!form) {
    return (
      <AccessFormWindow caption={t("analyses.title")} backHref="/analyses" backLabel={t("analyses.title")}>
        <p className="text-[12px]">{t("analyses.unknownForm")}</p>
      </AccessFormWindow>
    );
  }

  return (
    <AccessFormWindow
      caption={title}
      helpKey="analyses"
      backHref="/analyses"
      backLabel={t("analyses.title")}
      commands={
        <Link href="/" className="access-menu-btn access-hub-menu-btn">
          {t("common.mainMenu")}
        </Link>
      }
      nav={
        <AccessNav
          index={isNew ? filtered.length : index}
          total={filtered.length}
          isNew={isNew}
          canEdit={editable}
          view={view}
          onView={setView}
          hideFind={view === "datasheet"}
          findValue={find}
          onFind={(value) => {
            setFind(value);
            setIndex(0);
            setIsNew(false);
          }}
          saving={saving}
          onFirst={() => {
            setIsNew(false);
            setIndex(0);
          }}
          onPrev={() => {
            if (isNew) {
              setIsNew(false);
              setIndex(Math.max(0, filtered.length - 1));
              return;
            }
            setIndex((i) => Math.max(0, i - 1));
          }}
          onNext={() => {
            setIsNew(false);
            setIndex((i) => Math.min(Math.max(filtered.length - 1, 0), i + 1));
          }}
          onLast={() => {
            setIsNew(false);
            setIndex(Math.max(0, filtered.length - 1));
          }}
          onNew={
            editable
              ? () => {
                  setIsNew(true);
                  setDraft(emptyDraft(form));
                }
              : undefined
          }
          onSave={editable ? save : undefined}
          onDelete={
            editable && current
              ? () => {
                  if (!window.confirm(t("analyses.confirmDelete", { type: title }))) return;
                  const id = current.id;
                  removeMutation.mutate(id, {
                    onSuccess: () => {
                      setIndex((i) => Math.max(0, i - 1));
                      if (filtered.length <= 1) setIsNew(true);
                      queryClient.invalidateQueries({ queryKey: ["analyses"] });
                    },
                  });
                }
              : undefined
          }
        />
      }
    >
      <div className="mb-3">
        <ExportButtons
          prefix="/analyses"
          params={params}
          filenameBase={`analysis-${analysisType}-${normalizedScope}`}
          exportColumns={exportColumns}
        />
      </div>
      {listQuery.isLoading ? <div className="text-[12px]">{t("common.loading")}</div> : null}
      {listQuery.isError ? <ErrorState message={(listQuery.error as Error).message} /> : null}
      {error ? <div className="mb-3 text-[12px] text-red-700">{error.message}</div> : null}
      {view === "datasheet" ? (
        <DatasheetPane
          columns={columns}
          rows={rows}
          keyField="id"
          selectedKey={current?.id ?? null}
          canEdit={editable}
          emptyTitle={t("analyses.noSamplesFound")}
          onSelect={(row) => {
            const found = rows.findIndex((item) => item.id === row.id);
            if (found >= 0) {
              setIndex(found);
              setIsNew(false);
            }
          }}
          onOpen={(row) => {
            const found = rows.findIndex((item) => item.id === row.id);
            if (found >= 0) {
              setIndex(found);
              setIsNew(false);
              setView("form");
            }
          }}
          onDelete={
            editable
              ? (row) => {
                  if (!window.confirm(t("analyses.confirmDelete", { type: title }))) return;
                  removeMutation.mutate(row.id, {
                    onSuccess: () => {
                      setIndex((i) => Math.max(0, i - 1));
                      if (rows.length <= 1) setIsNew(true);
                      queryClient.invalidateQueries({ queryKey: ["analyses"] });
                    },
                  });
                }
              : undefined
          }
        />
      ) : draft ? (
        <AnalysisRecordForm
          form={form}
          draft={draft}
          disabled={!editable}
          basis={t("analyses.basis")}
          labelFor={(field) => fieldLabel(field, t)}
          identityLabel={(key) => identityLabel(key, t)}
          onIdentity={(key, value) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))}
          onParam={setParam}
          calculateLabel={analysisType === "pure_brine" ? t("analyses.calculateHcl") : null}
          onCalculate={analysisType === "pure_brine" && editable ? () => void calculateBrineHcl() : undefined}
        />
      ) : null}
    </AccessFormWindow>
  );
}

function fieldLabel(field: AnalysisField, t: (path: string) => string) {
  return field.labelKey ? t(field.labelKey) : field.label;
}

function identityLabel(key: AnalysisIdentity, t: (path: string) => string) {
  if (key === "electrolyzer") return t("analyses.identity.electrolyser");
  if (key === "position") return t("analyses.identity.pos");
  if (key === "group") return t("analyses.identity.group");
  if (key === "train") return t("analyses.identity.train");
  if (key === "date") return t("fields.date");
  return t("fields.time");
}

function identityColumns(form: AnalysisFormSpec, t: (path: string) => string): Column<AnalysisSample>[] {
  const cols: Column<AnalysisSample>[] = [];
  if (form.identity.includes("electrolyzer")) cols.push({ key: "electrolyzer", header: t("analyses.identity.electrolyser") });
  if (form.identity.includes("position")) cols.push({ key: "position", header: t("analyses.identity.pos") });
  if (form.identity.includes("group")) cols.push({ key: "group_nr", header: t("analyses.identity.group") });
  if (form.identity.includes("train")) cols.push({ key: "sub_plant", header: t("analyses.identity.train") });
  if (form.identity.includes("date")) cols.push({ key: "date", header: t("fields.date"), render: (row) => formatDate(row.date) });
  if (form.identity.includes("time")) {
    cols.push({
      key: "time",
      header: t("fields.time"),
      render: (row) => cleanAnalysisTime(row.time) || "—",
      filterText: (row) => cleanAnalysisTime(row.time),
    });
  }
  return cols;
}

function AnalysisRecordForm({
  form,
  draft,
  disabled,
  basis,
  labelFor,
  identityLabel,
  onIdentity,
  onParam,
  calculateLabel,
  onCalculate,
}: {
  form: AnalysisFormSpec;
  draft: Draft;
  disabled: boolean;
  basis: string;
  labelFor: (field: AnalysisField) => string;
  identityLabel: (key: AnalysisIdentity) => string;
  onIdentity: (key: "electrolyzer" | "position" | "group" | "train" | "date" | "time", value: string) => void;
  onParam: (key: string, value: string) => void;
  calculateLabel?: string | null;
  onCalculate?: () => void;
}) {
  const identityValue: Record<AnalysisIdentity, string> = {
    electrolyzer: draft.electrolyzer,
    position: draft.position,
    group: draft.group,
    train: draft.train,
    date: draft.date,
    time: draft.time,
  };
  const compact = form.layout === "split";
  const lines = (fields: AnalysisField[]) =>
    fields.map((field) => (
      <FieldLine
        key={field.key}
        field={field}
        label={labelFor(field)}
        value={draft.params[field.key] ?? ""}
        disabled={disabled}
        basis={basis}
        compact={compact}
        onChange={(value) => onParam(field.key, value)}
      />
    ));

  return (
    <div className="access-sunken p-4">
      <div className="mb-4 max-w-md space-y-2">
        {form.identity.map((key) => {
          const raw = identityValue[key];
          const timeValue = key === "time" ? (cleanAnalysisTime(raw).slice(0, 5) || "") : raw;
          return (
            <div key={key} className="grid grid-cols-[10.5rem_8.5rem] items-center gap-2">
              <label className="text-right text-[12px]">{identityLabel(key)}</label>
              {key === "electrolyzer" ? (
                <ElectrolyzerCombo
                  variant="access"
                  className="w-full"
                  value={raw}
                  disabled={disabled}
                  onChange={(v) => onIdentity(key, v)}
                />
              ) : (
                <Input
                  type={key === "date" ? "date" : key === "time" ? "time" : "text"}
                  step={key === "time" ? 60 : undefined}
                  value={key === "time" ? timeValue : raw}
                  disabled={disabled}
                  onChange={(e) => {
                    if (key === "time") {
                      const v = e.target.value;
                      onIdentity(key, v ? (v.length === 5 ? `${v}:00` : v) : "");
                      return;
                    }
                    onIdentity(key, e.target.value);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {form.layout === "split" ? (
        <div className="grid grid-cols-2 items-start gap-x-6 gap-y-1">
          <div className="min-w-0 space-y-1">{lines(form.fields.filter((field) => field.side !== "right"))}</div>
          <div className="min-w-0 space-y-1">{lines(form.fields.filter((field) => field.side === "right"))}</div>
        </div>
      ) : (
        <div className="max-w-xl space-y-2">{lines(form.fields)}</div>
      )}
      {calculateLabel && onCalculate ? (
        <div className="mt-4">
          <button type="button" className="access-menu-btn px-3 py-1 text-[12px]" disabled={disabled} onClick={onCalculate}>
            {calculateLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
