"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessHub } from "@/components/layout/access-hub";
import { DateInput } from "@/components/ui/date-input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { relationsApi } from "@/lib/endpoints";
import { useCalendar } from "@/lib/calendar/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";

export type SheetColumn<T> = {
  key: keyof T & string;
  header: string;
  kind?: "text" | "date" | "number";
  width?: string;
  lookup?: "anode-numbers" | "cathode-numbers";
};

function day(value: unknown): string {
  if (value == null || value === "") return "";
  return String(value).slice(0, 10);
}

function showText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

export function ElectrodeSheet<T extends { id: number }>({
  title,
  rows,
  isLoading,
  error,
  columns,
  canEdit,
  showDate,
  nrKey,
  exportPrefix,
  reportHref,
  onCreate,
  onUpdate,
}: {
  title: string;
  rows: T[] | undefined;
  isLoading: boolean;
  error: Error | null;
  columns: SheetColumn<T>[];
  canEdit: boolean;
  showDate?: boolean;
  nrKey: keyof T & string;
  exportPrefix: string;
  reportHref?: string;
  onCreate: (payload: Partial<T>) => void | Promise<unknown>;
  onUpdate: (row: T, payload: Partial<T>) => void | Promise<unknown>;
}) {
  const { t } = useI18n();
  useCalendar();
  const [active, setActive] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState(0);
  const [sheetError, setSheetError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const lookups = [...new Set(columns.map((col) => col.lookup).filter(Boolean))] as string[];
  const lookupQuery = useQuery({
    queryKey: ["relations", "electrode-sheet", lookups],
    queryFn: async () => {
      const entries = await Promise.all(
        lookups.map(async (name) => [name, await relationsApi.lookup(name)] as const)
      );
      return Object.fromEntries(entries) as Record<string, string[]>;
    },
    enabled: lookups.length > 0,
  });

  async function save(row: T, key: string, next: unknown, kind?: SheetColumn<T>["kind"]) {
    if (!canEdit) return;
    const current = (row as Record<string, unknown>)[key];
    let payload: Partial<T> | null = null;
    if (kind === "date") {
      if (day(current) === day(next)) return;
      payload = { [key]: next || null } as Partial<T>;
    } else if (kind === "number") {
      const parsed = next === "" || next == null ? null : Number(next);
      if (parsed === current || (parsed == null && (current == null || current === ""))) return;
      payload = { [key]: Number.isFinite(parsed as number) ? parsed : null } as Partial<T>;
    } else {
      if (showText(current) === showText(next)) return;
      payload = { [key]: next === "" ? null : next } as Partial<T>;
    }
    setSheetError("");
    try {
      await onUpdate(row, payload);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : String(err));
    }
  }

  async function commitDraft(key: string, next: unknown, kind?: SheetColumn<T>["kind"]) {
    const text = next == null ? "" : String(next);
    const nextDraft = { ...draft, [key]: text };
    setDraft(nextDraft);
    if (key !== nrKey || !text.trim()) return;
    const payload: Record<string, unknown> = {};
    for (const col of columns) {
      const raw = (nextDraft[col.key] ?? "").trim();
      if (!raw) payload[col.key] = col.key === nrKey ? text.trim() : null;
      else if (col.kind === "number") {
        const parsed = Number(raw);
        payload[col.key] = Number.isFinite(parsed) ? parsed : null;
      }
      else payload[col.key] = raw;
    }
    setSheetError("");
    try {
      await onCreate(payload as Partial<T>);
      setDraft({});
      setNewKey((n) => n + 1);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AccessHub
      title={title}
      titleBlue
      backHref="/elements"
      backLabel={t("elements.title")}
      extraButtons={
        <>
          {reportHref ? (
            <Link href={reportHref} className="access-menu-btn access-hub-menu-btn">
              {t("menus.maintenanceReport")}
            </Link>
          ) : null}
          <ExportButtons prefix={exportPrefix} filenameBase={exportPrefix.replace(/^\//, "")} />
        </>
      }
    >
      {showDate ? (
        <div className="mb-2 flex justify-end">
          <div className="access-inset-field flex h-[22px] w-[110px] items-center bg-white px-2">{formatDate(today)}</div>
        </div>
      ) : null}
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error.message} /> : null}
      {sheetError ? (
        <p className="mb-2 border-2 border-[#b54a4a] bg-[#fde8e8] px-2 py-1 text-[11px] font-semibold text-[#8a1f1f]">
          {sheetError}
        </p>
      ) : null}
      {rows ? (
        <div className="sheet-scroll overflow-auto border border-black bg-white">
          {lookups.map((name) => (
            <datalist id={`lookup-${name}`} key={name}>
              {(lookupQuery.data?.[name] || []).map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          ))}
          <table className="access-cont-table min-w-[880px]">
            <thead>
              <tr>
                <th className="w-4" />
                {columns.map((col) => (
                  <th key={col.key}>{col.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => setActive(row.id)}>
                  <td className="access-selector">{active === row.id ? "►" : ""}</td>
                  {columns.map((col) => (
                    <td key={col.key}>
                      <SheetCell
                        column={col}
                        value={(row as Record<string, unknown>)[col.key]}
                        disabled={!canEdit}
                        onCommit={(next) => save(row, col.key, next, col.kind)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {canEdit ? (
                <tr key={newKey} onClick={() => setActive("new")}>
                  <td className="access-selector">*</td>
                  {columns.map((col) => (
                    <td key={col.key}>
                      <SheetCell
                        column={col}
                        value={draft[col.key] ?? ""}
                        onCommit={(next) => commitDraft(col.key, next, col.kind)}
                      />
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </AccessHub>
  );
}

function SheetCell<T>({
  column,
  value,
  disabled,
  onCommit,
}: {
  column: SheetColumn<T>;
  value: unknown;
  disabled?: boolean;
  onCommit: (next: unknown) => void;
}) {
  if (column.kind === "date") {
    return (
      <DateInput
        className="w-[108px]"
        value={day(value)}
        disabled={disabled}
        onChange={(e) => onCommit(e.target.value)}
      />
    );
  }
  return (
    <input
      className={column.width || "w-full min-w-[90px]"}
      list={column.lookup ? `lookup-${column.lookup}` : undefined}
      defaultValue={showText(value)}
      disabled={disabled}
      onBlur={(e) => onCommit(e.target.value)}
    />
  );
}
