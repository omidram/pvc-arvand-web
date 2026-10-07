"use client";

/**
 * Access-parity Data Input for Standardized Voltage.
 * Electrolyzers + All Elements read/write the same tables AriaORMS sync fills:
 *   electrolyzer_normalizations  ← totals / I / tAn / tKa / Cc(NaOH) / U total
 *   voltage_readings             ← per-cell Ui
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import {
  voltageNormalizationsApi,
  voltageReadingsApi,
  voltageUnElementInputsApi,
  voltageUnGroupInputsApi,
  groupDefinitionsApi,
  voltageSyncApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type {
  ElectrolyzerNormalization,
  VoltageReading,
  VoltageUnElementInput,
  VoltageUnGroupInput,
} from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import {
  ElectrolyzerCombo,
  electrolyzerFieldOptions,
  useElectrolyzerNames,
} from "@/components/ui/electrolyzer-combo";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/input";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";
import { appConfirm } from "@/lib/dialog";

const L = {
  electrolyser: "Electrolyser",
  electrolyzer: "Electrolyzer",
  group: "Group",
  date: "Date",
  time: "Time",
  iTotal: "I Total",
  iGesamt: "I Gesamt",
  cc: "Cc",
  naoh: "NaOH",
  tAn: "t An",
  tKa: "t Ka",
  uTotal: "U Total",
  u: "U",
  noElements: "No. of Elements",
  position: "Position",
  ui: "Ui [V]",
  um: "Um [V]",
  unitKA: "[kA]",
  unitPct: "[% w/w]",
  unitC: "[°C]",
  unitV: "[V]",
  tAnHint: "(from catholyte temperature)",
} as const;

function accessTime(value: string | null | undefined): string {
  if (!value) return "—";
  const text = String(value).trim();
  const iso = text.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
  if (iso) return iso[1].length === 5 ? `${iso[1]}:00` : iso[1];
  const clock = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  return clock ? clock[1] : text;
}

/** AriaORMS writes NaOH into catholyte_conc; Access NormElek Cc may be in reference_current_density. */
function ccOf(row: ElectrolyzerNormalization | null | undefined): number | null {
  if (!row) return null;
  return row.catholyte_conc ?? row.reference_current_density ?? null;
}

function withCcPayload(values: Record<string, unknown>): Partial<ElectrolyzerNormalization> {
  const ccRaw = values.catholyte_conc;
  const cc = ccRaw === "" || ccRaw == null ? null : Number(ccRaw);
  return {
    ...(values as Partial<ElectrolyzerNormalization>),
    catholyte_conc: Number.isFinite(cc as number) ? (cc as number) : null,
    // Keep legacy Access Cc column aligned so older reports still see the value.
    reference_current_density: Number.isFinite(cc as number) ? (cc as number) : null,
  };
}

function dayOf(value: string | null | undefined): string {
  return (value || "").slice(0, 10);
}

type Mode = "electrolyzers" | "elements" | "group" | "single";

