"use client";

import { Suspense, useMemo, useState } from "react";
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
  const headerDate = s?.date ? formatDate(s.date) : formatDate(new Date().toISOString().slice(0, 10));
  return (
    <div className="access-plant-bar shutdown-plant-bar">
      <span>{s?.customer || "PVC Arvand"}</span>
      <span>{t("menus.naclElectrolysis")}</span>
      <span>{headerDate === "—" || headerDate === "d" ? formatDate(new Date().toISOString().slice(0, 10)) : headerDate}</span>
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
  const totalMins = shown.reduce((sum, r) => sum + (durationMinutes(r) ?? 0), 0);
  const totalHm = `${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")}`;

  function fieldVisible(field: string) {
    return canViewField("shutdowns", field);
  }

  function saveRow(row: Shutdown, patch: Partial<Shutdown>) {
    if (!editable) return;
    updateMutation.mutate({
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
    });
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
        },
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
          {t("shutdowns.totalDuration")}: {totalHm} &nbsp;·&nbsp; {t("shutdowns.totalShutdowns")}: {shown.length}
        </div>
      </div>
      <div className="overflow-auto shutdown-list-scroll">
        <table className="access-cont-table shutdown-list-table min-w-[1600px]">
          <thead>
            <tr>
              <th className="w-4" />
              <th className="w-12">{t("menus.number")}</th>
              {fieldVisible("plant_part") ? <th className="w-28">{t("menus.partOfPlant")}</th> : null}
              {fieldVisible("shutdown_time") ? <th className="w-40">{t("fields.shutdownTime")}</th> : null}
              {fieldVisible("startup_time") ? <th className="w-40">{t("fields.startupTime")}</th> : null}
              <th className="w-24">{t("fields.durationHm")}</th>
              {fieldVisible("code") ? <th className="w-16">{t("fields.code")}</th> : null}
              {fieldVisible("cause") ? <th className="w-44">{t("fields.cause")}</th> : null}
              {fieldVisible("ka_before_trip") ? <th className="w-24">{t("fields.kaBeforeTrip")}</th> : null}
              {fieldVisible("lost_load") ? <th className="w-28">{t("fields.lostLoad")}</th> : null}
              {fieldVisible("lost_production") ? <th className="w-28">{t("fields.lostProduction")}</th> : null}
              {fieldVisible("mtbf_days") ? <th className="w-24">{t("fields.mtbfDays")}</th> : null}
              {fieldVisible("category") ? <th className="w-28">{t("fields.category")}</th> : null}
              {fieldVisible("remarks") ? <th>{t("fields.remarks")}</th> : null}
              {editable ? <th className="w-36" /> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
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
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
                      value={toLocalInput(src.shutdown_time)}
                      disabled={!open}
                      onChange={(e) => setEditDraft((d) => ({ ...d, shutdown_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
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
                    <input className="w-24 text-center tabular-nums" value={open ? "" : (row.lost_load ?? "")} readOnly tabIndex={-1} title="Chlorine lost = duration × KA / 4.85" />
                  </td>
                ) : null}
                {fieldVisible("lost_production") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value={open ? "" : (row.lost_production ?? "")} readOnly tabIndex={-1} title="NaOH lost = chlorine lost × 1.112" />
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
                            saveRow(src, {});
                            setEditing(null);
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
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
                      value={toLocalInput(draft.shutdown_time)}
                      onChange={(e) => setDraft((d) => ({ ...d, shutdown_time: toApiDateTime(e.target.value) }))}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td>
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
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
                    <input className="w-24 text-center tabular-nums" value="" readOnly tabIndex={-1} title="Duration × KA / 4.85" />
                  </td>
                ) : null}
                {fieldVisible("lost_production") ? (
                  <td>
                    <input className="w-24 text-center tabular-nums" value="" readOnly tabIndex={-1} title="NaOH lost = chlorine lost × 1.112" />
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
    </AccessHub>
  );
}

function ReasonsForm() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const { listQuery, createMutation, updateMutation } = useCrudResource<ShutdownCause>(
    "shutdown-causes",
    shutdownCausesApi,
    { limit: 500 }
  );
  const categoriesQuery = useQuery({
    queryKey: ["shutdown-categories", "combo"],
    queryFn: () => shutdownCategoriesApi.list({ limit: 200 }),
  });
  const rows = listQuery.data || [];
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(categoriesQuery.data || []).map((c) => c.category || "").filter(Boolean),
          ...rows.map((r) => r.category || "").filter(Boolean),
        ])
      ).sort(),
    [categoriesQuery.data, rows]
  );

  function save(row: ShutdownCause, patch: Partial<ShutdownCause>) {
    if (!editable) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, ...patch } });
  }

  return (
    <AccessHub
      title={t("shutdowns.reasonsTitle")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdown-causes" filenameBase="shutdown-causes" />}
    >
      <table className="access-cont-table max-w-3xl">
        <thead>
          <tr>
            <th className="w-4" />
            <th className="w-20">{t("fields.code")}</th>
            <th>{t("fields.reason")}</th>
            <th className="w-40">{t("fields.category")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input
                  className="w-16"
                  value={row.code || ""}
                  onChange={(e) => save(row, { code: e.target.value })}
                  disabled={!editable}
                />
              </td>
              <td>
                <input
                  className="w-full"
                  value={row.cause || ""}
                  onChange={(e) => save(row, { cause: e.target.value || null })}
                  disabled={!editable}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <ComboInput
                  listId={`reason-cat-${row.id}`}
                  options={categoryOptions}
                  value={row.category || ""}
                  disabled={!editable}
                  onChange={(v) => save(row, { category: v })}
                />
              </td>
            </tr>
          ))}
          {editable ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td>
                <input
                  className="w-16"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const code = (e.target as HTMLInputElement).value.trim();
                      if (code) {
                        createMutation.mutate({ code, cause: code } as never);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
              </td>
              <td colSpan={2} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </AccessHub>
  );
}

