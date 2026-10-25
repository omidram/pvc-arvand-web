"use client";

import { cn, formatDisplayedDate } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./spinner";
import { ColumnValueFilter } from "./column-value-filter";
import { applySheetFilters, sortSheetRows, tableCellText, useSheetFilters } from "./table-sheet";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { useMemo } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  /** Plain text used for search, column filters, and sorting. Defaults to the cell value. */
  filterText?: (row: T) => string;
}

export function DataTable<T extends object>({
  columns,
  data,
  keyField,
  selectedKey,
  onRowClick,
  isLoading,
  emptyTitle,
  emptyDescription,
  actions,
  filters,
  onFilter,
  valueFilters,
  onValueFilter,
  filterOptions,
  getFilterOptions,
  sortKey,
  sortDir,
  onSort,
  onRowDoubleClick,
  maxHeight = "min(70vh, 760px)",
  disableFilters = false,
}: {
  columns: Column<T>[];
  data: T[] | undefined;
  keyField: keyof T;
  selectedKey?: string | number | null;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  actions?: (row: T) => React.ReactNode;
  filters?: Record<string, string>;
  onFilter?: (key: string, value: string) => void;
  /** null = all values; string[] = only these cell texts. */
  valueFilters?: Record<string, string[] | null>;
  onValueFilter?: (key: string, values: string[] | null) => void;
  filterOptions?: Record<string, string[]>;
  getFilterOptions?: (key: string) => string[];
  sortKey?: string | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  onRowDoubleClick?: (row: T) => void;
  maxHeight?: string;
  disableFilters?: boolean;
}) {
  const { t } = useI18n();
  useCalendar();
  const source = data ?? [];
  const sheet = useSheetFilters(columns, source);
  const textFilters = filters ?? sheet.filters;
  const pickFilters = valueFilters ?? sheet.valueFilters;
  const handleFilter = onFilter ?? sheet.onFilter;
  const handleValueFilter = onValueFilter ?? sheet.onValueFilter;
  const handleSort = onSort ?? sheet.onSort;
  const activeSortKey = sortKey ?? sheet.sortKey;
  const activeSortDir = sortDir ?? sheet.sortDir;
  const optionsFn = getFilterOptions ?? sheet.getFilterOptions;

  const rows = useMemo(() => {
    const filtered = applySheetFilters(source, columns, textFilters, pickFilters);
    if (onSort) return filtered;
    return sortSheetRows(filtered, columns, activeSortKey, activeSortDir);
  }, [source, columns, textFilters, pickFilters, onSort, activeSortKey, activeSortDir]);

  if (isLoading) return <LoadingState />;

  const showFilterRow = !disableFilters;
  if (!showFilterRow && rows.length === 0) {
    return <EmptyState title={emptyTitle ?? t("common.noRecordsFound")} description={emptyDescription} />;
  }

  return (
    <div
      className="ui-table-wrap max-w-full overflow-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)]"
      style={{ maxHeight }}
    >
      <table className="ui-table w-max min-w-full border-collapse text-center text-xs">
        <thead>
          <tr className="bg-[var(--win-face)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "sticky top-0 z-[2] whitespace-nowrap border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-1.5 text-center font-bold text-[var(--win-text)]",
                  "cursor-pointer select-none",
                  col.className
                )}
                onClick={() => handleSort(col.key)}
              >
                {col.header}
                {activeSortKey === col.key ? (activeSortDir === "desc" ? " ↓" : " ↑") : ""}
              </th>
            ))}
            {actions && (
              <th className="sticky top-0 z-[2] whitespace-nowrap border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-1.5 text-center font-bold text-[var(--win-text)]">
                {t("common.actions")}
              </th>
            )}
          </tr>
          {showFilterRow ? (
            <tr className="bg-[var(--win-face)]">
              {columns.map((col) => {
                const options = filterOptions?.[col.key];
                const valueSel = pickFilters[col.key] ?? null;
                const valueActive = valueSel != null;
                return (
                  <th key={col.key} className="dt-filter-th sticky top-[28px] z-[3] border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-1 py-1">
                    <div className="dt-filter-cell">
                      <input
                        value={textFilters[col.key] ?? ""}
                        placeholder={t("access.columnFilter")}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleFilter(col.key, e.target.value)}
                        className="dt-filter-input"
                      />
                      <ColumnValueFilter
                        options={options}
                        getOptions={() => optionsFn(col.key)}
                        selected={valueSel}
                        active={valueActive}
                        onChange={(next) => handleValueFilter(col.key, next)}
                      />
                    </div>
                  </th>
                );
              })}
              {actions ? <th className="sticky top-[28px] z-[3] bg-[var(--win-face)]" /> : null}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (actions ? 1 : 0)}
                className="border border-[var(--win-face-dark)] px-3 py-4 text-center text-[var(--win-muted)]"
              >
                {emptyTitle ?? t("common.noRecordsFound")}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => {
              const raw = row as Record<string, unknown>;
              const selected = selectedKey != null && String(raw[keyField as string]) === String(selectedKey);
              return (
                <tr
                  key={String(raw[keyField as string])}
                  onClick={() => onRowClick?.(row)}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  data-sheet-key={String(raw[keyField as string])}
                  data-selected={selected ? "true" : undefined}
                  className={cn(
                    selected
                      ? "bg-[var(--win-navy)] text-white"
                      : idx % 2 === 0
                        ? "bg-[var(--win-input)]"
                        : "bg-[var(--win-row-alt)]",
                    !selected && "hover:bg-[#2f6fc5] hover:text-white",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((col) => {
                    const content = col.render ? col.render(row) : formatDisplayedDate(raw[col.key]) || "—";
                    const plain = typeof content === "string" || typeof content === "number";
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "whitespace-nowrap border border-[var(--win-face-dark)] px-2 py-1",
                          plain && "bidi-plaintext",
                          col.className
                        )}
                        dir={plain ? "auto" : undefined}
                      >
                        {content}
                      </td>
                    );
                  })}
                  {actions && (
                    <td className="border border-[var(--win-face-dark)] px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-center gap-1">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export { tableCellText };

/** One header cell for search + unique-value filter, for tables that are not DataTable. */
export function FilterHeadCell({
  columnKey,
  filters,
  valueFilters,
  onFilter,
  onValueFilter,
  getFilterOptions,
}: {
  columnKey: string;
  filters: Record<string, string>;
  valueFilters: Record<string, string[] | null>;
  onFilter: (key: string, value: string) => void;
  onValueFilter: (key: string, values: string[] | null) => void;
  getFilterOptions: (key: string) => string[];
}) {
  const { t } = useI18n();
  const valueSel = valueFilters[columnKey] ?? null;
  return (
    <div className="dt-filter-cell">
      <input
        value={filters[columnKey] ?? ""}
        placeholder={t("access.columnFilter")}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onFilter(columnKey, e.target.value)}
        className="dt-filter-input"
      />
      <ColumnValueFilter
        getOptions={() => getFilterOptions(columnKey)}
        selected={valueSel}
        active={valueSel != null}
        onChange={(next) => onValueFilter(columnKey, next)}
      />
    </div>
  );
}