export function VoltageDataInput({ mode }: { mode: Mode }) {
  const { t } = useI18n();
  const caption =
    mode === "electrolyzers"
      ? t("voltage.inputElectrolyzerTitle")
      : mode === "elements"
        ? t("voltage.inputElementsTitle")
        : mode === "group"
          ? t("voltage.inputGroupTitle")
          : t("voltage.inputSingleTitle");

  return (
    <AccessFormWindow caption={caption} helpKey="voltage" backHref="/voltage" backLabel={t("mainMenu.standardizedVoltage")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/voltage" className="access-toolbar-btn inline-flex h-[22px] items-center px-2 text-[11px]">
          {t("mainMenu.standardizedVoltage")}
        </Link>
        {(mode === "electrolyzers" || mode === "elements") && <AriaormsSyncBanner />}
      </div>
      {mode === "electrolyzers" ? <ElectrolyzersInput /> : null}
      {mode === "elements" ? <AllElementsInput /> : null}
      {mode === "group" ? <GroupInput /> : null}
      {mode === "single" ? <SingleElementInput /> : null}
    </AccessFormWindow>
  );
}

function AriaormsSyncBanner() {
  const { t } = useI18n();
  const sync = useQuery({
    queryKey: ["voltage-sync-settings"],
    queryFn: () => voltageSyncApi.getSettings(),
    staleTime: 30_000,
  });
  const last = sync.data?.last_run_at;
  const status = sync.data?.last_run_status;
  const msg = sync.data?.last_run_message;
  return (
    <div className="access-sunken flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
      <RefreshCw size={12} className="text-[var(--win-navy)]" />
      <span className="font-bold text-[var(--win-navy)]">{t("voltage.ariaormsLinkTitle")}</span>
      <span className="text-[var(--win-muted)]">{t("voltage.ariaormsLinkHint")}</span>
      <span>
        {t("voltageSync.lastRun")}:{" "}
        <b>{last ? formatDateTime(last) : t("voltageSync.lastRunNever")}</b>
        {status ? ` · ${status}` : ""}
      </span>
      {msg ? <span className="max-w-[28rem] truncate text-[var(--win-text-dim)]" title={msg}>{msg}</span> : null}
      <Link href="/settings?tab=voltage-sync" className="ms-auto font-semibold text-[var(--win-navy)] underline">
        {t("voltage.ariaormsOpenSync")}
      </Link>
    </div>
  );
}

/** Access Datenerfassung Elektrolyseure → NormElek = electrolyzer_normalizations (AriaORMS totals). */
function ElectrolyzersInput() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ElectrolyzerNormalization | null>(null);
  const [filterEz, setFilterEz] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const elNames = useElectrolyzerNames();
  const fields = useMemo(
    (): FieldDef[] => [
      { name: "electrolyzer", label: `${L.electrolyser}:`, type: "combo", required: true, options: electrolyzerFieldOptions(elNames) },
      { name: "date", label: `${L.date}:`, type: "date" },
      { name: "time", label: `${L.time}:` },
      { name: "total_current", label: `${L.iTotal}: ${L.unitKA}`, type: "number", step: "0.01" },
      { name: "catholyte_conc", label: `${L.cc}: ${L.unitPct}`, type: "number", step: "0.01" },
      { name: "anolyte_temp", label: `${L.tAn}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "catholyte_temp", label: `${L.tKa}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "total_voltage", label: `${L.uTotal}: ${L.unitV}`, type: "number", step: "0.01" },
      { name: "element_count", label: `${L.noElements}:`, type: "number" },
    ],
    [elNames]
  );
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<ElectrolyzerNormalization>(
    "voltage-normalizations",
    voltageNormalizationsApi,
    { limit: 5000 }
  );

  const rows = useMemo(() => {
    let data = listQuery.data || [];
    if (filterEz) {
      const want = formatElectrolyzer(filterEz) || filterEz;
      data = data.filter((r) => (formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "") === want);
    }
    if (filterDay) data = data.filter((r) => dayOf(r.date) === filterDay);
    return data;
  }, [listQuery.data, filterEz, filterDay]);

  const columns: Column<ElectrolyzerNormalization>[] = [
    { key: "electrolyzer", header: L.electrolyser, render: (r) => formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "—" },
    { key: "date", header: L.date, render: (r) => formatDate(r.date) },
    { key: "time", header: L.time, render: (r) => accessTime(r.time) },
    { key: "total_current", header: `${L.iTotal} ${L.unitKA}`, render: (r) => formatNumber(r.total_current) },
    { key: "catholyte_conc", header: `${L.cc} ${L.unitPct}`, render: (r) => formatNumber(ccOf(r)) },
    { key: "anolyte_temp", header: `${L.tAn} ${L.unitC}`, render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: `${L.tKa} ${L.unitC}`, render: (r) => formatNumber(r.catholyte_temp) },
    { key: "total_voltage", header: `${L.uTotal} ${L.unitV}`, render: (r) => formatNumber(r.total_voltage) },
    { key: "element_count", header: L.noElements },
  ];

  const formInitial = editing
    ? { ...editing, catholyte_conc: ccOf(editing) }
    : undefined;

  return (
    <AccessInputShell
      title="Input Standardized Voltage Electrolyser"
      hint={`${L.tAnHint} · ${t("voltage.ariaormsElectrolyzerHint")}`}
      editable={editable}
      onNew={() => {
        setEditing(null);
        setShowForm(true);
      }}
      exportPrefix="/voltage-normalizations"
      filenameBase="voltage-input-electrolyzers"
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px]">
            <Label>{L.electrolyser}</Label>
            <ElectrolyzerCombo value={filterEz} onChange={setFilterEz} placeholder="—" />
          </div>
          <div>
            <Label>{L.date}</Label>
            <DateInput type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} />
          </div>
          {(filterEz || filterDay) && (
            <Button type="button" variant="secondary" onClick={() => { setFilterEz(""); setFilterDay(""); }}>
              {t("storage.clearFilters")}
            </Button>
          )}
        </div>
      }
    >
      {listQuery.isError ? <ErrorState message={(listQuery.error as Error).message} /> : null}
      <DataTable
        columns={columns}
        data={rows}
        keyField="id"
        isLoading={listQuery.isLoading}
        emptyTitle={t("voltage.noNormalizations")}
        actions={
          editable
            ? (row) => (
                <>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setShowForm(true); }}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void appConfirm(t("voltage.confirmDeleteNormalization")).then((ok) => {
                        if (ok) removeMutation.mutate(row.id);
                      });
                    }}
                  >
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )
            : undefined
        }
      />
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t("voltage.editNormalization") : t("voltage.newNormalization")}>
        <ResourceForm
          fields={fields}
          initialValues={formInitial}
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(values) => {
            const p = withCcPayload(values as Record<string, unknown>);
            if (editing) {
              updateMutation.mutate({ id: editing.id, payload: p }, { onSuccess: () => setShowForm(false) });
            } else {
              createMutation.mutate(p as never, { onSuccess: () => setShowForm(false) });
            }
          }}
        />
      </Modal>
    </AccessInputShell>
  );
}

