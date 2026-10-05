"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  shutdownsApi,
  shutdownCategoriesApi,
  shutdownCausesApi,
  shutdownSummaryApi,
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

function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  // Access-style wall times: prefer the stored local string; fall back for ISO-Z values.
  if (!value.endsWith("Z") && value.includes("T")) return value.slice(0, 16);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationMinutes(row: Shutdown): number | null {
  if (row.duration_hours != null && !Number.isNaN(row.duration_hours)) {
    return Math.max(0, Math.round(row.duration_hours * 60));
  }
  if (!row.shutdown_time || !row.startup_time) return null;
  const a = new Date(row.shutdown_time).getTime();
  const b = new Date(row.startup_time).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 60000));
}

function durationHm(row: Shutdown): string {
  const mins = durationMinutes(row);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
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
      <span>{s?.uan || "03-3039"}</span>
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
  const [from, setFrom] = useState(dateFrom || "");
  const [to, setTo] = useState(dateTo || "");
  const [draft, setDraft] = useState<Partial<Shutdown>>({});

  const listParams = useMemo(() => {
    const params: Record<string, unknown> = { limit: 2000 };
    if (from) params.date_from = new Date(from).toISOString();
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      params.date_to = end.toISOString();
    }
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

  const rows = listQuery.data || [];
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

  const totalMins = rows.reduce((sum, r) => sum + (durationMinutes(r) ?? 0), 0);
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
    else if (row) saveRow(row, patch);
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
    else if (row) saveRow(row, patch);
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
                setDraft({ shutdown_time: new Date().toISOString().slice(0, 16) });
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
        </div>
        <div className="shutdown-summary-chip font-bold">
          {t("shutdowns.totalDuration")}: {totalHm} &nbsp;·&nbsp; {t("shutdowns.totalShutdowns")}: {rows.length}
        </div>
      </div>
      <div className="overflow-auto shutdown-list-scroll">
        <table className="access-cont-table shutdown-list-table min-w-[1100px]">
          <thead>
            <tr>
              <th className="w-4" />
              <th className="w-12">{t("menus.number")}</th>
              {fieldVisible("plant_part") ? <th className="w-28">{t("menus.partOfPlant")}</th> : null}
              {fieldVisible("shutdown_time") ? <th className="w-40">{t("fields.shutdownTime")}</th> : null}
              {fieldVisible("startup_time") ? <th className="w-40">{t("fields.startupTime")}</th> : null}
              <th className="w-24">{t("fields.durationHm")}</th>
              {fieldVisible("code") ? <th className="w-16">{t("fields.code")}</th> : null}
              {fieldVisible("cause") ? <th className="w-44">{t("fields.reason")}</th> : null}
              {fieldVisible("category") ? <th className="w-28">{t("fields.category")}</th> : null}
              {fieldVisible("remarks") ? <th>{t("fields.remarks")}</th> : null}
              {editable ? <th className="w-16" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nr} onClick={() => setActive(row.nr)} className={active === row.nr ? "is-active-row" : undefined}>
                <td className="access-selector">{active === row.nr ? "►" : ""}</td>
                <td>
                  <input className="w-12" value={row.nr} readOnly tabIndex={-1} />
                </td>
                {fieldVisible("plant_part") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    {editable ? (
                      <ElectrolyzerCombo
                        variant="access"
                        className="w-full min-w-[4rem]"
                        value={row.plant_part || ""}
                        onChange={(v) => saveRow(row, { plant_part: formatElectrolyzer(v) || v || null })}
                      />
                    ) : (
                      <span className="block px-1">{formatElectrolyzer(row.plant_part) || row.plant_part || "—"}</span>
                    )}
                  </td>
                ) : null}
                {fieldVisible("shutdown_time") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
                      value={toLocalInput(row.shutdown_time)}
                      disabled={!editable}
                      onChange={(e) => saveRow(row, { shutdown_time: toApiDateTime(e.target.value) })}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="datetime-local"
                      className="w-full tabular-nums"
                      value={toLocalInput(row.startup_time)}
                      disabled={!editable}
                      onChange={(e) => saveRow(row, { startup_time: toApiDateTime(e.target.value) })}
                    />
                  </td>
                ) : null}
                <td>
                  <input className="w-20 text-center font-semibold tabular-nums" value={durationHm(row)} readOnly tabIndex={-1} />
                </td>
                {fieldVisible("code") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ComboInput
                      listId={`sd-code-${row.nr}`}
                      options={codeOptions}
                      value={row.code || ""}
                      disabled={!editable}
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
                      value={row.cause || ""}
                      disabled={!editable}
                      onChange={(v) => applyCause(row, v, false)}
                    />
                  </td>
                ) : null}
                {fieldVisible("category") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ComboInput
                      listId={`sd-cat-${row.nr}`}
                      options={categoryOptions}
                      value={row.category || ""}
                      disabled={!editable}
                      onChange={(v) => saveRow(row, { category: v || null })}
                    />
                  </td>
                ) : null}
                {fieldVisible("remarks") ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      className="w-full"
                      value={row.remarks || ""}
                      disabled={!editable}
                      onChange={(e) => saveRow(row, { remarks: e.target.value || null })}
                    />
                  </td>
                ) : null}
                {editable ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="access-btn text-[11px]"
                      onClick={() => {
                        if (confirm(t("shutdowns.confirmDelete", { nr: String(row.nr) }))) removeMutation.mutate(row.nr);
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
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
                      value={draft.plant_part || ""}
                      onChange={(v) => setDraft((d) => ({ ...d, plant_part: formatElectrolyzer(v) || v || null }))}
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
                  <input className="w-20 text-center" value="" readOnly tabIndex={-1} />
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

function SummaryReasonForm() {
  const { t } = useI18n();
  const summaryQuery = useQuery({ queryKey: ["shutdowns", "summary"], queryFn: shutdownSummaryApi.get });
  const rows = summaryQuery.data?.by_reason || [];
  return (
    <AccessHub title={t("shutdowns.summaryReasonTitle")} titleBlue backHref="/shutdowns" backLabel={t("mainMenu.shutDown")}>
      <PlantBar />
      <table className="access-cont-table max-w-4xl">
        <thead>
          <tr>
            <th className="w-16">{t("fields.code")}</th>
            <th>{t("fields.reason")}</th>
            <th className="w-32">{t("fields.category")}</th>
            <th className="w-20">{t("shutdowns.count")}</th>
            <th className="w-28">{t("fields.durationHm")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const mins = Math.max(0, Math.round((row.total_hours || 0) * 60));
            const hm = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
            return (
            <tr key={`${row.code}-${row.cause}-${idx}`}>
              <td>{row.code}</td>
              <td>{row.cause}</td>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td>{hm}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 text-[12px] font-bold">
        {t("shutdowns.totalShutdowns")}: {summaryQuery.data?.total_shutdowns ?? 0} &nbsp;·&nbsp;
        {t("shutdowns.totalDuration")}:{" "}
        {(() => {
          const mins = Math.max(0, Math.round((summaryQuery.data?.total_hours ?? 0) * 60));
          return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
        })()}
      </div>
    </AccessHub>
  );
}

function SummaryCategoryForm() {
  const { t } = useI18n();
  const summaryQuery = useQuery({ queryKey: ["shutdowns", "summary"], queryFn: shutdownSummaryApi.get });
  const rows = summaryQuery.data?.by_category || [];
  return (
    <AccessHub title={t("shutdowns.summaryCategoryTitle")} titleBlue backHref="/shutdowns" backLabel={t("mainMenu.shutDown")}>
      <PlantBar />
      <table className="access-cont-table max-w-xl">
        <thead>
          <tr>
            <th>{t("fields.category")}</th>
            <th className="w-20">{t("shutdowns.count")}</th>
            <th className="w-28">{t("fields.durationHm")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const mins = Math.max(0, Math.round((row.total_hours || 0) * 60));
            const hm = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
            return (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td>{hm}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 text-[12px] font-bold">
        {t("shutdowns.totalShutdowns")}: {summaryQuery.data?.total_shutdowns ?? 0} &nbsp;·&nbsp;
        {t("shutdowns.totalDuration")}:{" "}
        {(() => {
          const mins = Math.max(0, Math.round((summaryQuery.data?.total_hours ?? 0) * 60));
          return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
        })()}
      </div>
    </AccessHub>
  );
}

function ShutdownsInner() {
  const searchParams = useSearchParams();
  const form = searchParams.get("form");
  if (!form) return <ShutdownMenu />;
  if (form === "reasons") return <ReasonsForm />;
  if (form === "categories") return <CategoriesForm />;
  if (form === "period") return <ShutdownListForm showPeriodFilter />;
  if (form === "summary-reason") return <SummaryReasonForm />;
  if (form === "summary-category") return <SummaryCategoryForm />;
  return <ShutdownListForm />;
}

export default function ShutdownsPage() {
  return (
    <Suspense>
      <ShutdownsInner />
    </Suspense>
  );
}
