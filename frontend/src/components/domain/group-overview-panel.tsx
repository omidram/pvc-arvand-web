"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Columns3, RotateCcw } from "lucide-react";
import { groupOverviewApi } from "@/lib/endpoints";
import type { GroupOverviewFilters, GroupOverviewRow, GroupOverviewSummary } from "@/lib/types";
import { useFieldOptions } from "@/lib/use-field-options";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { ExportButtons } from "@/components/domain/export-buttons";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";

type RowWithKey = GroupOverviewRow & { row_key: string };

const STORAGE_KEY = "arvand.groupOverview.hiddenColumns";

/** Columns of the element list, in display order. `spec` columns show the group's definition. */
const COLUMNS = [
  { key: "group_nr", label: "fields.groupNr", fixed: true },
  { key: "group_anode_coating", label: "fields.anodeCoating", spec: true },
  { key: "group_cathode_coating", label: "fields.cathodeCoating", spec: true },
  { key: "group_membrane_type", label: "fields.membraneType", spec: true },
  { key: "group_gap_mm", label: "fields.gapMm", spec: true },
  { key: "element_nr", label: "fields.elementNr", fixed: true },
  { key: "electrolyzer", label: "fields.electrolyzer" },
  { key: "position", label: "fields.positionShort" },
  { key: "status", label: "fields.status" },
  { key: "generation", label: "fields.generation" },
  { key: "anode_nr", label: "fields.anodeNr" },
  { key: "cathode_nr", label: "fields.cathodeNr" },
  { key: "membrane_nr", label: "fields.membraneNr" },
  { key: "anode_coating", label: "fields.anodeCoating", check: true },
  { key: "cathode_coating", label: "fields.cathodeCoating", check: true },
  { key: "membrane_type", label: "fields.membraneType", check: true },
  { key: "gap_mm", label: "fields.gapMm", check: true },
  { key: "assembly_date", label: "fields.assemblyDate" },
  { key: "commissioning_date", label: "fields.commissioningDate" },
  { key: "disassembly_date", label: "fields.disassemblyDate" },
  { key: "dol_days", label: "fields.dolDays" },
  { key: "remarks", label: "fields.remarks" },
] as const;

/** Columns hidden until the user switches them on (Access "Anzeigen" = show/hide per column). */
const DEFAULT_HIDDEN = ["generation", "commissioning_date", "disassembly_date", "remarks"];

function readHidden(): string[] {
  if (typeof window === "undefined") return DEFAULT_HIDDEN;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === "string");
    }
  } catch {
    // ignore unreadable storage
  }
  return DEFAULT_HIDDEN;
}

function saveHidden(hidden: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {
    // storage may be unavailable
  }
}

/** Plain <select> with an "All" entry first; "" means All. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <label className="block min-w-[130px] text-xs font-bold">
      <span className="mb-0.5 block text-[var(--win-muted)]">{label}</span>
      <Select className="h-8 py-0" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    </label>
  );
}

/**
 * Group Overview - the output of Group Definition: all groups with their element counts and, below,
 * every cell element together with the specification of the group it belongs to.
 */