/** Access Datenerfassung Elemente: master Normierung + subfrmSpannung (Ui from AriaORMS cells). */
function AllElementsInput() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showMaster, setShowMaster] = useState(false);
  const [editingMaster, setEditingMaster] = useState<ElectrolyzerNormalization | null>(null);
  const [selected, setSelected] = useState<ElectrolyzerNormalization | null>(null);
  const [showReading, setShowReading] = useState(false);
  const [editingReading, setEditingReading] = useState<VoltageReading | null>(null);
  const [filterEz, setFilterEz] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const elNames = useElectrolyzerNames();

  const masterFields = useMemo(
    (): FieldDef[] => [
      { name: "electrolyzer", label: `${L.electrolyser}:`, type: "combo", required: true, options: electrolyzerFieldOptions(elNames) },
      { name: "date", label: `${L.date}:`, type: "date" },
      { name: "time", label: `${L.time}:` },
      { name: "total_current", label: `${L.iGesamt}: ${L.unitKA}`, type: "number", step: "0.01" },
      { name: "catholyte_conc", label: `${L.cc}: ${L.unitPct}`, type: "number", step: "0.01" },
      { name: "anolyte_temp", label: `${L.tAn}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "catholyte_temp", label: `${L.tKa}: ${L.unitC}`, type: "number", step: "0.1" },
    ],
    [elNames]
  );

  const readingFields = useMemo(
    (): FieldDef[] => [
      { name: "position", label: `${L.position}:`, required: true },
      { name: "voltage", label: L.ui, type: "number", step: "0.001" },
    ],
    []
  );

  const masters = useCrudResource<ElectrolyzerNormalization>("voltage-normalizations", voltageNormalizationsApi, { limit: 5000 });

  const masterRows = useMemo(() => {
    let data = masters.listQuery.data || [];
    if (filterEz) {
      const want = formatElectrolyzer(filterEz) || filterEz;
      data = data.filter((r) => (formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "") === want);
    }
    if (filterDay) data = data.filter((r) => dayOf(r.date) === filterDay);
    return data;
  }, [masters.listQuery.data, filterEz, filterDay]);

  const selEz = selected ? formatElectrolyzer(selected.electrolyzer) || selected.electrolyzer || "" : "";
  const selDay = selected ? dayOf(selected.date) : "";
  const selTime = selected ? accessTime(selected.time) : "";

  // Same voltage_readings table AriaORMS fills — filter by electrolyzer + date (not a separate store).
  const readingsQuery = useQuery({
    queryKey: ["voltage-readings", "ariaorms-batch", selEz, selDay],
    queryFn: () =>
      voltageReadingsApi.list({
        electrolyzer: selEz,
        date_from: selDay,
        date_till: selDay,
        limit: 2000,
      }),
    enabled: Boolean(selEz && selDay),
  });

  const linkedReadings = useMemo(() => {
    const all = readingsQuery.data || [];
    if (!selected) return [];
    if (selTime === "—") return all;
    const sameTime = all.filter((r) => accessTime(r.time) === selTime);
    return sameTime.length ? sameTime : all;
  }, [readingsQuery.data, selected, selTime]);

  const umAvg = useMemo(() => {
    const vals = linkedReadings.map((r) => r.voltage).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [linkedReadings]);

  const masterCols: Column<ElectrolyzerNormalization>[] = [
    { key: "electrolyzer", header: L.electrolyser, render: (r) => formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "—" },
    { key: "date", header: L.date, render: (r) => formatDate(r.date) },
    { key: "time", header: L.time, render: (r) => accessTime(r.time) },
    { key: "total_current", header: L.iGesamt, render: (r) => formatNumber(r.total_current) },
    { key: "catholyte_conc", header: L.cc, render: (r) => formatNumber(ccOf(r)) },
    { key: "anolyte_temp", header: L.tAn, render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: L.tKa, render: (r) => formatNumber(r.catholyte_temp) },
    {
      key: "element_count",
      header: "Cells",
      render: (r) => r.element_count ?? "—",
    },
  ];

  const readingCols: Column<VoltageReading>[] = [
    { key: "position", header: L.position },
    { key: "voltage", header: L.ui, render: (r) => formatNumber(r.voltage, 3) },
    { key: "standardized_voltage", header: L.um, render: () => formatNumber(umAvg, 3) },
  ];

  return (
    <AccessInputShell
      title="Input Standardized Voltage Elements"
      hint={`${t("voltage.ariaormsElementsHint")} · Ui: Element voltage including back to back voltage · Um: avg Ui`}
      editable={editable}
      onNew={() => {
        setEditingMaster(null);
        setShowMaster(true);
      }}
      exportPrefix="/voltage-normalizations"
      filenameBase="voltage-input-elements"
      toolbar={
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[140px]">
            <Label>{L.electrolyser}</Label>
            <ElectrolyzerCombo value={filterEz} onChange={setFilterEz} placeholder="—" />
          </div>
          <div>
            <Label>{L.date}</Label>
            <DateInput type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} />
          </div>
        </div>
      }
    >
      <DataTable
        columns={masterCols}
        data={masterRows}
        keyField="id"
        isLoading={masters.listQuery.isLoading}
        emptyTitle={t("voltage.noNormalizations")}
        selectedKey={selected?.id}
        onRowClick={(row) => setSelected(row)}
        actions={
          editable
            ? (row) => (
                <Button size="sm" variant="ghost" onClick={() => { setEditingMaster(row); setShowMaster(true); }}>
                  <Pencil size={14} />
                </Button>
              )
            : undefined
        }
      />

      {selected ? (
        <div className="mt-4 access-sunken p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <strong className="text-[12px]">
              {L.position} / {L.ui} — {selEz} · {formatDate(selected.date)} · {selTime}
              <span className="ms-2 font-normal text-[var(--win-muted)]">({t("voltage.fromAriaormsOrManual")})</span>
            </strong>
            <div className="flex items-center gap-2 text-[11px]">
              <span>
                {L.um}: <b>{formatNumber(umAvg, 3)}</b>
              </span>
              <span>
                n=<b>{linkedReadings.length}</b>
              </span>
              {editable ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingReading(null);
                    setShowReading(true);
                  }}
                >
                  <Plus size={14} /> {L.ui}
                </Button>
              ) : null}
            </div>
          </div>
          {readingsQuery.isError ? <ErrorState message={(readingsQuery.error as Error).message} /> : null}
          <DataTable
            columns={readingCols}
            data={linkedReadings}
            keyField="id"
            isLoading={readingsQuery.isFetching}
            emptyTitle={t("voltage.noReadings")}
            maxHeight="min(40vh, 360px)"
            actions={
              editable
                ? (row) => (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingReading(row); setShowReading(true); }}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void appConfirm(t("voltage.confirmDeleteReading")).then((ok) => {
                            if (ok) {
                              void voltageReadingsApi.remove(row.id).then(() => readingsQuery.refetch());
                            }
                          });
                        }}
                      >
                        <Trash2 size={14} className="text-[var(--win-danger)]" />
                      </Button>
                    </>
                  )
                : undefined
            }
          />
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-[var(--win-muted)]">{t("voltage.selectBatchForReadings")}</p>
      )}

      <Modal open={showMaster} onClose={() => setShowMaster(false)} title={editingMaster ? t("voltage.editNormalization") : t("voltage.newNormalization")}>
        <ResourceForm
          fields={masterFields}
          initialValues={editingMaster ? { ...editingMaster, catholyte_conc: ccOf(editingMaster) } : undefined}
          submitting={masters.createMutation.isPending || masters.updateMutation.isPending}
          onCancel={() => setShowMaster(false)}
          onSubmit={(values) => {
            const p = withCcPayload(values as Record<string, unknown>);
            if (editingMaster) {
              masters.updateMutation.mutate({ id: editingMaster.id, payload: p }, { onSuccess: () => setShowMaster(false) });
            } else {
              masters.createMutation.mutate(p as never, {
                onSuccess: (row) => {
                  setShowMaster(false);
                  setSelected(row as ElectrolyzerNormalization);
                },
              });
            }
          }}
        />
      </Modal>

      <Modal open={showReading} onClose={() => setShowReading(false)} title={editingReading ? t("voltage.editReading") : t("voltage.newReading")}>
        <ResourceForm
          fields={readingFields}
          initialValues={editingReading ?? undefined}
          submitting={false}
          onCancel={() => setShowReading(false)}
          onSubmit={(values) => {
            if (!selected) return;
            const base: Partial<VoltageReading> = {
              ...(values as Partial<VoltageReading>),
              electrolyzer: selected.electrolyzer,
              date: selected.date,
              time: selected.time,
              normalization_nr: selected.normalization_nr,
            };
            const done = () => {
              setShowReading(false);
              void readingsQuery.refetch();
            };
            if (editingReading) {
              void voltageReadingsApi.update(editingReading.id, base).then(done);
            } else {
              void voltageReadingsApi.create(base).then(done);
            }
          }}
        />
      </Modal>
    </AccessInputShell>
  );
}

function GroupInput() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VoltageUnGroupInput | null>(null);
  const groups = useQuery({ queryKey: ["group-definitions"], queryFn: () => groupDefinitionsApi.list() });
  const groupOptions = useMemo(
    () =>
      (groups.data || [])
        .map((g) => String(g.group_nr || "").trim())
        .filter(Boolean)
        .map((value) => ({ label: value, value })),
    [groups.data]
  );
  const fields = useMemo(
    (): FieldDef[] => [
      { name: "group_nr", label: `${L.group}:`, type: groupOptions.length ? "combo" : "text", required: true, options: groupOptions },
      { name: "date", label: `${L.date}:`, type: "date" },
      { name: "time", label: `${L.time}:` },
      { name: "total_current", label: `${L.iTotal}: ${L.unitKA}`, type: "number", step: "0.01" },
      { name: "naoh_pct", label: `${L.cc}: ${L.unitPct}`, type: "number", step: "0.01" },
      { name: "anolyte_temp", label: `${L.tAn}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "catholyte_temp", label: `${L.tKa}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "total_voltage", label: `${L.uTotal}: ${L.unitV}`, type: "number", step: "0.01" },
      { name: "element_count", label: `${L.noElements}:`, type: "number" },
    ],
    [groupOptions]
  );
  const crud = useCrudResource<VoltageUnGroupInput>("voltage-un-group-inputs", voltageUnGroupInputsApi, { limit: 5000 });
  const columns: Column<VoltageUnGroupInput>[] = [
    { key: "group_nr", header: L.group },
    { key: "date", header: L.date, render: (r) => formatDate(r.date) },
    { key: "time", header: L.time, render: (r) => accessTime(r.time) },
    { key: "total_current", header: L.iTotal, render: (r) => formatNumber(r.total_current) },
    { key: "naoh_pct", header: L.cc, render: (r) => formatNumber(r.naoh_pct) },
    { key: "anolyte_temp", header: L.tAn, render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: L.tKa, render: (r) => formatNumber(r.catholyte_temp) },
    { key: "total_voltage", header: L.uTotal, render: (r) => formatNumber(r.total_voltage) },
    { key: "element_count", header: L.noElements },
  ];

  return (
    <AccessInputShell
      title="Input Standardized Voltage Group"
      hint={t("voltage.groupInputHint")}
      editable={editable}
      onNew={() => {
        setEditing(null);
        setShowForm(true);
      }}
      exportPrefix="/voltage-un-group-inputs"
      filenameBase="voltage-input-groups"
    >
      <DataTable
        columns={columns}
        data={crud.listQuery.data}
        keyField="id"
        isLoading={crud.listQuery.isLoading}
        emptyTitle={t("voltage.noGroupInputs")}
        actions={
          editable
            ? (row) => (
                <>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setShowForm(true); }}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void appConfirm(t("voltage.confirmDeleteGroupInput")).then((ok) => {
                        if (ok) crud.removeMutation.mutate(row.id);
                      });
                    }}
                  >
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )
            : undefined
        }
      />
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t("voltage.editGroupInput") : t("voltage.newGroupInput")}>
        <ResourceForm
          fields={fields}
          initialValues={editing ?? undefined}
          submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(values) => {
            const p = values as Partial<VoltageUnGroupInput>;
            if (editing) crud.updateMutation.mutate({ id: editing.id, payload: p }, { onSuccess: () => setShowForm(false) });
            else crud.createMutation.mutate(p as never, { onSuccess: () => setShowForm(false) });
          }}
        />
      </Modal>
    </AccessInputShell>
  );
}

function SingleElementInput() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VoltageUnElementInput | null>(null);
  const elNames = useElectrolyzerNames();
  const fields = useMemo(
    (): FieldDef[] => [
      { name: "electrolyzer", label: `${L.electrolyzer}:`, type: "combo", required: true, options: electrolyzerFieldOptions(elNames) },
      { name: "position", label: `${L.position}:`, required: true },
      { name: "date", label: `${L.date}:`, type: "date" },
      { name: "time", label: `${L.time}:` },
      { name: "total_current", label: `${L.iTotal}: ${L.unitKA}`, type: "number", step: "0.01" },
      { name: "naoh_pct", label: `${L.naoh}: ${L.unitPct}`, type: "number", step: "0.01" },
      { name: "anolyte_temp", label: `${L.tAn}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "catholyte_temp", label: `${L.tKa}: ${L.unitC}`, type: "number", step: "0.1" },
      { name: "voltage", label: `${L.u}: ${L.unitV}`, type: "number", step: "0.001" },
    ],
    [elNames]
  );
  const crud = useCrudResource<VoltageUnElementInput>("voltage-un-element-inputs", voltageUnElementInputsApi, { limit: 5000 });
  const columns: Column<VoltageUnElementInput>[] = [
    { key: "electrolyzer", header: L.electrolyzer, render: (r) => formatElectrolyzer(r.electrolyzer) || r.electrolyzer || "—" },
    { key: "position", header: L.position },
    { key: "date", header: L.date, render: (r) => formatDate(r.date) },
    { key: "time", header: L.time, render: (r) => accessTime(r.time) },
    { key: "total_current", header: L.iTotal, render: (r) => formatNumber(r.total_current) },
    { key: "naoh_pct", header: L.naoh, render: (r) => formatNumber(r.naoh_pct) },
    { key: "anolyte_temp", header: L.tAn, render: (r) => formatNumber(r.anolyte_temp) },
    { key: "catholyte_temp", header: L.tKa, render: (r) => formatNumber(r.catholyte_temp) },
    { key: "voltage", header: L.u, render: (r) => formatNumber(r.voltage, 3) },
  ];

  return (
    <AccessInputShell
      title="Input Standardized Voltage Single Element"
      hint={t("voltage.singleInputHint")}
      editable={editable}
      onNew={() => {
        setEditing(null);
        setShowForm(true);
      }}
      exportPrefix="/voltage-un-element-inputs"
      filenameBase="voltage-input-single"
    >
      <DataTable
        columns={columns}
        data={crud.listQuery.data}
        keyField="id"
        isLoading={crud.listQuery.isLoading}
        emptyTitle={t("voltage.noSingleInputs")}
        actions={
          editable
            ? (row) => (
                <>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(row); setShowForm(true); }}>
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void appConfirm(t("voltage.confirmDeleteSingleInput")).then((ok) => {
                        if (ok) crud.removeMutation.mutate(row.id);
                      });
                    }}
                  >
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )
            : undefined
        }
      />
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t("voltage.editSingleInput") : t("voltage.newSingleInput")}>
        <ResourceForm
          fields={fields}
          initialValues={editing ?? undefined}
          submitting={crud.createMutation.isPending || crud.updateMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(values) => {
            const p = values as Partial<VoltageUnElementInput>;
            if (editing) crud.updateMutation.mutate({ id: editing.id, payload: p }, { onSuccess: () => setShowForm(false) });
            else crud.createMutation.mutate(p as never, { onSuccess: () => setShowForm(false) });
          }}
        />
      </Modal>
    </AccessInputShell>
  );
}

function AccessInputShell({
  title,
  hint,
  editable,
  onNew,
  exportPrefix,
  filenameBase,
  toolbar,
  children,
}: {
  title: string;
  hint?: string;
  editable: boolean;
  onNew: () => void;
  exportPrefix: string;
  filenameBase: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[var(--win-face-dark)] pb-2">
        <div>
          <h3 className="m-0 text-[13px] font-bold text-[var(--win-navy)]">{title}</h3>
          {hint ? <p className="m-0 mt-1 max-w-3xl text-[10px] text-[var(--win-muted)]">{hint}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons prefix={exportPrefix} filenameBase={filenameBase} />
          {editable ? (
            <Button onClick={onNew}>
              <Plus size={16} /> {t("access.newRecord")}
            </Button>
          ) : null}
        </div>
      </div>
      {toolbar ? <div className="mb-3">{toolbar}</div> : null}
      {children}
    </div>
  );
}
