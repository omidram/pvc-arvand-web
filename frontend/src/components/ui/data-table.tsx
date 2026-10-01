"use client";

import { cn, formatDisplayedDate } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./spinner";
import { ColumnValueFilter } from "./column-value-filter";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";

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
}) {
  const { t } = useI18n();
  useCalendar();
  if (isLoading) return <LoadingState />;

  const showFilterRow = Boolean(onFilter || onValueFilter);
  const rows = data ?? [];
  // Keep header + filter row mounted when filters are active, even if zero rows match
  // (Excel Deselect all must only uncheck values, not wipe the whole datasheet UI).
  if (!showFilterRow && rows.length === 0) {
    return <EmptyState title={emptyTitle ?? t("common.noRecordsFound")} description={emptyDescription} />;
  }

  return (
    <div
      className="ui-table-wrap max-w-full overflow-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)]"
      style={{ maxHeight }}
    >
      <table className="ui-table w-max min-w-full border-collapse text-start text-xs">
        <thead>
          <tr className="bg-[var(--win-face)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "sticky top-0 z-[2] whitespace-nowrap border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-1.5 text-start font-bold text-[var(--win-text)]",
                  onSort && "cursor-pointer select-none",
                  col.className
                )}
                onClick={() => onSort?.(col.key)}
              >
                {col.header}
                {sortKey === col.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
              </th>
            ))}
            {actions && (
              <th className="sticky top-0 z-[2] whitespace-nowrap border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-1.5 text-end font-bold text-[var(--win-text)]">
                {t("common.actions")}
              </th>
            )}
          </tr>
          {showFilterRow ? (
            <tr className="bg-[var(--win-face)]">
              {columns.map((col) => {
                const options = filterOptions?.[col.key];
                const valueSel = valueFilters?.[col.key] ?? null;
                const valueActive = valueSel != null;
                return (
                  <th key={col.key} className="sticky top-[28px] z-[3] border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-1 py-1">
                    <div className="dt-filter-cell">
                      {onFilter ? (
                        <input
                          value={filters?.[col.key] ?? ""}
                          placeholder={t("access.columnFilter")}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onFilter(col.key, e.target.value)}
                          className="dt-filter-input"
                        />
                      ) : null}
                      {onValueFilter ? (
                        <ColumnValueFilter
                          options={options}
                          getOptions={getFilterOptions ? () => getFilterOptions(col.key) : undefined}
                          selected={valueSel}
                          active={valueActive}
                          onChange={(next) => onValueFilter(col.key, next)}
                        />
                      ) : null}
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
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn("whitespace-nowrap border border-[var(--win-face-dark)] px-2 py-1", col.className)}
                    >
                      {col.render ? col.render(row) : formatDisplayedDate(raw[col.key]) || "—"}
                    </td>
                  ))}
                  {actions && (
                    <td className="border border-[var(--win-face-dark)] px-2 py-1 text-end" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">{actions(row)}</div>
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
