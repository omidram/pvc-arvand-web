"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  shutdownsApi,
  shutdownCategoriesApi,
  shutdownCausesApi,
  settingsApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { Shutdown, ShutdownCategory, ShutdownCause } from "@/lib/types";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar/context";
import { DateInput } from "@/components/ui/date-input";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { appAlert, appConfirm } from "@/lib/dialog";
import { monthStartIso, todayIsoLocal } from "@/lib/date-range";
import { ShutdownAnalysis, type ShutdownGroupBy } from "@/components/domain/shutdown-analysis";
import { FilterHeadCell } from "@/components/ui/data-table";
import { useSheetFilters } from "@/components/ui/table-sheet";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  // Access-style wall times: prefer the stored local string; fall back for ISO-Z values.
  if (!value.endsWith("Z") && value.includes("T")) return value.slice(0, 16);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Local wall-clock now as `YYYY-MM-DDTHH:mm:00` (same storage style as Access imports). */
function nowLocalApi(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}

/** Parse Access-style wall-clock datetimes without shifting them into UTC. */
function wallTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  }
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

type DurationFields = {
  shutdown_time?: string | null;
  startup_time?: string | null;
  duration_hours?: number | null;
};

function durationMinutes(row: DurationFields): number | null {
  // Always prefer the two times when both exist (draft rows have no duration_hours yet).
  const a = wallTimeMs(row.shutdown_time);
  const b = wallTimeMs(row.startup_time);
  if (a != null && b != null) {
    if (b < a) return 0;
    return Math.round((b - a) / 60000);
  }
  if (row.duration_hours != null && !Number.isNaN(row.duration_hours)) {
    return Math.max(0, Math.round(row.duration_hours * 60));
  }
  return null;
}

