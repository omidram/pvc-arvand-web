"use client";

import { useMemo, useState } from "react";
import { uniqueColumnValues } from "./column-value-filter";
import { formatDisplayedDate } from "@/lib/utils";

export interface SheetColumn<T> {
  key: string;
  filterText?: (row: T) => string;
}

export function tableCellText<T extends object>(column: SheetColumn<T>, row: T): string {
  if (column.filterText) return column.filterText(row);
  const raw = (row as Record<string, unknown>)[column.key];
  if (raw == null || raw === "") return "";
  if (typeof raw === "object") return "";
  const shown = formatDisplayedDate(raw);
  return shown || String(raw);
}

export function applySheetFilters<T extends object>(
  rows: T[],
  columns: SheetColumn<T>[],
  filters: Record<string, string>,
  valueFilters: Record<string, string[] | null>
): T[] {
  return rows.filter((row) =>
    columns.every((column) => {
      const text = tableCellText(column, row);
      const needle = (filters[column.key] || "").trim().toLowerCase();
      if (needle && !text.toLowerCase().includes(needle)) return false;
      const allowed = valueFilters[column.key];
      if (allowed != null && !allowed.includes(text)) return false;
      return true;
    })
  );
}

export function sortSheetRows<T extends object>(rows: T[], columns: SheetColumn<T>[], sortKey: string | null, sortDir: "asc" | "desc"): T[] {
  if (!sortKey) return rows;
  const column = columns.find((item) => item.key === sortKey);
  if (!column) return rows;
  return [...rows].sort((a, b) => {
    const cmp = tableCellText(column, a).localeCompare(tableCellText(column, b), undefined, { numeric: true, sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });
}

export function optionsForSheetColumn<T extends object>(
  rows: T[],
  columns: SheetColumn<T>[],
  key: string,
  filters: Record<string, string>,
  valueFilters: Record<string, string[] | null>
): string[] {
  const column = columns.find((item) => item.key === key);
  if (!column) return [];
  const scoped = rows.filter((row) =>
    columns.every((other) => {
      const text = tableCellText(other, row);
      const needle = (filters[other.key] || "").trim().toLowerCase();
      if (needle && !text.toLowerCase().includes(needle)) return false;
      if (other.key === key) return true;
      const allowed = valueFilters[other.key];
      if (allowed != null && !allowed.includes(text)) return false;
      return true;
    })
  );
  return uniqueColumnValues(scoped.map((row) => tableCellText(column, row)));
}

/** Column search + unique-value filter + sort, shared by every grid in the app. */
export function useSheetFilters<T extends object>(columns: SheetColumn<T>[], rows: T[]) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [valueFilters, setValueFilters] = useState<Record<string, string[] | null>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const shown = useMemo(() => {
    const next = applySheetFilters(rows, columns, filters, valueFilters);
    return sortSheetRows(next, columns, sortKey, sortDir);
  }, [rows, columns, filters, valueFilters, sortKey, sortDir]);

  const active = Object.values(filters).some((value) => value.trim()) || Object.values(valueFilters).some((value) => value != null) || Boolean(sortKey);

  function onFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function onValueFilter(key: string, values: string[] | null) {
    setValueFilters((current) => ({ ...current, [key]: values }));
  }

  function onSort(key: string) {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function getFilterOptions(key: string) {
    return optionsForSheetColumn(rows, columns, key, filters, valueFilters);
  }

  function clear() {
    setFilters({});
    setValueFilters({});
    setSortKey(null);
  }

  return {
    shown,
    filters,
    valueFilters,
    sortKey,
    sortDir,
    onFilter,
    onValueFilter,
    onSort,
    getFilterOptions,
    active,
    clear,
  };
}
