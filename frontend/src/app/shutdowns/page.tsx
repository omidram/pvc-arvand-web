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
  electrolyzersApi,
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

const BASE_PLANT_PARTS = ["081", "082", "A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "J1", "K1", "L1", "M1"];

function toLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  // Access-style wall times: prefer the stored local string; fall back for ISO-Z values.
  if (!value.endsWith("Z") && value.includes("T")) return value.slice(0, 16);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  return value.length === 16 ? `${value}:00` : value;
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
  return (
    <div className="access-plant-bar shutdown-plant-bar">
      <span>{s?.customer || "PVC Arvand"}</span>
      <span>{t("menus.naclElectrolysis")}</span>
      <span>{s?.uan || "E0-3031"}</span>
      <span>{s?.version || (s?.date ? formatDate(s.date) : "")}</span>
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

function ShutdownListForm({ dateFrom, dateTo, showPeriodFilter }: { dateFrom?: string; dateTo?: string; showPeriodFilter?: boolean }) {
  const { t } = useI18n();
  const { canEdit, canEditField, canViewField } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const [from, setFrom] = useState(dateFrom || "");
  const [to, setTo] = useState(dateTo || "");
  const [newPart, setNewPart] = useState("");

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

  const { listQuery, createMutation, updateMutation } = useCrudResource<Shutdown>("shutdowns", shutdownsApi, listParams);
  const causesQuery = useQuery({
    queryKey: ["shutdown-causes", { limit: 500 }],
    queryFn: () => shutdownCausesApi.list({ limit: 500 }),
  });
  const categoriesQuery = useQuery({
    queryKey: ["shutdown-categories", { limit: 200 }],
    queryFn: () => shutdownCategoriesApi.list({ limit: 200 }),
  });
  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });

  const rows = listQuery.data || [];
  const causes = causesQuery.data || [];
  const categories = categoriesQuery.data || [];
  const totalMins = rows.reduce((sum, r) => sum + (durationMinutes(r) ?? 0), 0);
  const totalHm = `${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")}`;

  const plantParts = useMemo(() => {
    const names = (elQuery.data || []).map((e) => e.name).filter(Boolean) as string[];
    const existing = rows.map((r) => r.plant_part).filter(Boolean) as string[];
    return Array.from(new Set([...BASE_PLANT_PARTS, ...names, ...existing])).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }, [elQuery.data, rows]);

  function fieldEditable(field: string) {
    return editable && canEditField("shutdowns", field);
  }
  function fieldVisible(field: string) {
    return canViewField("shutdowns", field);
  }

  function save(row: Shutdown, patch: Partial<Shutdown>) {
    const keys = Object.keys(patch);
    if (!keys.every((k) => fieldEditable(k))) return;
    updateMutation.mutate({ id: row.nr, payload: { ...row, ...patch } });
  }

  function applyCode(row: Shutdown, code: string) {
    const match = causes.find((c) => (c.code || "").toLowerCase() === code.toLowerCase());
    save(row, {
      code,
      cause: match?.cause ?? row.cause,
      category: match?.category ?? row.category,
    });
  }

  return (
    <AccessHub
      title={showPeriodFilter ? t("shutdowns.periodTitle") : t("menus.shutdownList")}
      titleBlue
      backHref="/shutdowns"
      backLabel={t("mainMenu.shutDown")}
      extraButtons={<ExportButtons prefix="/shutdowns" params={listParams} filenameBase="shutdowns" />}
    >
      <PlantBar />
      <div className="shutdown-list-toolbar mb-3 flex flex-wrap items-end justify-between gap-3 text-[12px]">
        {showPeriodFilter ? (
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
        ) : (
          <div />
        )}
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nr} onClick={() => setActive(row.nr)} className={active === row.nr ? "is-active-row" : undefined}>
                <td className="access-selector">{active === row.nr ? "►" : ""}</td>
                <td>
                  <input className="w-12" value={row.nr} readOnly />
                </td>
                {fieldVisible("plant_part") ? (
                  <td>
                    <select
                      className="w-full"
                      value={row.plant_part || ""}
                      onChange={(e) => save(row, { plant_part: e.target.value || null })}
                      disabled={!fieldEditable("plant_part")}
                    >
                      <option value="" />
                      {plantParts.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      {row.plant_part && !plantParts.includes(row.plant_part) ? (
                        <option value={row.plant_part}>{row.plant_part}</option>
                      ) : null}
                    </select>
                  </td>
                ) : null}
                {fieldVisible("shutdown_time") ? (
                  <td>
                    <DateInput
                      type="datetime-local"
                      value={toLocalInput(row.shutdown_time)}
                      onChange={(e) => save(row, { shutdown_time: fromLocalInput(e.target.value) })}
                      disabled={!fieldEditable("shutdown_time")}
                    />
                  </td>
                ) : null}
                {fieldVisible("startup_time") ? (
                  <td>
                    <DateInput
                      type="datetime-local"
                      value={toLocalInput(row.startup_time)}
                      onChange={(e) => save(row, { startup_time: fromLocalInput(e.target.value) })}
                      disabled={!fieldEditable("startup_time")}
                    />
                  </td>
                ) : null}
                <td>
                  <input className="w-20 text-center font-semibold tabular-nums" value={durationHm(row)} readOnly />
                </td>
                {fieldVisible("code") ? (
                  <td>
                    <input
                      className="w-14"
                      list="shutdown-codes"
                      value={row.code || ""}
                      onChange={(e) => applyCode(row, e.target.value)}
                      disabled={!fieldEditable("code")}
                    />
                  </td>
                ) : null}
                {fieldVisible("cause") ? (
                  <td>
                    <input
                      className="w-full"
                      list="shutdown-causes"
                      value={row.cause || ""}
                      onChange={(e) => save(row, { cause: e.target.value || null })}
                      disabled={!fieldEditable("cause")}
                    />
                  </td>
                ) : null}
                {fieldVisible("category") ? (
                  <td>
                    <select
                      className="w-full"
                      value={row.category || ""}
                      onChange={(e) => save(row, { category: e.target.value || null })}
                      disabled={!fieldEditable("category")}
                    >
                      <option value="" />
                      {categories.map((c) => (
                        <option key={c.id} value={c.category || ""}>
                          {c.category}
                        </option>
                      ))}
                      {row.category && !categories.some((c) => c.category === row.category) ? (
                        <option value={row.category}>{row.category}</option>
                      ) : null}
                    </select>
                  </td>
                ) : null}
                {fieldVisible("remarks") ? (
                  <td>
                    <input
                      className="w-full"
                      value={row.remarks || ""}
                      onChange={(e) => save(row, { remarks: e.target.value })}
                      disabled={!fieldEditable("remarks")}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
            {fieldEditable("plant_part") ? (
              <tr onClick={() => setActive("new")}>
                <td className="access-selector">*</td>
                <td />
                <td>
                  <select
                    className="w-full"
                    value={newPart}
                    onChange={(e) => {
                      const plant_part = e.target.value;
                      setNewPart(plant_part);
                      if (plant_part) {
                        createMutation.mutate(
                          {
                            plant_part,
                            shutdown_time: new Date().toISOString().slice(0, 19),
                          } as never,
                          { onSuccess: () => setNewPart("") }
                        );
                      }
                    }}
                  >
                    <option value="">{t("menus.partOfPlant")}</option>
                    {plantParts.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td colSpan={7} className="text-[11px] text-[#404040]">
                  {t("shutdowns.newRowHint")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <datalist id="shutdown-codes">
        {Array.from(new Set(causes.map((c) => c.code).filter(Boolean))).map((code) => (
          <option key={code!} value={code!} />
        ))}
      </datalist>
      <datalist id="shutdown-causes">
        {causes.map((c) => (
          <option key={c.id} value={c.cause || ""} />
        ))}
      </datalist>
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
  const rows = listQuery.data || [];

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