export function GroupOverviewPanel({ initialGroup = "" }: { initialGroup?: string }) {
  const { t } = useI18n();
  const { opts: allOpts } = useFieldOptions("group_definitions");
  // "All" is the wildcard value of a definition, not a filter choice (the empty choice already means All).
  const opts = (field: string) => allOpts(field).filter((o) => o.value.toLowerCase() !== "all");
  const [group, setGroup] = useState(initialGroup);
  const [anodeCoating, setAnodeCoating] = useState("");
  const [cathodeCoating, setCathodeCoating] = useState("");
  const [membraneType, setMembraneType] = useState("");
  const [gap, setGap] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [text, setText] = useState("");
  const [hidden, setHidden] = useState<string[]>(readHidden);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const specFilters: GroupOverviewFilters = useMemo(
    () => ({
      anode_coating: anodeCoating || undefined,
      cathode_coating: cathodeCoating || undefined,
      membrane_type: membraneType || undefined,
      gap_mm: gap || undefined,
    }),
    [anodeCoating, cathodeCoating, membraneType, gap]
  );

  const summaryQuery = useQuery({
    queryKey: ["group-overview", "summary", specFilters],
    queryFn: () => groupOverviewApi.summary(specFilters),
  });
  const summary = useMemo(() => summaryQuery.data || [], [summaryQuery.data]);

  // The group list follows the other filters; a group that no longer fits falls back to "All".
  const groupNumbers = useMemo(() => summary.map((s) => s.group_nr), [summary]);
  const effectiveGroup = !group || groupNumbers.includes(group) ? group : "";

  const filters: GroupOverviewFilters = useMemo(
    () => ({
      ...specFilters,
      group: effectiveGroup || undefined,
      status,
      mismatch_only: mismatchOnly || undefined,
      q: text.trim() || undefined,
    }),
    [specFilters, effectiveGroup, status, mismatchOnly, text]
  );

  const elementsQuery = useQuery({
    queryKey: ["group-overview", "elements", filters],
    queryFn: () => groupOverviewApi.elements(filters),
  });
  const rows: RowWithKey[] = useMemo(
    () => (elementsQuery.data?.rows || []).map((r, i) => ({ ...r, row_key: `${i}` })),
    [elementsQuery.data]
  );

  const allLabel = t("groups.all");
  const statusLabel = (value: string) => {
    const key = `groups.status.${value}`;
    const label = t(key);
    return label === key ? value : label;
  };

  function toggle(key: string) {
    setHidden((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      saveHidden(next);
      return next;
    });
  }
  function resetColumns() {
    setHidden(DEFAULT_HIDDEN);
    saveHidden(DEFAULT_HIDDEN);
  }
  function clearFilters() {
    setGroup("");
    setAnodeCoating("");
    setCathodeCoating("");
    setMembraneType("");
    setGap("");
    setStatus("active");
    setMismatchOnly(false);
    setText("");
  }

  const columns: Column<RowWithKey>[] = COLUMNS.filter((c) => !hidden.includes(c.key)).map((c) => {
    const spec = "spec" in c && c.spec;
    const check = "check" in c && c.check;
    const header = spec ? t("groups.ofGroup", { label: t(c.label) }) : t(c.label);
    return {
      key: c.key,
      header,
      className: spec ? "bg-[#eef3fb]" : undefined,
      filterText: (row) => {
        if (c.key === "status") return statusLabel(row.status);
        const v = (row as unknown as Record<string, unknown>)[c.key];
        return v == null ? "" : String(v);
      },
      render: (row) => {
        const raw = (row as unknown as Record<string, unknown>)[c.key];
        if (c.key === "status") return statusLabel(row.status);
        if (c.key.endsWith("_date")) return formatDate(raw as string | null) || "";
        if (c.key === "group_nr" && !row.defined) {
          return (
            <span className="font-semibold text-[var(--win-danger)]" title={t("groups.undefinedHint")}>
              {row.group_nr}
            </span>
          );
        }
        if (check && row.mismatch.includes(c.key)) {
          return (
            <span
              className="font-bold text-[var(--win-danger)]"
              title={t("groups.deviates", {
                value: String((row as unknown as Record<string, unknown>)[`group_${c.key}`] ?? ""),
              })}
            >
              {String(raw ?? "")}
            </span>
          );
        }
        return raw == null ? "" : String(raw);
      },
    };
  });

  const summaryColumns: Column<GroupOverviewSummary>[] = [
    {
      key: "group_nr",
      header: t("fields.groupNr"),
      render: (r) =>
        r.defined ? r.group_nr : (
          <span className="font-semibold text-[var(--win-danger)]" title={t("groups.undefinedHint")}>
            {r.group_nr}
          </span>
        ),
    },
    { key: "anode_coating", header: t("fields.anodeCoating") },
    { key: "cathode_coating", header: t("fields.cathodeCoating") },
    { key: "membrane_type", header: t("fields.membraneType") },
    { key: "gap_mm", header: t("fields.gapMm") },
    { key: "active_count", header: t("groups.activeElements") },
    { key: "inactive_count", header: t("groups.inactiveElements") },
    {
      key: "mismatch_count",
      header: t("groups.deviations"),
      render: (r) =>
        r.mismatch_count ? <span className="font-bold text-[var(--win-danger)]">{r.mismatch_count}</span> : "0",
    },
    {
      key: "electrolyzers",
      header: t("groups.electrolyzers"),
      render: (r) => r.electrolyzers.join(", "),
      filterText: (r) => r.electrolyzers.join(", "),
    },
    { key: "remarks", header: t("fields.remarks") },
  ];

  const totalActive = summary.reduce((sum, s) => sum + s.active_count, 0);
  const exportParams = filters as Record<string, unknown>;

  if (summaryQuery.error) return <ErrorState message={(summaryQuery.error as Error).message} />;

  return (
    <div className="space-y-4">
      <div className="space-y-2 border-2 border-[var(--win-border-shadow)] [border-style:outset] bg-[var(--win-face)] p-2">
        <div className="flex flex-wrap items-end gap-2">
          <FilterSelect label={t("fields.groupNr")} value={effectiveGroup} onChange={setGroup} options={groupNumbers} allLabel={allLabel} />
          <FilterSelect
            label={t("fields.anodeCoating")}
            value={anodeCoating}
            onChange={setAnodeCoating}
            options={opts("anode_coating").map((o) => o.value)}
            allLabel={allLabel}
          />
          <FilterSelect
            label={t("fields.cathodeCoating")}
            value={cathodeCoating}
            onChange={setCathodeCoating}
            options={opts("cathode_coating").map((o) => o.value)}
            allLabel={allLabel}
          />
          <FilterSelect
            label={t("fields.membraneType")}
            value={membraneType}
            onChange={setMembraneType}
            options={opts("membrane_type").map((o) => o.value)}
            allLabel={allLabel}
          />
          <FilterSelect label={t("fields.gapMm")} value={gap} onChange={setGap} options={opts("gap_mm").map((o) => o.value)} allLabel={allLabel} />
          <label className="block min-w-[130px] text-xs font-bold">
            <span className="mb-0.5 block text-[var(--win-muted)]">{t("groups.show")}</span>
            <Select className="h-8 py-0" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="active">{t("groups.status.active")}</option>
              <option value="inactive">{t("groups.status.inactive")}</option>
              <option value="all">{allLabel}</option>
            </Select>
          </label>
          <label className="block min-w-[160px] text-xs font-bold">
            <span className="mb-0.5 block text-[var(--win-muted)]">{t("fieldLists.search")}</span>
            <Input className="h-8 py-0" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="flex h-8 items-center gap-1 text-xs font-bold">
            <input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} />
            {t("groups.onlyDeviations")}
          </label>
          <Button size="sm" variant="ghost" onClick={clearFilters} title={t("groups.resetFilters")}>
            <RotateCcw size={14} /> {t("groups.resetFilters")}
          </Button>
        </div>
      </div>

      <section>
        <h3 className="mb-1 text-sm font-bold">
          {t("groups.activeGroups")} <span className="font-normal text-[var(--win-muted)]">({summary.length} · {totalActive} {t("groups.elementsShort")})</span>
        </h3>
        <p className="mb-1 text-xs text-[var(--win-muted)]">{t("groups.summaryHint")}</p>
        {summaryQuery.isLoading ? (
          <LoadingState />
        ) : (
          <DataTable<GroupOverviewSummary>
            columns={summaryColumns}
            data={summary}
            keyField="group_nr"
            selectedKey={effectiveGroup || null}
            onRowClick={(row) => setGroup(row.group_nr === effectiveGroup ? "" : row.group_nr)}
            maxHeight="min(32vh, 320px)"
          />
        )}
      </section>

      <section>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">
            {t("groups.elementList")}{" "}
            <span className="font-normal text-[var(--win-muted)]">
              ({elementsQuery.data?.total ?? 0}
              {elementsQuery.data && elementsQuery.data.total > rows.length ? ` / ${t("groups.shown", { count: String(rows.length) })}` : ""})
            </span>
          </h3>
          <div className="relative flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setColumnsOpen((v) => !v)}>
              <Columns3 size={14} /> {t("groups.displayColumns")}
            </Button>
            <ExportButtons prefix="/group-overview" params={exportParams} filenameBase="group-overview" allowImport={false} />
            {columnsOpen ? (
              <div className="absolute end-0 top-9 z-30 max-h-[60vh] w-64 overflow-auto border-2 border-[var(--win-border-shadow)] [border-style:outset] bg-[var(--win-face)] p-2 shadow-lg">
                <div className="mb-1 flex items-center justify-between text-xs font-bold">
                  <span>{t("groups.displayColumns")}</span>
                  <button type="button" className="underline" onClick={resetColumns}>
                    {t("groups.defaultColumns")}
                  </button>
                </div>
                {COLUMNS.map((c) => {
                  const spec = "spec" in c && c.spec;
                  const fixed = "fixed" in c && c.fixed;
                  return (
                    <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                      <input type="checkbox" disabled={fixed} checked={!hidden.includes(c.key)} onChange={() => toggle(c.key)} />
                      {spec ? t("groups.ofGroup", { label: t(c.label) }) : t(c.label)}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        <DataTable<RowWithKey>
          columns={columns}
          data={rows}
          keyField="row_key"
          isLoading={elementsQuery.isLoading}
          emptyTitle={t("groups.noElements")}
          maxHeight="min(60vh, 640px)"
        />
      </section>
    </div>
  );
}
