"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calculator, Upload } from "lucide-react";
import {
  voltageNormalizationsApi,
  voltageReadingsApi,
  voltageCalcApi,
  currentEfficiencyEntriesApi,
  currentEfficiencyCalcApi,
  electrolyzersApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { ElectrolyzerNormalization, VoltageReading, CurrentEfficiencyEntry } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";

type T = ReturnType<typeof useI18n>["t"];
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

function normalizationFields(t: T): FieldDef[] {
  return [
    { name: "normalization_nr", label: t("fields.normalizationNr"), type: "number" },
    { name: "electrolyzer", label: t("fields.electrolyzer"), required: true },
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "time", label: t("fields.time") },
    { name: "total_current", label: t("fields.totalCurrent"), type: "number", step: "0.01" },
    { name: "reference_current_density", label: t("fields.referenceCurrentDensity"), type: "number", step: "0.01" },
    { name: "anolyte_temp", label: t("fields.anolyteTemp"), type: "number", step: "0.1" },
    { name: "catholyte_temp", label: t("fields.catholyteTemp"), type: "number", step: "0.1" },
    { name: "zero_voltage", label: t("fields.zeroVoltage"), type: "number", step: "0.001" },
    { name: "total_voltage", label: t("fields.totalVoltage"), type: "number", step: "0.01" },
    { name: "element_count", label: t("fields.elementCount"), type: "number" },
    { name: "cl2_pct", label: t("fields.cl2Pct"), type: "number", step: "0.01" },
    { name: "h2_pct", label: t("fields.h2Pct"), type: "number", step: "0.01" },
    { name: "delta_p", label: t("fields.deltaP"), type: "number", step: "0.01" },
  ];
}

function readingFields(t: T): FieldDef[] {
  return [
    { name: "normalization_nr", label: t("fields.normalizationNr"), type: "number" },
    { name: "electrolyzer", label: t("fields.electrolyzer"), required: true },
    { name: "position", label: t("fields.position") },
    { name: "element_nr", label: t("fields.elementNr") },
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "time", label: t("fields.time") },
    { name: "voltage", label: t("fields.voltage"), type: "number", step: "0.001" },
    { name: "voltage_prev", label: t("fields.voltagePrev"), type: "number", step: "0.001" },
    { name: "standardized_voltage", label: t("fields.standardizedVoltage"), type: "number", step: "0.001" },
  ];
}

function ceFields(t: T): FieldDef[] {
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
    { name: "scope_ref", label: t("fields.scopeReference") },
    { name: "position", label: t("fields.position") },
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "value_pct", label: t("fields.currentEfficiencyPct"), type: "number", step: "0.01" },
  ];
}

function NormalizationsTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ElectrolyzerNormalization | null>(null);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrolyzerNormalization>(
    "voltage-normalizations",
    voltageNormalizationsApi,
    { limit: 500 }
  );

  const columns: Column<ElectrolyzerNormalization>[] = [
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "total_current", header: t("fields.totalCurrent"), render: (r) => formatNumber(r.total_current) },
    { key: "total_voltage", header: t("fields.totalVoltage"), render: (r) => formatNumber(r.total_voltage) },
    { key: "element_count", header: t("fields.elementCount") },
    { key: "anolyte_temp", header: t("fields.anolyteTemp"), render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: t("fields.catholyteTemp"), render: (r) => formatNumber(r.catholyte_temp) },
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
          fields={normalizationFields(t)}
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
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VoltageReading | null>(null);
  const [showImport, setShowImport] = useState(false);
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<VoltageReading>(
    "voltage-readings",
    voltageReadingsApi,
    { limit: 500 }
  );

  const columns: Column<VoltageReading>[] = [
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.position") },
    { key: "element_nr", header: t("fields.elementNr") },
    { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
    { key: "voltage", header: "Ui (V)", render: (r) => formatNumber(r.voltage, 3) },
    { key: "standardized_voltage", header: "Un (V)", render: (r) => formatNumber(r.standardized_voltage, 3) },
  ];

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <ExportButtons prefix="/voltage-readings" filenameBase="voltage-readings" />
        {editable && (
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
          data={listQuery.data}
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
          fields={readingFields(t)}
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
      {editable && <ImportModal open={showImport} onClose={() => setShowImport(false)} />}
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

  const isExcel = !!file && /\.xlsx?$/i.test(file.name);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      if (isExcel) {
        return voltageCalcApi.importExcel(file, electrolyzer || undefined, readingDate || undefined);
      }
      return voltageCalcApi.importCsv(file, electrolyzer, readingDate);
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
          <Input
            value={electrolyzer}
            onChange={(e) => setElectrolyzer(e.target.value)}
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
    queryFn: () => voltageCalcApi.distribution(electrolyzer || undefined),
  });
  const deviationQuery = useQuery({
    queryKey: ["voltage-high-deviation", electrolyzer],
    queryFn: () => voltageCalcApi.highDeviation({ electrolyzer: electrolyzer || undefined }),
  });

  return (
    <div className="space-y-6">
      <Input
        placeholder={t("voltage.filterElectrolyzerOptional")}
        value={electrolyzer}
        onChange={(e) => setElectrolyzer(e.target.value)}
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
        <ResourceForm<CurrentEfficiencyEntry>
          fields={ceFields(t)}
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

function VoltageMenu() {
  const { t } = useI18n();
  return (
    <AccessHub title={t("mainMenu.standardizedVoltage")} titleBlue>
      <div className="mb-4 access-sunken inline-block px-3 py-2">
        <div className="mb-2 text-[12px] font-bold">{t("menus.dataInput")}</div>
        <div className="flex flex-wrap gap-2">
          <AccessBtn className="!w-auto px-3" href="/voltage?form=input-electrolyzer">
            {t("menus.dataInputElectrolyzers")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-3" href="/voltage?form=input-elements">
            {t("menus.dataInputElements")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-3" href="/voltage?form=input-elements&import=1">
            {t("menus.readFromFile")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-3" href="/voltage?form=input-single">
            {t("menus.inputSingleElement")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-3" href="/voltage?form=input-group">
            {t("menus.inputGroup")}
          </AccessBtn>
        </div>
      </div>
      <div className="grid max-w-[760px] grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.tablesDiagrams")}</div>
          <div className="mt-2 flex flex-col gap-2">
            <AccessBtn href="/voltage?form=tables&scope=plant">{t("menus.totalPlant")}</AccessBtn>
            <AccessBtn href="/voltage?form=tables&scope=train">{t("menus.train")}</AccessBtn>
            <AccessBtn href="/voltage?form=tables&scope=electrolyzer">{t("menus.electrolyzer")}</AccessBtn>
            <AccessBtn href="/voltage?form=tables&scope=groups">{t("menus.groups")}</AccessBtn>
            <AccessBtn href="/voltage?form=tables&scope=elements">{t("menus.elements")}</AccessBtn>
          </div>
        </div>
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.singleElements")}</div>
          <div className="mt-2 flex flex-col gap-2">
            <AccessBtn href="/voltage?form=tables&scope=single">{t("menus.tablesOrDiagrams")}</AccessBtn>
            <AccessBtn href="/voltage?form=distribution">{t("menus.distributionUn")}</AccessBtn>
          </div>
        </div>
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.groups")}</div>
          <div className="mt-2 flex flex-col gap-2">
            <AccessBtn href="/voltage?form=tables&scope=group-tables">{t("menus.tablesOrDiagrams")}</AccessBtn>
            <AccessBtn href="/statistics?form=groups">{t("menus.unGroupsByDate")}</AccessBtn>
          </div>
        </div>
      </div>
    </AccessHub>
  );
}

function UnTablesForm({ scope }: { scope: string }) {
  const { t } = useI18n();
  const [from, setFrom] = useState("2006-06-01");
  const [till, setTill] = useState("2016-10-04");
  const [shown, setShown] = useState<{ title: string; mode: "chart" | "table"; key: string } | null>(null);
  const plant = useColumnState({ result: "chart" });
  const train = useColumnState({ result: "chart" });
  const el = useColumnState({ calc: "individual", result: "chart" });
  const group = useColumnState({ calc: "individual", result: "chart" });
  const element = useColumnState({ calc: "all", result: "chart" });
  const [elNr, setElNr] = useState("");
  const [groupNr, setGroupNr] = useState("1");

  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const readingsQuery = useQuery({
    queryKey: ["voltage-readings", "tables", shown?.key],
    queryFn: () => voltageReadingsApi.list({ limit: 5000 }),
    enabled: Boolean(shown),
  });
  const normsQuery = useQuery({
    queryKey: ["voltage-normalizations", "tables"],
    queryFn: () => voltageNormalizationsApi.list({ limit: 2000 }),
    enabled: Boolean(shown),
  });

  const elNames = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);
  useEffect(() => {
    if (!elNr && elNames[0]) setElNr(elNames[0]);
  }, [elNr, elNames]);

  const rows = useMemo(() => {
    if (!shown) return [];
    const inPeriod = (d: string | null | undefined) => {
      const day = d?.slice(0, 10) || "";
      if (from && day && day < from) return false;
      if (till && day && day > till) return false;
      return true;
    };

    if (shown.key === "plant" || shown.key === "train") {
      const byDate: Record<string, { sum: number; n: number }> = {};
      for (const r of normsQuery.data || []) {
        if (!inPeriod(r.date)) continue;
        const day = r.date!.slice(0, 10);
        const u = r.total_voltage != null && r.element_count ? r.total_voltage / Math.max(r.element_count, 1) : null;
        if (u == null) continue;
        byDate[day] = byDate[day] || { sum: 0, n: 0 };
        byDate[day].sum += u;
        byDate[day].n += 1;
      }
      return Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ label: date, value: Number((v.sum / v.n).toFixed(3)) }));
    }

    if (shown.key === "electrolyzer" || shown.key === "groups" || shown.key === "group-tables") {
      const byKey: Record<string, { sum: number; n: number }> = {};
      for (const r of normsQuery.data || []) {
        if (!inPeriod(r.date)) continue;
        if (shown.key === "electrolyzer" && el.values.calc === "individual" && elNr && r.electrolyzer !== elNr) continue;
        const u = r.total_voltage != null && r.element_count ? r.total_voltage / Math.max(r.element_count, 1) : null;
        if (u == null) continue;
        const key =
          shown.key === "groups" || shown.key === "group-tables"
            ? r.electrolyzer || "—"
            : el.values.calc === "all"
              ? r.electrolyzer || "—"
              : r.date?.slice(0, 10) || "—";
        byKey[key] = byKey[key] || { sum: 0, n: 0 };
        byKey[key].sum += u;
        byKey[key].n += 1;
      }
      return Object.entries(byKey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, v]) => ({ label, value: Number((v.sum / v.n).toFixed(3)) }));
    }

    // elements / single
    const byKey: Record<string, { sum: number; n: number }> = {};
    for (const r of readingsQuery.data || []) {
      if (!inPeriod(r.date)) continue;
      if (elNr && (shown.key === "single" || element.values.calc === "individual") && r.electrolyzer !== elNr) continue;
      const u = r.standardized_voltage ?? r.voltage;
      if (u == null) continue;
      const key =
        shown.key === "single" || element.values.calc === "individual"
          ? r.position || r.element_nr || String(r.id)
          : r.electrolyzer || r.date?.slice(0, 10) || "—";
      byKey[key] = byKey[key] || { sum: 0, n: 0 };
      byKey[key].sum += u;
      byKey[key].n += 1;
    }
    return Object.entries(byKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, v]) => ({ label, value: Number((v.sum / v.n).toFixed(3)) }));
  }, [shown, normsQuery.data, readingsQuery.data, from, till, elNr, el.values.calc, element.values.calc]);

  const titleMap: Record<string, string> = {
    plant: t("menus.totalPlant"),
    train: t("menus.train"),
    electrolyzer: t("menus.electrolyzer"),
    groups: t("menus.groups"),
    elements: t("menus.elements"),
    single: t("menus.singleElements"),
    "group-tables": t("menus.groups"),
  };

  const resultGroup = {
    legend: t("menus.resultsAs"),
    name: "result",
    options: [
      { value: "chart", label: t("menus.chart") },
      { value: "table", label: t("menus.table") },
    ],
  };

  const showPlant = scope === "plant";
  const showTrain = scope === "train";
  const showEl = scope === "electrolyzer";
  const showGroups = scope === "groups" || scope === "group-tables";
  const showElements = scope === "elements" || scope === "single";

  return (
    <AccessHub title={`${t("mainMenu.standardizedVoltage")} — ${titleMap[scope] || scope}`} titleBlue backHref="/voltage" backLabel={t("mainMenu.standardizedVoltage")}>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <div className="grid grid-cols-1 gap-2 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3">
        {showPlant ? (
          <ReportColumn
            title={t("menus.totalPlant")}
            values={plant.values}
            onChange={plant.onChange}
            onDisplay={() => setShown({ title: t("menus.totalPlant"), mode: plant.values.result === "table" ? "table" : "chart", key: "plant" })}
            groups={[resultGroup]}
          />
        ) : null}
        {showTrain ? (
          <ReportColumn
            title={t("menus.train")}
            values={train.values}
            onChange={train.onChange}
            onDisplay={() => setShown({ title: t("menus.train"), mode: train.values.result === "table" ? "table" : "chart", key: "train" })}
            groups={[resultGroup]}
          />
        ) : null}
        {showEl ? (
          <ReportColumn
            title={t("menus.electrolyzer")}
            values={el.values}
            onChange={el.onChange}
            onDisplay={() => setShown({ title: t("menus.electrolyzer"), mode: el.values.result === "table" ? "table" : "chart", key: "electrolyzer" })}
            groups={[
              {
                legend: t("menus.calculationFor"),
                name: "calc",
                options: [
                  { value: "individual", label: t("menus.individualEl") },
                  { value: "all", label: t("menus.allElectrolyzers") },
                ],
                extra: (v) =>
                  v === "individual" ? (
                    <select className="access-inset-field mt-1 w-full" value={elNr} onChange={(e) => setElNr(e.target.value)}>
                      {(elNames.length ? elNames : ["1G"]).map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  ) : null,
              },
              resultGroup,
            ]}
          />
        ) : null}
        {showGroups ? (
          <ReportColumn
            title={t("menus.groups")}
            values={group.values}
            onChange={group.onChange}
            onDisplay={() => setShown({ title: t("menus.groups"), mode: group.values.result === "table" ? "table" : "chart", key: scope })}
            groups={[
              {
                legend: t("menus.calculationFor"),
                name: "calc",
                options: [
                  { value: "individual", label: t("menus.individualGroup") },
                  { value: "all", label: t("menus.allGroups") },
                ],
                extra: (v) =>
                  v === "individual" ? (
                    <input className="access-inset-field mt-1 w-16" value={groupNr} onChange={(e) => setGroupNr(e.target.value)} />
                  ) : null,
              },
              resultGroup,
            ]}
          />
        ) : null}
        {showElements ? (
          <ReportColumn
            title={scope === "single" ? t("menus.singleElements") : t("menus.elements")}
            values={element.values}
            onChange={element.onChange}
            onDisplay={() =>
              setShown({
                title: scope === "single" ? t("menus.singleElements") : t("menus.elements"),
                mode: element.values.result === "table" ? "table" : "chart",
                key: scope === "single" ? "single" : "elements",
              })
            }
            groups={[
              {
                legend: t("menus.calculationFor"),
                name: "calc",
                options: [
                  { value: "individual", label: t("menus.individualElement") },
                  { value: "all", label: t("menus.allElements") },
                ],
                extra: (v) =>
                  v === "individual" || scope === "single" ? (
                    <select className="access-inset-field mt-1 w-full" value={elNr} onChange={(e) => setElNr(e.target.value)}>
                      {(elNames.length ? elNames : ["1G"]).map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  ) : null,
              },
              resultGroup,
            ]}
          />
        ) : null}
      </div>
      {shown ? <ResultsPane mode={shown.mode} title={shown.title} rows={rows} xKey="label" yKey="value" yLabel="Un [V]" /> : null}
    </AccessHub>
  );
}

function VoltagePageInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const form = searchParams.get("form") || searchParams.get("tab") || undefined;
  const scope = searchParams.get("scope") || "plant";

  if (!form) return <VoltageMenu />;
  if (form === "tables") return <UnTablesForm scope={scope} />;

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