function TripCausesForm() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const { listQuery, createMutation, updateMutation } = useCrudResource<ShutdownCause>(
    "shutdown-causes",
    shutdownCausesApi,
    { limit: 500 }
  );
  const rows = useMemo(
    () => [...(listQuery.data || [])].filter((row) => (row.cause || "").trim()).sort((a, b) => (a.cause || "").localeCompare(b.cause || "")),
    [listQuery.data]
  );

  function save(row: ShutdownCause, cause: string) {
    if (!editable) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, cause: cause || null } });
  }

  return (
    <AccessHub
      title={t("menus.tripCause")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdown-causes" filenameBase="trip-causes" />}
    >
      <table className="access-cont-table mb-4 max-w-xl">
        <thead>
          <tr>
            <th className="w-4" />
            <th>{t("menus.tripCause")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input
                  className="w-full"
                  value={row.cause || ""}
                  onChange={(e) => save(row, e.target.value)}
                  disabled={!editable}
                />
              </td>
            </tr>
          ))}
          {editable ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td>
                <input
                  className="w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const cause = (e.target as HTMLInputElement).value.trim();
                      if (cause) {
                        createMutation.mutate({ cause } as never);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
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
  const { listQuery, createMutation, updateMutation } = useCrudResource<ShutdownCategory>(
    "shutdown-categories",
    shutdownCategoriesApi,
    { limit: 200 }
  );
  const rows = listQuery.data || [];

  function save(row: ShutdownCategory, patch: Partial<ShutdownCategory>) {
    if (!editable) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, ...patch } });
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
            <th className="w-16">{t("menus.number")}</th>
            <th>{t("fields.category")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input className="w-14" value={row.id} readOnly />
              </td>
              <td>
                <input
                  className="w-full"
                  value={row.category || ""}
                  onChange={(e) => save(row, { category: e.target.value })}
                  disabled={!editable}
                />
              </td>
            </tr>
          ))}
          {editable ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td />
              <td>
                <input
                  className="w-full"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const category = (e.target as HTMLInputElement).value.trim();
                      if (category) {
                        createMutation.mutate({ category } as never);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
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
