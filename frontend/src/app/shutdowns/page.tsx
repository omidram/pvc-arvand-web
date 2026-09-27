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
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatNumber } from "@/lib/utils";

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

function durationHours(row: Shutdown): string {
  if (row.duration_hours != null) return formatNumber(row.duration_hours);
  if (!row.shutdown_time || !row.startup_time) return "";
  const a = new Date(row.shutdown_time).getTime();
  const b = new Date(row.startup_time).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  return formatNumber(Math.max((b - a) / 3600000, 0));
}

function PlantBar() {
  const { t } = useI18n();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const s = settingsQuery.data;
  return (
    <div className="access-plant-bar">
      <span>{s?.customer || "PVC Arvand"}</span>
      <span>{s?.plant_type === "KOH" ? t("menus.kohElectrolysis") : t("menus.naclElectrolysis")}</span>
      <span>{s?.uan || "E0-3031"}</span>
      <span>{s?.version || s?.date?.slice(0, 10) || ""}</span>
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
            <AccessBtn href="/shutdowns?form=summary-reason">{t("menus.shutdownReasons")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=period">{t("menus.timePeriod")}</AccessBtn>
            <AccessBtn href="/shutdowns?form=summary-category">{t("menus.category")}</AccessBtn>
          </div>
        </div>
      </div>
    </AccessHub>
  );
}

function ShutdownListForm({ dateFrom, dateTo, showPeriodFilter }: { dateFrom?: string; dateTo?: string; showPeriodFilter?: boolean }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("shutdowns");
  const [active, setActive] = useState<number | "new" | null>(null);
  const [from, setFrom] = useState(dateFrom || "");
  const [to, setTo] = useState(dateTo || "");

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

  const rows = listQuery.data || [];
  const causes = causesQuery.data || [];
  const categories = categoriesQuery.data || [];
  const totalHours = rows.reduce((sum, r) => sum + (r.duration_hours ?? 0), 0);

  function save(row: Shutdown, patch: Partial<Shutdown>) {
    if (!editable) return;
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
    >
      <PlantBar />
      {showPeriodFilter ? (
        <div className="mb-3 flex flex-wrap items-end gap-3 text-[12px]">
          <label className="flex flex-col gap-1">
            <span>{t("menus.from")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("menus.till")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="font-bold">
            {t("shutdowns.totalDuration")}: {formatNumber(totalHours)} h &nbsp;·&nbsp; {t("shutdowns.totalShutdowns")}:{" "}
            {rows.length}
          </div>
        </div>
      ) : null}
      <div className="overflow-auto">
        <table className="access-cont-table min-w-[1100px]">
          <thead>
            <tr>
              <th className="w-4" />
              <th className="w-12">{t("menus.number")}</th>
              <th className="w-28">{t("menus.partOfPlant")}</th>
              <th className="w-40">{t("fields.shutdownTime")}</th>
              <th className="w-40">{t("fields.startupTime")}</th>
              <th className="w-24">{t("fields.durationHours")}</th>
              <th className="w-16">{t("fields.code")}</th>
              <th className="w-44">{t("fields.reason")}</th>
              <th className="w-28">{t("fields.category")}</th>
              <th>{t("fields.remarks")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nr} onClick={() => setActive(row.nr)}>
                <td className="access-selector">{active === row.nr ? "►" : ""}</td>
                <td>
                  <input className="w-12" value={row.nr} readOnly />
                </td>
                <td>
                  <input
                    className="w-full"
                    value={row.plant_part || ""}
                    onChange={(e) => save(row, { plant_part: e.target.value })}
                    disabled={!editable}
                  />
                </td>
                <td>
                  <input
                    type="datetime-local"
                    value={toLocalInput(row.shutdown_time)}
                    onChange={(e) => save(row, { shutdown_time: fromLocalInput(e.target.value) })}
                    disabled={!editable}
                  />
                </td>
                <td>
                  <input
                    type="datetime-local"
                    value={toLocalInput(row.startup_time)}
                    onChange={(e) => save(row, { startup_time: fromLocalInput(e.target.value) })}
                    disabled={!editable}
                  />
                </td>
                <td>
                  <input className="w-20" value={durationHours(row)} readOnly />
                </td>
                <td>
                  <input
                    className="w-14"
                    list="shutdown-codes"
                    value={row.code || ""}
                    onChange={(e) => applyCode(row, e.target.value)}
                    disabled={!editable}
                  />
                </td>
                <td>
                  <input
                    className="w-full"
                    list="shutdown-causes"
                    value={row.cause || ""}
                    onChange={(e) => save(row, { cause: e.target.value || null })}
                    disabled={!editable}
                  />
                </td>
                <td>
                  <select
                    className="w-full"
                    value={row.category || ""}
                    onChange={(e) => save(row, { category: e.target.value || null })}
                    disabled={!editable}
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
                <td>
                  <input
                    className="w-full"
                    value={row.remarks || ""}
                    onChange={(e) => save(row, { remarks: e.target.value })}
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
                    placeholder={t("menus.partOfPlant")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const plant_part = (e.target as HTMLInputElement).value.trim();
                        if (plant_part) {
                          createMutation.mutate({
                            plant_part,
                            shutdown_time: new Date().toISOString(),
                          } as never);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }
                    }}
                  />
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
    <AccessHub title={t("shutdowns.reasonsTitle")} titleBlue backHref="/shutdowns" backLabel={t("mainMenu.shutDown")}>
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
    <AccessHub title={t("menus.shutdownCategories")} titleBlue backHref="/shutdowns" backLabel={t("mainMenu.shutDown")}>
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
            <th className="w-28">{t("fields.durationHours")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.code}-${row.cause}-${idx}`}>
              <td>{row.code}</td>
              <td>{row.cause}</td>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td>{formatNumber(row.total_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-[12px] font-bold">
        {t("shutdowns.totalShutdowns")}: {summaryQuery.data?.total_shutdowns ?? 0} &nbsp;·&nbsp;
        {t("shutdowns.totalDuration")}: {formatNumber(summaryQuery.data?.total_hours ?? 0)} h
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
            <th className="w-28">{t("fields.durationHours")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td>{row.count}</td>
              <td>{formatNumber(row.total_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-[12px] font-bold">
        {t("shutdowns.totalShutdowns")}: {summaryQuery.data?.total_shutdowns ?? 0} &nbsp;·&nbsp;
        {t("shutdowns.totalDuration")}: {formatNumber(summaryQuery.data?.total_hours ?? 0)} h
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
