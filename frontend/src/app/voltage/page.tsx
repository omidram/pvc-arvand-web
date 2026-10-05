"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calculator, Upload } from "lucide-react";
import Link from "next/link";
import { ImportProgressBar } from "@/components/domain/import-progress";
import type { ImportProgress } from "@/lib/endpoints";
import {
  voltageNormalizationsApi,
  voltageReadingsApi,
  voltageCalcApi,
  currentEfficiencyEntriesApi,
  currentEfficiencyCalcApi,
  subPlantsApi,
  arrangementsApi,
  correctionFactorsApi,
  elementsApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { ElectrolyzerNormalization, VoltageReading, CurrentEfficiencyEntry } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { AccessBtn, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState, type RadioGroupDef } from "@/components/layout/access-report";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { AccessFields, accessPayload, valuesFromRecord } from "@/components/ui/access-fields";
import {
  ElectrolyzerCombo,
  electrolyzerFieldOptions,
  useElectrolyzerNames,
} from "@/components/ui/electrolyzer-combo";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";
import { DateInput } from "@/components/ui/date-input";

type T = ReturnType<typeof useI18n>["t"];
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

/** Access form captions (Datenerfassung / Spannungen) — keep wording exact. */
const ACCESS_VOLTAGE = {
  electrolyser: "Electrolyser",
  date: "Date",
  time: "Time",
  iTotal: "I Total",
  iGesamt: "I Gesamt",
  tAn: "t An",
  tKa: "t Ka",
  uTotal: "U Total",
  noElements: "No. of Elements",
  position: "Position",
  uiV: "Ui [V]",
  ukV: "Uk [V]",
  umV: "Um [V]",
  normalization: "Normierung",
} as const;

function accessTime(value: string | null | undefined): string {
  if (!value) return "—";
  const text = String(value).trim();
  if (!text) return "—";
  // ISO datetime → HH:MM:SS ; already a clock string → keep
  const iso = text.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (iso) return iso[1].length === 5 ? `${iso[1]}:00` : iso[1];
  const clock = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (clock) return clock[1];
  return text;
}

function accessPosition(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isNaN(n) && Number.isFinite(n)) return String(Math.trunc(n));
  return String(value);
}

function normalizationFields(t: T, electrolyzerOptions: FieldDef["options"]): FieldDef[] {
  return [
    { name: "normalization_nr", label: ACCESS_VOLTAGE.normalization, type: "number" },
    {
      name: "electrolyzer",
      label: ACCESS_VOLTAGE.electrolyser,
      type: "combo",
      required: true,
      options: electrolyzerOptions,
    },
    { name: "date", label: ACCESS_VOLTAGE.date, type: "date" },
    { name: "time", label: ACCESS_VOLTAGE.time },
    { name: "total_current", label: `${ACCESS_VOLTAGE.iTotal} [kA]`, type: "number", step: "0.01" },
    { name: "anolyte_temp", label: `${ACCESS_VOLTAGE.tAn} [°C]`, type: "number", step: "0.1" },
    { name: "catholyte_temp", label: `${ACCESS_VOLTAGE.tKa} [°C]`, type: "number", step: "0.1" },
    { name: "zero_voltage", label: t("fields.zeroVoltage"), type: "number", step: "0.001" },
    { name: "total_voltage", label: `${ACCESS_VOLTAGE.uTotal} [V]`, type: "number", step: "0.01" },
    { name: "element_count", label: ACCESS_VOLTAGE.noElements, type: "number" },
    { name: "cl2_pct", label: t("fields.cl2Pct"), type: "number", step: "0.01" },
    { name: "h2_pct", label: t("fields.h2Pct"), type: "number", step: "0.01" },
    { name: "delta_p", label: t("fields.deltaP"), type: "number", step: "0.01" },
  ];
}

function readingFields(t: T, electrolyzerOptions: FieldDef["options"]): FieldDef[] {
  return [
    { name: "normalization_nr", label: ACCESS_VOLTAGE.normalization, type: "number" },
    {
      name: "electrolyzer",
      label: ACCESS_VOLTAGE.electrolyser,
      type: "combo",
      required: true,
      options: electrolyzerOptions,
    },
    { name: "position", label: ACCESS_VOLTAGE.position },
    { name: "element_nr", label: t("fields.elementNr") },
    { name: "date", label: ACCESS_VOLTAGE.date, type: "date" },
    { name: "time", label: ACCESS_VOLTAGE.time },
    { name: "voltage", label: ACCESS_VOLTAGE.uiV, type: "number", step: "0.001" },
    { name: "voltage_prev", label: ACCESS_VOLTAGE.ukV, type: "number", step: "0.001" },
    { name: "standardized_voltage", label: ACCESS_VOLTAGE.umV, type: "number", step: "0.001" },
  ];
}