function durationHm(row: DurationFields): string {
  const mins = durationMinutes(row);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function lostFmt(row: DurationFields & { ka_before_trip?: number | null }, factor: number): string {
  const mins = durationMinutes(row);
  const ka = row.ka_before_trip;
  if (mins == null || ka == null || Number.isNaN(Number(ka))) return "";
  return (Number(ka) * factor * (mins / 60)).toFixed(2);
}

const PLANT_SCOPES = ["Train1", "Train2", "CA Total Plant"] as const;

function plantPartValue(v: string | null | undefined): string {
  const raw = (v || "").trim();
  const scope = PLANT_SCOPES.find((s) => s.toLowerCase() === raw.toLowerCase());
  return scope ?? (formatElectrolyzer(raw) || raw);
}

function PlantBar() {
  const { t } = useI18n();
  useCalendar();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const s = settingsQuery.data;
  // Access header 4th box is the plant date (not Version — DB sometimes stores Format "d" there).
  return (
    <div className="access-plant-bar shutdown-plant-bar">
      <span>{s?.customer || "PVC Arvand"}</span>
    </div>
  );
}

function ShutdownMenu() {
  const { t } = useI18n();
  return (
    <AccessHub title={t("mainMenu.shutDown")} titleBlue>
      <div className="flex flex-wrap items-start gap-8 pt-4">
        <div>
          <div className="mb-2 text-[12px] font-bold">{t("menus.input")}</div>
          <div className="access-sunken flex w-[220px] flex-col gap-2">
            <AccessBtn href="/shutdowns?form=list">{t("menus.shutdownList")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=reasons">{t("menus.shutdownReasons")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=categories">{t("menus.shutdownCategories")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=trip-causes">{t("menus.tripCause")}</AccessBtn>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold">{t("menus.results")}</div>
          <div className="access-sunken flex w-[220px] flex-col gap-2">
            <AccessBtn href="/shutdowns?form=summary-reason">{t("fields.reason")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=summary-category">{t("menus.category")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=period">{t("menus.timePeriod")}</AccessBtn>
          </div>
        </div>
      </div>
    </AccessHub>
  );
}

function toApiDateTime(localValue: string): string | null {
  const text = localValue.trim();
  if (!text) return null;
  // datetime-local → store as local wall-clock without Z (matches Access import style)
  if (text.length === 16) return `${text}:00`;
  return text;
}

function ComboInput({
  listId,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  listId: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <>
      <input
        className={className || "w-full"}
        list={listId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </>
  );
}

function ShutdownListForm({ dateFrom, dateTo, showPeriodFilter }: { dateFrom?: string; dateTo?: string; showPeriodFilter?: boolean }) {
  const { t } = useI18n();
  const { canEdit, canViewField } = useAuth();
  const editable = canEdit("shutdowns") && !showPeriodFilter;
  const [active, setActive] = useState<number | "new" | null>(null);
  const [from, setFrom] = useState(() => dateFrom || monthStartIso());
  const [to, setTo] = useState(() => dateTo || todayIsoLocal());
  const [draft, setDraft] = useState<Partial<Shutdown>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Shutdown>>({});
  const [query, setQuery] = useState("");

  const listParams = useMemo(() => {
    const params: Record<string, unknown> = { limit: 2000 };
    if (from) params.date_from = `${from}T00:00:00`;
    if (to) params.date_to = `${to}T23:59:59`;
    return params;
  }, [from, to]);

  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<Shutdown>(
    "shutdowns",
    shutdownsApi,
    listParams
  );
  const causesQuery = useQuery({
    queryKey: ["shutdown-causes", "combo"],
    queryFn: () => shutdownCausesApi.list({ limit: 500 }),
  });
  const categoriesQuery = useQuery({
    queryKey: ["shutdown-categories", "combo"],
    queryFn: () => shutdownCategoriesApi.list({ limit: 200 }),
  });

  // Keep No. in order even if the API order changes; newest stays at the bottom next to the new-row line.
  const rows = useMemo(() => [...(listQuery.data || [])].sort((a, b) => a.nr - b.nr), [listQuery.data]);
  const causes = causesQuery.data || [];
  const categoryOptions = useMemo(() => {
    const fromTable = (categoriesQuery.data || []).map((c) => c.category || "").filter(Boolean);
    const fromCauses = causes.map((c) => c.category || "").filter(Boolean);
    return Array.from(new Set([...fromTable, ...fromCauses])).sort();
  }, [categoriesQuery.data, causes]);
  const codeOptions = useMemo(
    () => Array.from(new Set(causes.map((c) => c.code || "").filter(Boolean))).sort(),
    [causes]
  );
  const causeOptions = useMemo(
    () => Array.from(new Set(causes.map((c) => c.cause || "").filter(Boolean))).sort(),
    [causes]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.nr, r.plant_part, r.code, r.cause, r.category, r.remarks, r.shutdown_time, r.startup_time, r.ka_before_trip]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);
  const sheetCols = useMemo(
    () => [
      { key: "nr", filterText: (r: Shutdown) => String(r.nr) },
      { key: "plant_part", filterText: (r: Shutdown) => plantPartValue(r.plant_part) },
      { key: "shutdown_time" },
      { key: "startup_time" },
      { key: "duration", filterText: (r: Shutdown) => durationHm(r) },
      { key: "code", filterText: (r: Shutdown) => r.code || "" },
      { key: "cause", filterText: (r: Shutdown) => r.cause || "" },
      { key: "ka_before_trip", filterText: (r: Shutdown) => (r.ka_before_trip == null ? "" : String(r.ka_before_trip)) },
      { key: "lost_load", filterText: (r: Shutdown) => (r.lost_load == null ? "" : String(r.lost_load)) },
      { key: "lost_production", filterText: (r: Shutdown) => (r.lost_production == null ? "" : String(r.lost_production)) },
      { key: "mtbf_days", filterText: (r: Shutdown) => (r.mtbf_days == null ? "" : String(r.mtbf_days)) },
      { key: "category", filterText: (r: Shutdown) => r.category || "" },
      { key: "remarks", filterText: (r: Shutdown) => r.remarks || "" },
    ],
    []
  );
  const sheet = useSheetFilters(sheetCols, shown);
  const mainSort = useSort(sheet.shown, SHUTDOWN_SORT);
  const listed = mainSort.sorted;
  const totalMins = listed.reduce((sum, r) => sum + (durationMinutes(r) ?? 0), 0);
  const totalHm = `${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")}`;

  function fieldVisible(field: string) {
    return canViewField("shutdowns", field);
  }

  function saveRow(row: Shutdown, patch: Partial<Shutdown>, done?: () => void) {
    if (!editable) return;
    setSaveError(null);
    updateMutation.mutate(
      {
      id: row.nr,
      payload: {
        plant_part: row.plant_part,
        shutdown_time: row.shutdown_time,
        startup_time: row.startup_time,
        remarks: row.remarks,
        code: row.code,
        category: row.category,
        cause: row.cause,
        ka_before_trip: row.ka_before_trip,
        lost_load: row.lost_load,
        lost_production: row.lost_production,
        mtbf_days: row.mtbf_days,
        ...patch,
      },
      },
      {
        onSuccess: () => done?.(),
        onError: (e) => setSaveError((e as Error).message || "Save failed"),
      }
    );
  }

  function applyCode(row: Shutdown | null, code: string, isNew: boolean) {
    const match = causes.find((c) => (c.code || "").toLowerCase() === code.trim().toLowerCase());
    const patch: Partial<Shutdown> = {
      code: code || null,
      cause: match?.cause ?? (isNew ? draft.cause ?? null : row?.cause ?? null),
      category: match?.category ?? (isNew ? draft.category ?? null : row?.category ?? null),
    };
    if (match) {
      patch.cause = match.cause;
      patch.category = match.category;
    }
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else setEditDraft((d) => ({ ...d, ...patch }));
  }

  function applyCause(row: Shutdown | null, cause: string, isNew: boolean) {
    const match = causes.find((c) => (c.cause || "").toLowerCase() === cause.trim().toLowerCase());
    const patch: Partial<Shutdown> = {
      cause: cause || null,
      code: match?.code ?? (isNew ? draft.code ?? null : row?.code ?? null),
      category: match?.category ?? (isNew ? draft.category ?? null : row?.category ?? null),
    };
    if (match) {
      patch.code = match.code;
      patch.category = match.category;
    }
    if (isNew) setDraft((d) => ({ ...d, ...patch }));
    else setEditDraft((d) => ({ ...d, ...patch }));
  }

  function createNew() {
    if (!editable) return;
    if (!draft.plant_part || !draft.shutdown_time) {
      setSaveError(t("shutdowns.plantTimeRequired"));
      return;
    }
    if (draft.startup_time && draft.startup_time < draft.shutdown_time) {
      setSaveError(t("shutdowns.startBeforeStop"));
      return;
    }
    setSaveError(null);
    const day = draft.shutdown_time.slice(0, 10);
    createMutation.mutate(
      {
        plant_part: draft.plant_part || null,
        shutdown_time: draft.shutdown_time || null,
        startup_time: draft.startup_time || null,
        remarks: draft.remarks || null,
        code: draft.code || null,
        category: draft.category || null,
        cause: draft.cause || null,
        ka_before_trip: draft.ka_before_trip ?? null,
        mtbf_days: draft.mtbf_days ?? null,
      } as never,
      {
        onSuccess: () => {
          setDraft({});
          setActive(null);
          // The new trip must stay visible: widen the date filter when it falls outside it.
          if (from && day < from) setFrom(day);
          if (to && day > to) setTo(day);
        },
        onError: (e) => setSaveError(errText(e)),
      }
    );
  }

  return (
    <AccessHub
      title={showPeriodFilter ? t("shutdowns.periodTitle") : t("menus.shutdownList")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={
        <>
          <ExportButtons prefix="/shutdowns" params={listParams} filenameBase="shutdowns" />
          {editable ? (
            <AccessBtn
              onClick={() => {
                setActive("new");
                setDraft({ shutdown_time: nowLocalApi() });
              }}
            >
              + {t("menus.shutdownList")}
            </AccessBtn>
          ) : null}
        </>
      }
    >
      <PlantBar />
      <div className="shutdown-list-toolbar mb-3 flex flex-wrap items-end justify-between gap-3 text-[12px]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span>{t("menus.from")}</span>
            <DateInput className="access-inset-field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("menus.till")}</span>
            <DateInput className="access-inset-field" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("common.search")}</span>
            <input className="access-inset-field w-52" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div className="shutdown-summary-chip font-bold">
          {t("shutdowns.totalDuration")}: {totalHm} &nbsp;·&nbsp; {t("shutdowns.totalShutdowns")}: {listed.length}
        </div>
      </div>
      <div className="overflow-auto shutdown-list-scroll">
        <table className="access-cont-table shutdown-list-table min-w-[1600px]">
          <thead>
            <tr>
              <th className="w-4" />
              <SortTh k="nr" sorter={mainSort} className="w-12">{t("menus.number")}</SortTh>
              {fieldVisible("plant_part") ? <SortTh k="plant_part" sorter={mainSort} className="w-28">{t("menus.partOfPlant")}</SortTh> : null}
              {fieldVisible("shutdown_time") ? <SortTh k="shutdown_time" sorter={mainSort} className="w-40">{t("fields.shutdownTime")}</SortTh> : null}
              {fieldVisible("startup_time") ? <SortTh k="startup_time" sorter={mainSort} className="w-40">{t("fields.startupTime")}</SortTh> : null}
              <SortTh k="duration" sorter={mainSort} className="w-24">{t("fields.durationHm")}</SortTh>
              {fieldVisible("code") ? <SortTh k="code" sorter={mainSort} className="w-16">{t("fields.code")}</SortTh> : null}
              {fieldVisible("cause") ? <SortTh k="cause" sorter={mainSort} className="w-44">{t("fields.cause")}</SortTh> : null}
              {fieldVisible("ka_before_trip") ? <SortTh k="ka_before_trip" sorter={mainSort} className="w-24">{t("fields.kaBeforeTrip")}</SortTh> : null}
              {fieldVisible("lost_load") ? <SortTh k="lost_load" sorter={mainSort} className="w-28">{t("fields.lostLoad")}</SortTh> : null}
              {fieldVisible("lost_production") ? <SortTh k="lost_production" sorter={mainSort} className="w-28">{t("fields.lostProduction")}</SortTh> : null}
              {fieldVisible("mtbf_days") ? <SortTh k="mtbf_days" sorter={mainSort} className="w-24">{t("fields.mtbfDays")}</SortTh> : null}
              {fieldVisible("category") ? <SortTh k="category" sorter={mainSort} className="w-28">{t("fields.category")}</SortTh> : null}
              {fieldVisible("remarks") ? <SortTh k="remarks" sorter={mainSort}>{t("fields.remarks")}</SortTh> : null}
              {editable ? <th className="w-36" /> : null}
            </tr>
            <tr>
              <th />
              <th>
                <FilterHeadCell columnKey="nr" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
              </th>
              {fieldVisible("plant_part") ? (
                <th>
                  <FilterHeadCell columnKey="plant_part" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("shutdown_time") ? (
                <th>
                  <FilterHeadCell columnKey="shutdown_time" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("startup_time") ? (
                <th>
                  <FilterHeadCell columnKey="startup_time" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              <th>
                <FilterHeadCell columnKey="duration" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
              </th>
              {fieldVisible("code") ? (
                <th>
                  <FilterHeadCell columnKey="code" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("cause") ? (
                <th>
                  <FilterHeadCell columnKey="cause" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("ka_before_trip") ? (
                <th>
                  <FilterHeadCell columnKey="ka_before_trip" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("lost_load") ? (
                <th>
                  <FilterHeadCell columnKey="lost_load" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("lost_production") ? (
                <th>
                  <FilterHeadCell columnKey="lost_production" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("mtbf_days") ? (
                <th>
                  <FilterHeadCell columnKey="mtbf_days" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("category") ? (
                <th>
                  <FilterHeadCell columnKey="category" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {fieldVisible("remarks") ? (
                <th>
                  <FilterHeadCell columnKey="remarks" filters={sheet.filters} valueFilters={sheet.valueFilters} onFilter={sheet.onFilter} onValueFilter={sheet.onValueFilter} getFilterOptions={sheet.getFilterOptions} />
                </th>
              ) : null}
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {listed.map((row) => {
              const open = editing === row.nr;
              const src = (open ? { ...row, ...editDraft } : row) as Shutdown;
              return (
              <tr key={row.nr} onClick={() => setActive(row.nr)} className={active === row.nr ? "is-active-row" : undefined}>
                <td className="access-selector">{active === row.nr ? "►" : ""}</td>
                <td>
                  <input className="w-12" value={row.nr} readOnly tabIndex={-1} />
                </td>
                {fieldVisible("plant_part") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    {open ? (
                      <ElectrolyzerCombo
                        variant="access"
                        className="w-full min-w-[4rem]"
                        plainOptions={PLANT_SCOPES}
                        value={plantPartValue(src.plant_part)}
                        onChange={(v) => setEditDraft((d) => ({ ...d, plant_part: plantPartValue(v) || null }))}
                      />
                    ) : (
                      <span className="block px-1">{plantPartValue(row.plant_part) || "—"}</span>
                    )}
                  </td>
                ) : null}
                {fieldVisible("shutdown_time") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <DateInput
                      type="datetime-local"
                      className="w-full min-w-[108px] tabular-nums"
                      value={toLocalInput(src.shutdown_time)}
                      disabled={!open}
                      onChange={(e) => setEditDraft((d) => ({ ...d, shutdown_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <DateInput
                      type="datetime-local"
                      className="w-full min-w-[108px] tabular-nums"
                      value={toLocalInput(src.startup_time)}
                      disabled={!open}
                      onChange={(e) => setEditDraft((d) => ({ ...d, startup_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                <td>
                  <input className="w-20 text-center font-semibold tabular-nums" value={durationHm(src)} readOnly tabIndex={-1} />
                </td>
                {fieldVisible("code") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ComboInput
                      listId={`sd-code-${row.nr}`}
                      options={codeOptions}
                      value={src.code || ""}
                      disabled={!open}
                      className="w-14"
                      onChange={(v) => applyCode(row, v, false)}
                    />
                  </td>
                ) : null}
                {fieldVisible("cause") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ComboInput
                      listId={`sd-cause-${row.nr}`}
                      options={causeOptions}
                      value={src.cause || ""}
                      disabled={!open}
                      onChange={(v) => applyCause(row, v, false)}
                    />
                  </td>
                ) : null}
                {fieldVisible("ka_before_trip") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      step="0.01"
                      className="w-20 text-center tabular-nums"
                      value={src.ka_before_trip ?? ""}
                      disabled={!open}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, ka_before_trip: e.target.value === "" ? null : Number(e.target.value) }))
                      }
                    />
                  </td>
                ) : null}
                {fieldVisible("lost_load") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value={lostFmt(src, 0.2074)} readOnly tabIndex={-1} title="Chlorine lost = KA × 0.2074 × Duration (h)" />
                  </td>
                ) : null}
                {fieldVisible("lost_production") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value={lostFmt(src, 0.2336)} readOnly tabIndex={-1} title="NaOH lost = KA × 0.2336 × Duration (h)" />
                  </td>
                ) : null}
                {fieldVisible("mtbf_days") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      step="0.1"
                      className="w-20 text-center tabular-nums"
                      value={src.mtbf_days ?? ""}
                      disabled={!open}
                      title={t("fields.mtbfDays")}
                      onChange={(e) => setEditDraft((d) => ({ ...d, mtbf_days: e.target.value === "" ? null : Number(e.target.value) }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("category") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ComboInput
                      listId={`sd-cat-${row.nr}`}
                      options={categoryOptions}
                      value={src.category || ""}
                      disabled={!open}
                      onChange={(v) => setEditDraft((d) => ({ ...d, category: v || null }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("remarks") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full"
                      value={src.remarks || ""}
                      disabled={!open}
                      onChange={(e) => setEditDraft((d) => ({ ...d, remarks: e.target.value || null }))}
                    />
                  </td>
                ) : null}
                {editable ? (
                  <td onClick={(e) => e.stopPropagation()} className="whitespace-nowrap">
                    {open ? (
                      <>
                        <button
                          type="button"
                          className="access-btn text-[11px]"
                          disabled={updateMutation.isPending}
                          onClick={() => {
                            saveRow(src, {}, () => setEditing(null));
                          }}
                        >
                          {t("common.save")}
                        </button>
                        <button type="button" className="access-btn text-[11px]" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="access-btn text-[11px]"
                        onClick={() => {
                          setEditing(row.nr);
                          setEditDraft({ ...row });
                          setActive(row.nr);
                        }}
                      >
                        {t("common.edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="access-btn text-[11px]"
                      onClick={() => {
                        void appConfirm(t("shutdowns.confirmDelete", { nr: String(row.nr) })).then((ok) => { if (ok) removeMutation.mutate(row.nr); });
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                ) : null}
              </tr>
              );
            })}
            {editable && active === "new" ? (
              <tr className="is-active-row">
                <td className="access-selector">*</td>
                <td>
                  <input className="w-12" value="*" readOnly tabIndex={-1} />
                </td>
                {fieldVisible("plant_part") ? (
                  <td>
                    <ElectrolyzerCombo
                      variant="access"
                      className="w-full min-w-[4rem]"
                      plainOptions={PLANT_SCOPES}
                      value={plantPartValue(draft.plant_part)}
                      onChange={(v) => setDraft((d) => ({ ...d, plant_part: plantPartValue(v) || null }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("shutdown_time") ? (
                  <td>
                    <DateInput
                      type="datetime-local"
                      className="w-full min-w-[108px] tabular-nums"
                      value={toLocalInput(draft.shutdown_time)}
                      onChange={(e) => setDraft((d) => ({ ...d, shutdown_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td>
                    <DateInput
                      type="datetime-local"
                      className="w-full min-w-[108px] tabular-nums"
                      value={toLocalInput(draft.startup_time)}
                      onChange={(e) => setDraft((d) => ({ ...d, startup_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                <td>
                  <input className="w-20 text-center font-semibold tabular-nums" value={durationHm(draft)} readOnly tabIndex={-1} />
                </td>
                {fieldVisible("code") ? (
                  <td>
                    <ComboInput
                      listId="sd-code-new"
                      options={codeOptions}
                      value={draft.code || ""}
                      className="w-14"
                      onChange={(v) => applyCode(null, v, true)}
                    />
                  </td>
                ) : null}
                {fieldVisible("cause") ? (
                  <td>
                    <ComboInput
                      listId="sd-cause-new"
                      options={causeOptions}
                      value={draft.cause || ""}
                      onChange={(v) => applyCause(null, v, true)}
                    />
                  </td>
                ) : null}
                {fieldVisible("ka_before_trip") ? (
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="w-20 text-center tabular-nums"
                      value={draft.ka_before_trip ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, ka_before_trip: e.target.value === "" ? null : Number(e.target.value) }))
                      }
                    />
                  </td>
                ) : null}
                {fieldVisible("lost_load") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value={lostFmt(draft as Shutdown, 0.2074)} readOnly tabIndex={-1} title="Chlorine lost = KA × 0.2074 × Duration (h)" />
                  </td>
                ) : null}
                {fieldVisible("lost_production") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value={lostFmt(draft as Shutdown, 0.2336)} readOnly tabIndex={-1} title="NaOH lost = KA × 0.2336 × Duration (h)" />
                  </td>
                ) : null}
                {fieldVisible("mtbf_days") ? (
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      className="w-20 text-center tabular-nums"
                      value={draft.mtbf_days ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, mtbf_days: e.target.value === "" ? null : Number(e.target.value) }))
                      }
                    />
                  </td>
                ) : null}
                {fieldVisible("category") ? (
                  <td>
                    <ComboInput
                      listId="sd-cat-new"
                      options={categoryOptions}
                      value={draft.category || ""}
                      onChange={(v) => setDraft((d) => ({ ...d, category: v || null }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("remarks") ? (
                  <td>
                    <input
                      className="w-full"
                      value={draft.remarks || ""}
                      onChange={(e) => setDraft((d) => ({ ...d, remarks: e.target.value || null }))}
                    />
                  </td>
                ) : null}
                <td>
                  <button type="button" className="access-btn text-[11px]" onClick={createNew} disabled={createMutation.isPending}>
                    {t("common.save")}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {listQuery.isError ? <div className="mt-2 text-[12px] text-red-800">{(listQuery.error as Error).message}</div> : null}
      {saveError ? <div className="mt-2 text-[12px] font-bold text-red-800">{saveError}</div> : null}
    </AccessHub>
  );
}

function errText(e: unknown): string {
  return (e as Error)?.message || "Save failed";
}

/** Access "Abschaltungsursachen": Code + Reason + Category. Rows are saved with the Save button, never per keystroke. */
function CausesTable() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Partial<ShutdownCause>>>({});
  const [fresh, setFresh] = useState<Partial<ShutdownCause>>({});
  const [error, setError] = useState<string | null>(null);
  const { listQuery, createMutation, updateMutation } = useCrudResource<ShutdownCause>("shutdown-causes", shutdownCausesApi, { limit: 500 });
  const categoriesQuery = useQuery({
    queryKey: ["shutdown-categories", "combo"],
    queryFn: () => shutdownCategoriesApi.list({ limit: 200 }),
  });
  const rows = useMemo(
    () => [...(listQuery.data || [])].filter((r) => (r.code || "").trim() || (r.cause || "").trim()).sort((a, b) => (a.language_id ?? 0) - (b.language_id ?? 0) || (a.code || "").localeCompare(b.code || "")),
    [listQuery.data]
  );
  const causeSort = useSort(rows, CAUSE_SORT);
  const categoryOptions = useMemo(
    () => Array.from(new Set((categoriesQuery.data || []).map((c) => c.category || "").filter(Boolean))).sort(),
    [categoriesQuery.data]
  );

  function patch(id: number, change: Partial<ShutdownCause>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...change } }));
  }

  function saveRow(row: ShutdownCause) {
    const draft = drafts[row.id];
    if (!draft) return;
    setError(null);
    updateMutation.mutate(
      { id: row.id, payload: { ...row, ...draft } },
      {
        onSuccess: () => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => Number(k) !== row.id))),
        onError: (e) => setError(errText(e)),
      }
    );
  }

  function addRow() {
    const code = (fresh.code || "").trim();
    const cause = (fresh.cause || "").trim();
    if (!code || !cause) {
      setError(t("shutdowns.codeReasonRequired"));
      return;
    }
    setError(null);
    createMutation.mutate({ code, cause, category: fresh.category || null, language_id: 2 } as never, {
      onSuccess: () => {
        setFresh({});
        setActive(null);
      },
      onError: (e) => setError(errText(e)),
    });
  }

  return (
    <>
      <table className="access-cont-table max-w-3xl">
        <thead>
          <tr>
            <th className="w-4" />
            <SortTh k="code" sorter={causeSort} className="w-20">{t("fields.code")}</SortTh>
            <SortTh k="cause" sorter={causeSort}>{t("fields.reason")}</SortTh>
            <SortTh k="category" sorter={causeSort} className="w-40">{t("fields.category")}</SortTh>
            {editable ? <th className="w-20" /> : null}
          </tr>
        </thead>
        <tbody>
          {causeSort.sorted.map((row) => {
            const src = { ...row, ...drafts[row.id] };
            return (
              <tr key={row.id} onClick={() => setActive(row.id)}>
                <td className="access-selector">{active === row.id ? "►" : ""}</td>
                <td>
                  <input className="w-16" value={src.code || ""} onChange={(e) => patch(row.id, { code: e.target.value })} disabled={!editable} />
                </td>
                <td>
                  <input className="w-full" value={src.cause || ""} onChange={(e) => patch(row.id, { cause: e.target.value })} disabled={!editable} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <ComboInput listId={`reason-cat-${row.id}`} options={categoryOptions} value={src.category || ""} disabled={!editable} onChange={(v) => patch(row.id, { category: v })} />
                </td>
                {editable ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    {drafts[row.id] ? (
                      <button type="button" className="access-btn text-[11px]" disabled={updateMutation.isPending} onClick={() => saveRow(row)}>
                        {t("common.save")}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
          {editable ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td>
                <input className="w-16" value={fresh.code || ""} onChange={(e) => setFresh((d) => ({ ...d, code: e.target.value }))} />
              </td>
              <td>
                <input className="w-full" value={fresh.cause || ""} onChange={(e) => setFresh((d) => ({ ...d, cause: e.target.value }))} />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <ComboInput listId="reason-cat-new" options={categoryOptions} value={fresh.category || ""} onChange={(v) => setFresh((d) => ({ ...d, category: v }))} />
              </td>
              <td>
                <button type="button" className="access-btn text-[11px]" disabled={createMutation.isPending} onClick={addRow}>
                  {t("common.save")}
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {error ? <div className="mt-2 text-[12px] font-bold text-red-800">{error}</div> : null}
    </>
  );
}

function ReasonsForm() {
  const { t } = useI18n();
  return (
    <AccessHub
      title={t("shutdowns.reasonsTitle")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdown-causes" filenameBase="shutdown-causes" />}
    >
      <CausesTable />
    </AccessHub>
  );
}

function TripCausesForm() {
  const { t } = useI18n();
  return (
    <AccessHub
      title={t("menus.tripCause")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdown-causes" filenameBase="trip-causes" />}
    >
      <div className="mb-4">
        <CausesTable />
      </div>
      <h3 className="mb-2 text-[13px] font-bold">{t("shutdowns.summaryTripTitle")}</h3>
      <ShutdownAnalysis initialGroupBy="cause" />
    </AccessHub>
  );
}

function CategoriesForm() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [fresh, setFresh] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { listQuery, createMutation, updateMutation } = useCrudResource<ShutdownCategory>("shutdown-categories", shutdownCategoriesApi, { limit: 200 });
  const rows = listQuery.data || [];
  const catSort = useSort(rows, CAT_SORT);

  function saveRow(row: ShutdownCategory) {
    const value = (drafts[row.id] ?? "").trim();
    if (!value) {
      setError(t("shutdowns.categoryRequired"));
      return;
    }
    setError(null);
    updateMutation.mutate(
      { id: row.id, payload: { ...row, category: value } },
      {
        onSuccess: () => setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => Number(k) !== row.id))),
        onError: (e) => setError(errText(e)),
      }
    );
  }

  function addRow() {
    const value = fresh.trim();
    if (!value) {
      setError(t("shutdowns.categoryRequired"));
      return;
    }
    setError(null);
    createMutation.mutate({ category: value } as never, {
      onSuccess: () => {
        setFresh("");
        setActive(null);
      },
      onError: (e) => setError(errText(e)),
    });
  }

  return (
    <AccessHub
      title={t("menus.shutdownCategories")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdown-categories" filenameBase="shutdown-categories" />}
    >
      <table className="access-cont-table max-w-md">
        <thead>
          <tr>
            <th className="w-4" />
            <SortTh k="id" sorter={catSort} className="w-16">{t("menus.number")}</SortTh>
            <SortTh k="category" sorter={catSort}>{t("fields.category")}</SortTh>
            {editable ? <th className="w-20" /> : null}
          </tr>
        </thead>
        <tbody>
          {catSort.sorted.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input className="w-14" value={row.id} readOnly />
              </td>
              <td>
                <input
                  className="w-full"
                  value={drafts[row.id] ?? row.category ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  disabled={!editable}
                />
              </td>
              {editable ? (
                <td onClick={(e) => e.stopPropagation()}>
                  {drafts[row.id] !== undefined ? (
                    <button type="button" className="access-btn text-[11px]" disabled={updateMutation.isPending} onClick={() => saveRow(row)}>
                      {t("common.save")}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
          {editable ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td />
              <td>
                <input className="w-full" value={fresh} onChange={(e) => setFresh(e.target.value)} />
              </td>
              <td>
                <button type="button" className="access-btn text-[11px]" disabled={createMutation.isPending} onClick={addRow}>
                  {t("common.save")}
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {error ? <div className="mt-2 text-[12px] font-bold text-red-800">{error}</div> : null}
    </AccessHub>
  );
}

function SummaryForm({ groupBy, title }: { groupBy: ShutdownGroupBy; title: string }) {
  const { t } = useI18n();
  return (
    <AccessHub title={title} titleBlue backHref="/shutdowns" backLabel={t("mainMenu.shutDown")}>
      <PlantBar />
      <ShutdownAnalysis initialGroupBy={groupBy} />
    </AccessHub>
  );
}

function ShutdownsInner() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const form = searchParams.get("form");
  if (!form) return <ShutdownMenu />;
  if (form === "reasons") return <ReasonsForm />;
  if (form === "trip-causes") return <TripCausesForm />;
  if (form === "categories") return <CategoriesForm />;
  if (form === "period") return <ShutdownListForm showPeriodFilter />;
  if (form === "summary-reason") return <SummaryForm groupBy="reason" title={t("shutdowns.summaryReasonTitle")} />;
  if (form === "summary-category") return <SummaryForm groupBy="category" title={t("shutdowns.summaryCategoryTitle")} />;
  if (form === "summary-trip") return <SummaryForm groupBy="cause" title={t("shutdowns.summaryTripTitle")} />;
  return <ShutdownListForm />;
}

export default function ShutdownsPage() {
  return (
    <Suspense>
      <ShutdownsInner />
    </Suspense>
  );
}


// ---- Click a column title to sort the table ascending, click again for descending, once more to clear.
type SortValue = string | number | null | undefined;
type SortState = { key: string; dir: 1 | -1 } | null;
type Sorter = { sort: SortState; toggle: (key: string) => void };

function useSort<T>(rows: T[], getters: Record<string, (r: T) => SortValue>): Sorter & { sorted: T[] } {
  const [sort, setSort] = useState<SortState>(null);
  const sorted = useMemo(() => {
    const get = sort ? getters[sort.key] : null;
    if (!sort || !get) return rows;
    const empty = (v: SortValue) => v === null || v === undefined || v === "";
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (empty(x) && empty(y)) return 0;
      if (empty(x)) return 1;
      if (empty(y)) return -1;
      const c =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return c * sort.dir;
    });
  }, [rows, sort, getters]);
  const toggle = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  return { sorted, sort, toggle };
}

function SortTh({ k, sorter, className, children }: { k: string; sorter: Sorter; className?: string; children: ReactNode }) {
  const on = sorter.sort?.key === k;
  return (
    <th
      className={`${className || ""} cursor-pointer select-none`}
      onClick={() => sorter.toggle(k)}
      aria-sort={on ? (sorter.sort!.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {children} <span className="opacity-70">{on ? (sorter.sort!.dir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );
}

const SHUTDOWN_SORT: Record<string, (r: Shutdown) => SortValue> = {
  nr: (r) => r.nr,
  plant_part: (r) => plantPartValue(r.plant_part),
  shutdown_time: (r) => r.shutdown_time,
  startup_time: (r) => r.startup_time,
  duration: (r) => durationMinutes(r),
  code: (r) => r.code,
  cause: (r) => r.cause,
  ka_before_trip: (r) => r.ka_before_trip,
  lost_load: (r) => r.lost_load,
  lost_production: (r) => r.lost_production,
  mtbf_days: (r) => r.mtbf_days,
  category: (r) => r.category,
  remarks: (r) => r.remarks,
};
const CAUSE_SORT: Record<string, (r: ShutdownCause) => SortValue> = {
  code: (r) => r.code,
  cause: (r) => r.cause,
  category: (r) => r.category,
};
const CAT_SORT: Record<string, (r: { id: number; category?: string | null }) => SortValue> = {
  id: (r) => r.id,
  category: (r) => r.category,
};
