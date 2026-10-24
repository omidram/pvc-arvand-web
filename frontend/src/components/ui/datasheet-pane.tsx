"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { uniqueColumnValues } from "@/components/ui/column-value-filter";
import { useI18n } from "@/lib/i18n/context";
import { sameNr } from "@/lib/utils";

const PAGE_SIZE = 250;

function cellText<T extends object>(column: Column<T>, row: T): string {
  if (column.filterText) return column.filterText(row);
  const raw = (row as Record<string, unknown>)[column.key];
  if (raw == null || raw === "") return "";
  if (typeof raw === "object") return "";
  return String(raw);
}

/** A link such as ?serial_nr=UA30751 must match that column, not the row id and not the paired serial. */
function matchesReveal<T extends object>(
  columns: Column<T>[],
  row: T,
  keyField: keyof T,
  reveal: string,
  revealField?: string
): boolean {
  const record = row as Record<string, unknown>;
  if (sameNr(record[keyField as string] as string, reveal)) return true;
  if (!revealField || revealField === String(keyField)) return false;
  const column = columns.find((item) => item.key === revealField);
  if (column && sameNr(cellText(column, row), reveal)) return true;
  return sameNr(record[revealField] as string, reveal);
}

export function DatasheetPane<T extends object>({
  columns,
  rows,
  keyField,
  selectedKey,
  revealQuery,
  revealField,
  canEdit,
  onSelect,
  onOpen,
  onDelete,
  emptyTitle,
}: {
  columns: Column<T>[];
  rows: T[];
  keyField: keyof T;
  selectedKey?: string | number | null;
  /** When a link opens one serial, filter the sheet to that value so the row is on screen. */
  revealQuery?: string;
  /** Column the link names, for example serial_nr. Matching the row id alone hides the record. */
  revealField?: string;
  canEdit?: boolean;
  onSelect?: (row: T) => void;
  onOpen?: (row: T) => void;
  onDelete?: (row: T) => void;
  emptyTitle?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const revealed = useRef("");
  useEffect(() => {
    const next = (revealQuery || "").trim();
    if (!next || revealed.current === next) return;
    revealed.current = next;
    setQuery(next);
  }, [revealQuery]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [valueFilters, setValueFilters] = useState<Record<string, string[] | null>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const activeTextFilters = Object.values(filters).some((value) => value.trim());
  const activeValueFilters = Object.values(valueFilters).some((value) => value != null);
  const activeFilters = activeTextFilters || activeValueFilters;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const reveal = (revealQuery || "").trim();
    const exactOnly = Boolean(reveal) && needle === reveal.toLowerCase();
    let next = rows.filter((row) => {
      if (exactOnly) {
        if (!matchesReveal(columns, row, keyField, reveal, revealField)) return false;
      } else if (needle && !columns.some((column) => cellText(column, row).toLowerCase().includes(needle))) {
        return false;
      }
      return columns.every((column) => {
        const text = cellText(column, row);
        const filter = (filters[column.key] || "").trim().toLowerCase();
        if (filter && !text.toLowerCase().includes(filter)) return false;
        const allowed = valueFilters[column.key];
        if (allowed != null && !allowed.includes(text)) return false;
        return true;
      });
    });
    if (sortKey) {
      const column = columns.find((item) => item.key === sortKey);
      if (column) {
        next = [...next].sort((a, b) => {
          const left = cellText(column, a);
          const right = cellText(column, b);
          const cmp = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return next;
  }, [rows, columns, query, filters, valueFilters, sortKey, sortDir, revealQuery, revealField, keyField]);

  useEffect(() => {
    if (selectedKey == null) {
      setPage(0);
      return;
    }
    const idx = shown.findIndex(
      (row) => String((row as Record<string, unknown>)[keyField as string]) === String(selectedKey)
    );
    setPage(idx < 0 ? 0 : Math.floor(idx / PAGE_SIZE));
  }, [shown, selectedKey, keyField]);

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => shown.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [shown, safePage]
  );

  useEffect(() => {
    if (selectedKey == null) return;
    const row = document.querySelector(`tr[data-sheet-key="${CSS.escape(String(selectedKey))}"]`);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    row.scrollIntoView({ block: "center" });
  }, [selectedKey, safePage, pageRows]);

  const selected = shown.find((row) => String((row as Record<string, unknown>)[keyField as string]) === String(selectedKey)) ?? null;

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function optionsForColumn(key: string) {
    const column = columns.find((item) => item.key === key);
    if (!column) return [];
    const needle = query.trim().toLowerCase();
    const scoped = rows.filter((row) => {
      if (needle && !columns.some((col) => cellText(col, row).toLowerCase().includes(needle))) return false;
      return columns.every((other) => {
        const text = cellText(other, row);
        const filter = (filters[other.key] || "").trim().toLowerCase();
        if (filter && !text.toLowerCase().includes(filter)) return false;
        if (other.key === key) return true;
        const allowed = valueFilters[other.key];
        if (allowed != null && !allowed.includes(text)) return false;
        return true;
      });
    });
    return uniqueColumnValues(scoped.map((row) => cellText(column, row)));
  }

  return (
    <div>
      <div className="datasheet-bar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("access.sheetSearch")}
          className="datasheet-search"
        />
        <button
          type="button"
          className="access-nav-btn"
          disabled={!query && !activeFilters && !sortKey}
          onClick={() => {
            setQuery("");
            setFilters({});
            setValueFilters({});
            setSortKey(null);
          }}
        >
          {t("access.sheetClear")}
        </button>
        {canEdit && onOpen ? (
          <button type="button" className="access-nav-btn" disabled={!selected} onClick={() => selected && onOpen(selected)}>
            {t("common.edit")}
          </button>
        ) : null}
        {canEdit && onDelete ? (
          <button
            type="button"
            className="access-nav-btn text-[var(--win-danger)]"
            disabled={!selected}
            onClick={() => selected && onDelete(selected)}
          >
            {t("common.delete")}
          </button>
        ) : null}
        <span className="ms-auto text-[11px] text-[var(--win-text)]">
          {t("access.sheetCount", { shown: shown.length, total: rows.length })}
        </span>
      </div>
      {shown.length > PAGE_SIZE ? (
        <div className="datasheet-pager">
          <button type="button" className="access-nav-btn" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            {t("access.sheetPrev")}
          </button>
          <span className="text-[11px]">{t("access.sheetPage", { page: safePage + 1, pages: pageCount })}</span>
          <button
            type="button"
            className="access-nav-btn"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            {t("access.sheetNext")}
          </button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={pageRows}
        keyField={keyField}
        selectedKey={selectedKey}
        emptyTitle={emptyTitle}
        filters={filters}
        onFilter={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
        valueFilters={valueFilters}
        onValueFilter={(key, values) => setValueFilters((current) => ({ ...current, [key]: values }))}
        getFilterOptions={optionsForColumn}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={toggleSort}
        onRowClick={(row) => onSelect?.(row)}
        onRowDoubleClick={(row) => onOpen?.(row)}
      />
    </div>
  );
}