function ceFields(t: T, scopeRefField: FieldDef): FieldDef[] {
  return [
    {
      name: "scope",
      label: t("fields.scopeValue"),
      type: "select",
      required: true,
      options: [
        { label: t("enums.scope.plant"), value: "plant" },
        { label: t("enums.scope.electrolyzer"), value: "electrolyzer" },
        { label: t("enums.scope.group"), value: "group" },
      ],
    },
    scopeRefField,
    { name: "position", label: t("fields.position") },
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "value_pct", label: t("fields.currentEfficiencyPct"), type: "number", step: "0.01" },
  ];
}

function CeEntryForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: CurrentEfficiencyEntry | null;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
}) {
  const { t } = useI18n();
  const elNames = useElectrolyzerNames();
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    valuesFromRecord(ceFields(t, { name: "scope_ref", label: t("fields.scopeReference"), type: "text" }), initial ?? null)
  );

  const fields = useMemo((): FieldDef[] => {
    const scopeRef: FieldDef =
      values.scope === "electrolyzer"
        ? {
            name: "scope_ref",
            label: t("fields.scopeReference"),
            type: "combo",
            options: electrolyzerFieldOptions(elNames),
          }
        : { name: "scope_ref", label: t("fields.scopeReference"), type: "text" };
    return ceFields(t, scopeRef);
  }, [t, elNames, values.scope]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(accessPayload(fields, values));
      }}
      className="space-y-3"
    >
      <AccessFields fields={fields} values={values} onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))} />
      <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-3">
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

function NormalizationsTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ElectrolyzerNormalization | null>(null);
  const electrolyzerNames = useElectrolyzerNames();
  const normFields = useMemo(
    () => normalizationFields(t, electrolyzerFieldOptions(electrolyzerNames)),
    [t, electrolyzerNames]
  );
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrolyzerNormalization>(
    "voltage-normalizations",
    voltageNormalizationsApi,
    { limit: 10000 }
  );

  const columns: Column<ElectrolyzerNormalization>[] = [
    { key: "electrolyzer", header: ACCESS_VOLTAGE.electrolyser, render: (r) => formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "—" },
    { key: "date", header: ACCESS_VOLTAGE.date, render: (r) => formatDate(r.date) },
    { key: "time", header: ACCESS_VOLTAGE.time, render: (r) => accessTime(r.time) },
    { key: "total_current", header: `${ACCESS_VOLTAGE.iTotal} [kA]`, render: (r) => formatNumber(r.total_current) },
    { key: "anolyte_temp", header: `${ACCESS_VOLTAGE.tAn} [°C]`, render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: `${ACCESS_VOLTAGE.tKa} [°C]`, render: (r) => formatNumber(r.catholyte_temp) },
    { key: "total_voltage", header: `${ACCESS_VOLTAGE.uTotal} [V]`, render: (r) => formatNumber(r.total_voltage) },
    { key: "element_count", header: ACCESS_VOLTAGE.noElements },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <ExportButtons prefix="/voltage-normalizations" filenameBase="voltage-normalizations" />
        {editable && (
          <Button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus size={16} /> {t("voltage.newNormalization")}
          </Button>
        )}
      </div>
      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data}
          keyField="id"
          isLoading={listQuery.isLoading}
          emptyTitle={t("voltage.noNormalizations")}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(t("voltage.confirmDeleteNormalization")) && removeMutation.mutate(row.id)}
                    >
                      <Trash2 size={14} className="text-[var(--win-danger)]" />
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("voltage.editNormalization") : t("voltage.newNormalizationTitle")}
        wide
      >
        <ResourceForm<ElectrolyzerNormalization>
          fields={normFields}
          initialValues={editing ?? undefined}
          onSubmit={(values) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
            } else {
              createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
            }
          }}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}

