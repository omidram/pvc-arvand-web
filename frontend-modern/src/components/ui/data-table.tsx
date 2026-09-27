"use client";

import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { LoadingState } from "./spinner";
import { useI18n } from "@/lib/i18n/context";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
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
}) {
  const { t } = useI18n();
  if (isLoading) return <LoadingState />;
  if (!data || data.length === 0) return <EmptyState title={emptyTitle ?? t("common.noRecordsFound")} description={emptyDescription} />;

  return (
    <div className="overflow-x-auto border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)]">
      <table className="w-full min-w-max border-collapse text-start text-xs">
        <thead>
          <tr className="bg-[var(--win-face)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "whitespace-nowrap border border-[var(--win-border-shadow)] px-2 py-1.5 text-start font-bold text-[var(--win-text)]",
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
            {actions && (
              <th className="whitespace-nowrap border border-[var(--win-border-shadow)] px-2 py-1.5 text-end font-bold text-[var(--win-text)]">
                {t("common.actions")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const raw = row as Record<string, unknown>;
            const selected = selectedKey != null && String(raw[keyField as string]) === String(selectedKey);
            return (
              <tr
                key={String(raw[keyField as string])}
                onClick={() => onRowClick?.(row)}
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
                    {col.render ? col.render(row) : String(raw[col.key] ?? "—")}
                  </td>
                ))}
                {actions && (
                  <td className="border border-[var(--win-face-dark)] px-2 py-1 text-end" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">{actions(row)}</div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