function ReadingsTab() {
  const { t } = useI18n();
  const { canEdit, isAdmin } = useAuth();
  const editable = canEdit("voltage");
  const searchParams = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VoltageReading | null>(null);
  const [showImport, setShowImport] = useState(() => searchParams.get("import") === "1");
  const electrolyzerNames = useElectrolyzerNames();
  const [filterEl, setFilterEl] = useState(() => formatElectrolyzer(searchParams.get("electrolyzer")) || "");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTill, setFilterTill] = useState("");
  const [applied, setApplied] = useState({
    electrolyzer: formatElectrolyzer(searchParams.get("electrolyzer")) || "",
    date_from: "",
    date_till: "",
  });

  const readingFormFields = useMemo(
    () => readingFields(t, electrolyzerFieldOptions(electrolyzerNames)),
    [t, electrolyzerNames]
  );
  const listParams = useMemo(() => {
    const params: Record<string, unknown> = { limit: 500 };
    if (applied.electrolyzer) params.electrolyzer = applied.electrolyzer;
    if (applied.date_from) params.date_from = applied.date_from;
    if (applied.date_till) params.date_till = applied.date_till;
    return params;
  }, [applied]);

  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<VoltageReading>(
    "voltage-readings",
    voltageReadingsApi,
    listParams
  );

  useEffect(() => {
    if (searchParams.get("import") === "1") setShowImport(true);
  }, [searchParams]);

  useEffect(() => {
    if (!filterEl && electrolyzerNames[0]) {
      setFilterEl(electrolyzerNames[0]);
      setApplied((prev) => ({ ...prev, electrolyzer: electrolyzerNames[0] }));
    }
  }, [filterEl, electrolyzerNames]);

  const rows = useMemo(
    () =>
      (listQuery.data || []).map((row) => ({
        ...row,
        electrolyzer: formatElectrolyzer(row.electrolyzer) || row.electrolyzer,
      })),
    [listQuery.data]
  );

  // Access Spannungen order: Electrolyser, Position, Date, Time, Ui [V], Uk [V]
  const columns: Column<VoltageReading>[] = [
    { key: "electrolyzer", header: ACCESS_VOLTAGE.electrolyser },
    { key: "position", header: ACCESS_VOLTAGE.position, render: (r) => accessPosition(r.position) },
    { key: "date", header: ACCESS_VOLTAGE.date, render: (r) => formatDate(r.date) },
    { key: "time", header: ACCESS_VOLTAGE.time, render: (r) => accessTime(r.time) },
    { key: "voltage", header: ACCESS_VOLTAGE.uiV, render: (r) => formatNumber(r.voltage, 3) },
    { key: "voltage_prev", header: ACCESS_VOLTAGE.ukV, render: (r) => formatNumber(r.voltage_prev, 3) },
    {
      key: "standardized_voltage",
      header: ACCESS_VOLTAGE.umV,
      render: (r) => formatNumber(r.standardized_voltage, 3),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3 border border-[#808080] bg-[#d4d0c8] p-2 text-[12px]">
        <label className="flex flex-col gap-1 font-bold">
          <span>{t("menus.electrolyzer")}</span>
          <ElectrolyzerCombo
            variant="access"
            className="w-[110px] font-normal"
            value={filterEl}
            onChange={setFilterEl}
            extraOptions={electrolyzerNames}
          />
        </label>
        <label className="flex flex-col gap-1 font-bold">
          <span>{t("statistics.dateFrom")}</span>
          <DateInput
            className="access-inset-field w-[130px] font-normal"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 font-bold">
          <span>{t("statistics.dateTill")}</span>
          <DateInput
            className="access-inset-field w-[130px] font-normal"
            value={filterTill}
            onChange={(e) => setFilterTill(e.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          onClick={() =>
            setApplied({
              electrolyzer: formatElectrolyzer(filterEl) || filterEl,
              date_from: filterFrom,
              date_till: filterTill,
            })
          }
        >
          {t("menus.updateDisplay")}
        </Button>
        <span className="text-[11px] text-[#404040]">
          {t("voltage.readingsBrowseHint", { n: rows.length })}
        </span>
      </div>
      <div className="mb-3 flex justify-end gap-2">
        <ExportButtons prefix="/voltage-readings" filenameBase="voltage-readings" params={listParams} />
        {editable && isAdmin && (
          <>
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={16} /> {t("voltage.importFile")}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus size={16} /> {t("voltage.newReading")}
            </Button>
          </>
        )}
      </div>
      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          keyField="id"
          isLoading={listQuery.isLoading}
          emptyTitle={t("voltage.noReadings")}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => confirm(t("voltage.confirmDeleteReading")) && removeMutation.mutate(row.id)}
                    >
                      <Trash2 size={14} className="text-[var(--win-danger)]" />
                    </Button>
                  </>
                )
              : undefined
          }
        />
      )}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("voltage.editReading") : t("voltage.newReadingTitle")}
        wide
      >
        <ResourceForm<VoltageReading>
          fields={readingFormFields}
          initialValues={editing ?? undefined}
          onSubmit={(values) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
            } else {
              createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
            }
          }}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
      {editable && isAdmin && <ImportModal open={showImport} onClose={() => setShowImport(false)} />}
    </div>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [electrolyzer, setElectrolyzer] = useState("");
  const [readingDate, setReadingDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const isExcel = !!file && /\.xlsx?$/i.test(file.name);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      setProgress({ percent: 0, processed: 0, total: 0 });
      if (isExcel) {
        return voltageCalcApi.importExcel(file, electrolyzer || undefined, readingDate || undefined, setProgress);
      }
      return voltageCalcApi.importCsv(file, electrolyzer, readingDate, setProgress);
    },
    onSuccess: (data) => {
      setResult(t("voltage.importedRows", { n: data.imported_rows }));
      queryClient.invalidateQueries({ queryKey: ["voltage-readings"] });
      queryClient.invalidateQueries({ queryKey: ["voltage-normalizations"] });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={t("voltage.importTitle")}>
      <div className="space-y-3">
        <p className="text-xs text-[var(--win-muted)]">{t("voltage.importHelp")}</p>
        <div>
          <Label>{t("voltage.electrolyzer")}</Label>
          <ElectrolyzerCombo
            value={electrolyzer}
            onChange={setElectrolyzer}
            placeholder={isExcel ? t("voltage.electrolyzerOptional") : "e.g. F2"}
          />
        </div>
        <div>
          <Label>{t("voltage.readingDate")}</Label>
          <Input type="date" value={readingDate} onChange={(e) => setReadingDate(e.target.value)} />
        </div>
        <div>
          <Label>{t("voltage.csvOrExcelFile")}</Label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm text-[var(--win-text)]"
          />
        </div>
        {progress && importMutation.isPending ? <ImportProgressBar progress={progress} wide /> : null}
        {result && <div className="border-2 border-[#5fa85f] bg-[#d9f0d9] px-3 py-2 text-sm font-semibold text-[#0d5c0d]">{result}</div>}
        {importMutation.isError && <ErrorState message={(importMutation.error as Error).message} />}
        <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-3">
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            disabled={!file || (!isExcel && (!electrolyzer || !readingDate)) || importMutation.isPending}
            onClick={() => importMutation.mutate()}
          >
            {importMutation.isPending ? t("common.importing") : t("common.import")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CalculatorTab() {
  const { t } = useI18n();
  const [form, setForm] = useState({
    u_meas: "",
    current_density: "",
    temp_meas: "",
    conc_meas: "",
    temp_ref: "90",
  });
  const calcMutation = useMutation({
    mutationFn: () =>
      voltageCalcApi.calculateStandardized({
        u_meas: Number(form.u_meas),
        current_density: Number(form.current_density),
        temp_meas: Number(form.temp_meas),
        conc_meas: Number(form.conc_meas),
        temp_ref: Number(form.temp_ref),
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("voltage.calculatorTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-[var(--win-muted)]">{t("voltage.calculatorHelp")}</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <Label>{t("voltage.measuredVoltage")}</Label>
            <Input
              type="number"
              step="0.001"
              value={form.u_meas}
              onChange={(e) => setForm((f) => ({ ...f, u_meas: e.target.value }))}
            />
          </div>
          <div>
            <Label>{t("voltage.currentDensity")}</Label>
            <Input
              type="number"
              step="0.01"
              value={form.current_density}
              onChange={(e) => setForm((f) => ({ ...f, current_density: e.target.value }))}
            />
          </div>
          <div>
            <Label>{t("voltage.measuredTemp")}</Label>
            <Input
              type="number"
              step="0.1"
              value={form.temp_meas}
              onChange={(e) => setForm((f) => ({ ...f, temp_meas: e.target.value }))}
            />
          </div>
          <div>
            <Label>{t("voltage.measuredConc")}</Label>
            <Input
              type="number"
              step="0.1"
              value={form.conc_meas}
              onChange={(e) => setForm((f) => ({ ...f, conc_meas: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={() => calcMutation.mutate()}
            disabled={!form.u_meas || !form.current_density || !form.temp_meas || !form.conc_meas || calcMutation.isPending}
          >
            <Calculator size={16} /> {t("common.calculate")}
          </Button>
          {calcMutation.data && (
            <div className="text-lg font-bold text-[var(--win-navy)]">
              {t("voltage.resultUn", { value: calcMutation.data.standardized_voltage })}
            </div>
          )}
        </div>
        {calcMutation.isError && <div className="mt-3"><ErrorState message={(calcMutation.error as Error).message} /></div>}
      </CardContent>
    </Card>
  );
}

function DistributionTab() {
  const { t } = useI18n();
  const [electrolyzer, setElectrolyzer] = useState("");
  const distQuery = useQuery({
    queryKey: ["voltage-distribution", electrolyzer],
    queryFn: () => voltageCalcApi.distribution({ electrolyzer: electrolyzer || undefined }),
  });
  const deviationQuery = useQuery({
    queryKey: ["voltage-high-deviation", electrolyzer],
    queryFn: () => voltageCalcApi.highDeviation({ electrolyzer: electrolyzer || undefined }),
  });

  return (
    <div className="space-y-6">
      <ElectrolyzerCombo
        placeholder={t("voltage.filterElectrolyzerOptional")}
        value={electrolyzer}
        onChange={setElectrolyzer}
        className="max-w-xs"
      />
      <Card>
        <CardHeader>
          <CardTitle>{t("voltage.distributionTitle", { n: distQuery.data?.total_readings ?? 0 })}</CardTitle>
        </CardHeader>
        <CardContent>
          {distQuery.isLoading ? (
            <LoadingState />
          ) : !distQuery.data || distQuery.data.buckets.every((b) => b.count === 0) ? (
            <EmptyState title={t("voltage.noVoltageToDistribute")} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distQuery.data.buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                <XAxis dataKey="label" stroke="#3f3f3f" fontSize={11} />
                <YAxis stroke="#3f3f3f" fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#0a246a" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t("voltage.highDeviationTitle")}
            {deviationQuery.data?.average ? ` (${t("voltage.highDeviationAvg", { value: deviationQuery.data.average })})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deviationQuery.isLoading ? (
            <LoadingState />
          ) : (
            <DataTable
              columns={[
                { key: "electrolyzer", header: t("fields.electrolyzer") },
                { key: "position", header: t("fields.position") },
                { key: "element_nr", header: t("fields.elementNr") },
                { key: "standardized_voltage", header: "Un (V)" },
                { key: "deviation_pct", header: "Deviation %" },
              ]}
              data={deviationQuery.data?.flagged as unknown as Record<string, unknown>[]}
              keyField="element_nr"
              emptyTitle={t("voltage.noHighDeviation")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentEfficiencyTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CurrentEfficiencyEntry | null>(null);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<CurrentEfficiencyEntry>(
    "current-efficiency-entries",
    currentEfficiencyEntriesApi,
    { limit: 500 }
  );

  const [calcForm, setCalcForm] = useState({ n_cells: "", current_ka: "" });
  const calcMutation = useMutation({
    mutationFn: () =>
      currentEfficiencyCalcApi.calculate({
        n_cells: Number(calcForm.n_cells),
        current_ka: Number(calcForm.current_ka),
      }),
  });

  const columns: Column<CurrentEfficiencyEntry>[] = [
    { key: "scope", header: t("fields.scopeValue"), render: (r) => t(`enums.scope.${r.scope}`) },
    { key: "scope_ref", header: t("fields.scopeReference") },
    { key: "position", header: t("fields.position") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "value_pct", header: t("fields.ce"), render: (r) => formatNumber(r.value_pct) },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("voltage.ceCalculatorTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--win-muted)]">{t("voltage.ceCalculatorHelp")}</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <Label>{t("voltage.numberOfCells")}</Label>
              <Input
                type="number"
                value={calcForm.n_cells}
                onChange={(e) => setCalcForm((f) => ({ ...f, n_cells: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t("voltage.currentKa")}</Label>
              <Input
                type="number"
                step="0.01"
                value={calcForm.current_ka}
                onChange={(e) => setCalcForm((f) => ({ ...f, current_ka: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              onClick={() => calcMutation.mutate()}
              disabled={!calcForm.n_cells || !calcForm.current_ka || calcMutation.isPending}
            >
              <Calculator size={16} /> {t("common.calculate")}
            </Button>
            {calcMutation.data && (
              <pre className="border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] px-3 py-2 text-xs text-[var(--win-navy)]">
                {JSON.stringify(calcMutation.data, null, 2)}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex justify-end gap-2">
          <ExportButtons prefix="/current-efficiency-entries" filenameBase="current-efficiency" />
          {editable && (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus size={16} /> {t("voltage.newEntry")}
            </Button>
          )}
        </div>
        {listQuery.isError ? (
          <ErrorState message={(listQuery.error as Error).message} />
        ) : (
          <DataTable
            columns={columns}
            data={listQuery.data}
            keyField="id"
            isLoading={listQuery.isLoading}
            emptyTitle={t("voltage.noCeEntries")}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => confirm(t("voltage.confirmDeleteEntry")) && removeMutation.mutate(row.id)}
                      >
                        <Trash2 size={14} className="text-[var(--win-danger)]" />
                      </Button>
                    </>
                  )
                : undefined
            }
          />
        )}
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t("voltage.editEntry") : t("voltage.newEntryTitle")}>
        <CeEntryForm
          initial={editing}
          onSubmit={(values) => {
            if (editing) {
              updateMutation.mutate({ id: editing.id, payload: values }, { onSuccess: () => setShowForm(false) });
            } else {
              createMutation.mutate(values as never, { onSuccess: () => setShowForm(false) });
            }
          }}
          onCancel={() => setShowForm(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
        />
      </Modal>
    </div>
  );
}

/**
 * Standardized Voltage main menu — a faithful reconstruction of the real Access
 * "Betriebsdaten" form: title + time period + reference current density header,
 * a Data Input row, and 5 side-by-side report columns (Total Plant / Train /
 * Electrolyzers / Groups / Elements), each with "Used Table" / "Calculation for"
 * (absent for Total Plant) / "Results as" and a "Display Results" button.
 * The actual computation reuses the app's generic aggregation engine instead of
 * the ~50 separate static Access report forms the original buttons opened.
 */
function parseList(csv: string): string[] {
  return csv
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function avgByKey(
  rows: { key: string | null | undefined; value: number | null | undefined }[]
): { label: string; value: number }[] {
  const byKey: Record<string, { sum: number; n: number }> = {};
  for (const r of rows) {
    if (r.value == null || !r.key) continue;
    byKey[r.key] = byKey[r.key] || { sum: 0, n: 0 };
    byKey[r.key].sum += r.value;
    byKey[r.key].n += 1;
  }
  return Object.entries(byKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, v]) => ({ label, value: Number((v.sum / v.n).toFixed(3)) }));
}

function StandardizedVoltageBoard() {
  const { t } = useI18n();
  const [from, setFrom] = useState("2006-06-01");
  const [till, setTill] = useState("2016-10-04");
  const [refDensity, setRefDensity] = useState("");
  const [shown, setShown] = useState<{ title: string; mode: "chart" | "table"; key: string } | null>(null);

  const plant = useColumnState({ usedTable: "electrolyzers", result: "chart" });
  const train = useColumnState({ usedTable: "electrolyzers", calc: "individual", result: "chart" });
  const el = useColumnState({ usedTable: "electrolyzers", calc: "individual", result: "chart" });
  const group = useColumnState({ usedTable: "allElements", calc: "individual", result: "chart" });
  const element = useColumnState({ usedTable: "allElements", calc: "individual", result: "chart" });

  const [elNr, setElNr] = useState("");
  const [severalEl, setSeveralEl] = useState("");
  const [trainNr, setTrainNr] = useState("");
  const [groupNr, setGroupNr] = useState("1");
  const [severalGroups, setSeveralGroups] = useState("");
  const [severalElements, setSeveralElements] = useState("");

  const elNames = useElectrolyzerNames();
  const subPlantsQuery = useQuery({ queryKey: ["sub-plants"], queryFn: () => subPlantsApi.list() });
  const arrangementsQuery = useQuery({ queryKey: ["arrangements"], queryFn: () => arrangementsApi.list() });
  const densityQuery = useQuery({ queryKey: ["correction-factors"], queryFn: () => correctionFactorsApi.list() });
  const readingsQuery = useQuery({
    queryKey: ["voltage-readings", "board", from, till],
    queryFn: () => voltageReadingsApi.list({ limit: 2000, date_from: from || undefined, date_till: till || undefined }),
    enabled: Boolean(shown),
  });
  const normsQuery = useQuery({
    queryKey: ["voltage-normalizations", "board"],
    queryFn: () => voltageNormalizationsApi.list({ limit: 2000 }),
    enabled: Boolean(shown),
  });
  const elementsMapQuery = useQuery({
    queryKey: ["elements", "group-map"],
    queryFn: () => elementsApi.list({ limit: 5000 }),
    enabled: shown?.key === "groups",
  });

  const trainNames = (subPlantsQuery.data || []).map((p) => p.name || String(p.nr)).filter(Boolean);
  const densities = Array.from(
    new Set((densityQuery.data || []).map((d) => d.reference_current_density).filter((v): v is number => v != null))
  ).sort((a, b) => a - b);

  useEffect(() => {
    if (!elNr && elNames[0]) setElNr(elNames[0]);
  }, [elNr, elNames]);
  useEffect(() => {
    if (!trainNr && trainNames[0]) setTrainNr(trainNames[0]);
  }, [trainNr, trainNames]);
  useEffect(() => {
    if (!refDensity && densities[0] != null) setRefDensity(String(densities[0]));
  }, [refDensity, densities]);

  const trainOfElectrolyzer = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of arrangementsQuery.data || []) {
      if (a.name) map[a.name] = a.sub_plant || "—";
    }
    return map;
  }, [arrangementsQuery.data]);

  const groupOfElement = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of elementsMapQuery.data || []) {
      if (e.element_nr) map[e.element_nr] = e.group_nr || "—";
    }
    return map;
  }, [elementsMapQuery.data]);

  const inPeriod = (d: string | null | undefined) => {
    const day = d?.slice(0, 10) || "";
    if (from && day && day < from) return false;
    if (till && day && day > till) return false;
    return true;
  };
  const normValue = (r: ElectrolyzerNormalization) =>
    r.total_voltage != null && r.element_count ? r.total_voltage / Math.max(r.element_count, 1) : null;
  const readingValue = (r: VoltageReading) => r.standardized_voltage ?? r.voltage;
  // Reads either row shape; VoltageReading uniquely has a `voltage` field.
  const anyValue = (r: VoltageReading | ElectrolyzerNormalization): number | null =>
    "voltage" in r ? readingValue(r) : normValue(r);

  const rows = useMemo(() => {
    if (!shown) return [];
    const norms = (normsQuery.data || []).filter((r) => inPeriod(r.date));
    const readings = (readingsQuery.data || []).filter((r) => inPeriod(r.date));

    switch (shown.key) {
      case "plant": {
        const useReadings = plant.values.usedTable === "allElements";
        return useReadings
          ? avgByKey(readings.map((r) => ({ key: r.date?.slice(0, 10), value: readingValue(r) })))
          : avgByKey(norms.map((r) => ({ key: r.date?.slice(0, 10), value: normValue(r) })));
      }
      case "train": {
        const useReadings = train.values.usedTable === "allElements";
        const source: (VoltageReading | ElectrolyzerNormalization)[] = useReadings ? readings : norms;
        if (train.values.calc === "individual" && trainNr) {
          return avgByKey(
            source
              .filter((r) => trainOfElectrolyzer[r.electrolyzer || ""] === trainNr)
              .map((r) => ({ key: r.date?.slice(0, 10), value: anyValue(r) }))
          );
        }
        return avgByKey(
          source.map((r) => ({ key: trainOfElectrolyzer[r.electrolyzer || ""] || "—", value: anyValue(r) }))
        );
      }
      case "electrolyzer": {
        const useReadings = el.values.usedTable === "allElements";
        const source: (VoltageReading | ElectrolyzerNormalization)[] = useReadings ? readings : norms;
        if (el.values.calc === "individual" && elNr) {
          return avgByKey(
            source.filter((r) => r.electrolyzer === elNr).map((r) => ({ key: r.date?.slice(0, 10), value: anyValue(r) }))
          );
        }
        if (el.values.calc === "several") {
          const list = parseList(severalEl);
          return avgByKey(
            source
              .filter((r) => list.length === 0 || list.includes(r.electrolyzer || ""))
              .map((r) => ({ key: r.electrolyzer, value: anyValue(r) }))
          );
        }
        return avgByKey(source.map((r) => ({ key: r.electrolyzer, value: anyValue(r) })));
      }
      case "groups": {
        const byGroup = group.values.usedTable === "groups";
        let list = readings;
        if (group.values.calc === "individual" && groupNr) {
          list = list.filter((r) => groupOfElement[r.element_nr || ""] === groupNr);
        } else if (group.values.calc === "several") {
          const wanted = parseList(severalGroups);
          if (wanted.length) list = list.filter((r) => wanted.includes(groupOfElement[r.element_nr || ""] || ""));
        }
        return avgByKey(
          list.map((r) => ({
            key: byGroup ? groupOfElement[r.element_nr || ""] || "—" : r.electrolyzer,
            value: readingValue(r),
          }))
        );
      }
      default: {
        // elements
        let list = readings;
        if (element.values.calc === "individual" && elNr) {
          list = list.filter((r) => r.electrolyzer === elNr);
          return avgByKey(list.map((r) => ({ key: r.position || r.element_nr || String(r.id), value: readingValue(r) })));
        }
        if (element.values.calc === "several") {
          const wanted = parseList(severalElements);
          if (wanted.length) list = list.filter((r) => wanted.includes(r.electrolyzer || ""));
          return avgByKey(list.map((r) => ({ key: r.electrolyzer, value: readingValue(r) })));
        }
        return avgByKey(list.map((r) => ({ key: r.electrolyzer || r.date?.slice(0, 10), value: readingValue(r) })));
      }
    }
  }, [
    shown,
    normsQuery.data,
    readingsQuery.data,
    from,
    till,
    elNr,
    severalEl,
    trainNr,
    groupNr,
    severalGroups,
    severalElements,
    plant.values.usedTable,
    train.values.usedTable,
    train.values.calc,
    el.values.usedTable,
    el.values.calc,
    group.values.usedTable,
    group.values.calc,
    element.values.calc,
    trainOfElectrolyzer,
    groupOfElement,
  ]);

  const resultGroup: RadioGroupDef = {
    legend: t("menus.resultsAs"),
    name: "result",
    options: [
      { value: "chart", label: t("menus.chart") },
      { value: "table", label: t("menus.table") },
    ],
  };
  const usedTableElGroup: RadioGroupDef = {
    legend: t("menus.usedTable"),
    name: "usedTable",
    options: [
      { value: "electrolyzers", label: t("menus.electrolyzers") },
      { value: "allElements", label: t("menus.allElementsPerEl") },
    ],
  };
  const usedTableGroupsGroup: RadioGroupDef = {
    legend: t("menus.usedTable"),
    name: "usedTable",
    options: [
      { value: "allElements", label: t("menus.allElementsPerEl") },
      { value: "groups", label: t("menus.groups") },
    ],
  };
  const usedTableElementsGroup: RadioGroupDef = {
    legend: t("menus.usedTable"),
    name: "usedTable",
    options: [
      { value: "allElements", label: t("menus.allElementsPerEl") },
      { value: "individual", label: t("menus.individualElement") },
    ],
  };

  const displayModeFor = (values: Record<string, string>) => (values.result === "table" ? "table" : "chart");

  return (
    <div className="access-hub" dir="ltr">
      <div className="access-hub-head">
        <div className="access-hub-title is-blue">{t("mainMenu.standardizedVoltage")}</div>
        <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="access-sunken inline-block px-3 py-2">
          <div className="mb-2 text-[12px] font-bold">{t("menus.dataInput")}</div>
          <div className="flex flex-wrap gap-2">
            <AccessBtn className="!w-auto px-3" href="/voltage?form=input-electrolyzer">
              {t("menus.dataInputElectrolyzers")}
            </AccessBtn>
            <AccessBtn className="!w-auto px-3" href="/voltage?form=input-elements">
              {t("menus.dataInputElements")}
            </AccessBtn>
            <AccessBtn className="!w-auto px-3" href="/voltage?form=input-group">
              {t("menus.inputGroup")}
            </AccessBtn>
            <AccessBtn className="!w-auto px-3" href="/voltage?form=input-single">
              {t("menus.inputSingleElement")}
            </AccessBtn>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="access-sunken flex items-center gap-2 px-3 py-2 text-[12px]">
            <span className="font-bold">{t("fields.referenceCurrentDensity")}</span>
            <select className="access-inset-field w-20" value={refDensity} onChange={(e) => setRefDensity(e.target.value)}>
              {(densities.length ? densities : [6]).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span>kA/m²</span>
          </div>
          <Link href="/" className="access-menu-btn access-hub-menu-btn">
            {t("common.mainMenu")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-5">
        <ReportColumn
          title={t("menus.totalPlant")}
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => setShown({ title: t("menus.totalPlant"), mode: displayModeFor(plant.values), key: "plant" })}
          groups={[usedTableElGroup, resultGroup]}
        />
        <ReportColumn
          title={t("menus.train")}
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => setShown({ title: t("menus.train"), mode: displayModeFor(train.values), key: "train" })}
          groups={[
            usedTableElGroup,
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualTrain") },
                { value: "all", label: t("menus.allTrains") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <select className="access-inset-field mt-1 w-full" value={trainNr} onChange={(e) => setTrainNr(e.target.value)}>
                    {(trainNames.length ? trainNames : ["1"]).map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                ) : null,
            },
            resultGroup,
          ]}
        />
        <ReportColumn
          title={t("menus.electrolyzer")}
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => setShown({ title: t("menus.electrolyzer"), mode: displayModeFor(el.values), key: "electrolyzer" })}
          groups={[
            usedTableElGroup,
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualEl") },
                { value: "several", label: t("menus.severalElectrolyzers") },
                { value: "all", label: t("menus.allElectrolyzers") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <ElectrolyzerCombo variant="access" className="mt-1 w-full" value={elNr} onChange={setElNr} />
                ) : v === "several" ? (
                  <input
                    className="access-inset-field mt-1 w-full"
                    placeholder="1G, 2G, ..."
                    value={severalEl}
                    onChange={(e) => setSeveralEl(e.target.value)}
                  />
                ) : null,
            },
            resultGroup,
          ]}
        />
        <ReportColumn
          title={t("menus.groups")}
          values={group.values}
          onChange={group.onChange}
          onDisplay={() => setShown({ title: t("menus.groups"), mode: displayModeFor(group.values), key: "groups" })}
          groups={[
            usedTableGroupsGroup,
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualGroup") },
                { value: "several", label: t("menus.severalGroups") },
                { value: "all", label: t("menus.allGroups") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <input className="access-inset-field mt-1 w-16" value={groupNr} onChange={(e) => setGroupNr(e.target.value)} />
                ) : v === "several" ? (
                  <input
                    className="access-inset-field mt-1 w-full"
                    placeholder="1, 2, ..."
                    value={severalGroups}
                    onChange={(e) => setSeveralGroups(e.target.value)}
                  />
                ) : null,
            },
            resultGroup,
          ]}
        />
        <ReportColumn
          title={t("menus.elements")}
          values={element.values}
          onChange={element.onChange}
          onDisplay={() => setShown({ title: t("menus.elements"), mode: displayModeFor(element.values), key: "elements" })}
          groups={[
            usedTableElementsGroup,
            {
              legend: t("menus.calculationFor"),
              name: "calc",
              options: [
                { value: "individual", label: t("menus.individualElement") },
                { value: "several", label: t("menus.severalElements") },
                { value: "all", label: t("menus.allElements") },
              ],
              extra: (v) =>
                v === "individual" ? (
                  <ElectrolyzerCombo variant="access" className="mt-1 w-full" value={elNr} onChange={setElNr} />
                ) : v === "several" ? (
                  <input
                    className="access-inset-field mt-1 w-full"
                    placeholder="1G, 2G, ..."
                    value={severalElements}
                    onChange={(e) => setSeveralElements(e.target.value)}
                  />
                ) : null,
            },
            resultGroup,
          ]}
        />
      </div>
      {shown ? <ResultsPane mode={shown.mode} title={shown.title} rows={rows} xKey="label" yKey="value" yLabel="Un [V]" /> : null}
    </div>
  );
}

function VoltagePageInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const form = searchParams.get("form") || searchParams.get("tab") || undefined;

  if (!form || form === "tables") return <StandardizedVoltageBoard />;

  const caption =
    form === "input-electrolyzer" || form === "normalizations"
      ? t("voltage.inputElectrolyzerTitle")
      : form === "input-elements" || form === "readings"
        ? t("voltage.inputElementsTitle")
        : form === "input-single"
          ? t("voltage.inputSingleTitle")
          : form === "input-group"
            ? t("voltage.inputGroupTitle")
            : form === "distribution"
              ? t("menus.distributionUn")
              : t("mainMenu.standardizedVoltage");

  const defaultTab =
    form === "input-electrolyzer" || form === "normalizations" || form === "input-group"
      ? "normalizations"
      : form === "input-elements" || form === "readings" || form === "input-single"
        ? "readings"
        : form === "calculator" || form === "current-efficiency"
          ? "calculator"
          : form === "distribution"
            ? "distribution"
            : "normalizations";

  return (
    <AccessFormWindow caption={caption} helpKey="voltage" backHref="/voltage" backLabel={t("mainMenu.standardizedVoltage")}>
      <Tabs
        defaultTab={defaultTab}
        tabs={[
          { key: "normalizations", label: t("menus.inputElectrolyzers"), content: <NormalizationsTab /> },
          { key: "readings", label: t("menus.inputElements"), content: <ReadingsTab /> },
          { key: "calculator", label: t("voltage.tabCalculator"), content: <CalculatorTab /> },
          { key: "distribution", label: t("voltage.tabDistribution"), content: <DistributionTab /> },
        ]}
      />
    </AccessFormWindow>
  );
}

export default function VoltagePage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <VoltagePageInner />
    </Suspense>
  );
}
