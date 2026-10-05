"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessFields, accessPayload, valuesFromRecord, toAccessValue } from "@/components/ui/access-fields";
import type { FieldDef } from "@/components/ui/resource-form";
import type { Column } from "@/components/ui/data-table";
import { DatasheetPane } from "@/components/ui/datasheet-pane";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { AccessFormWindow, AccessNav } from "@/components/layout/access-form";
import { useI18n } from "@/lib/i18n/context";
import { ExportButtons } from "@/components/domain/export-buttons";
import { formatDate, humanizeKey, sameNr } from "@/lib/utils";

const HIDDEN_SHEET_KEYS = new Set(["sign_insp_image", "sign_maint_image", "sign_proc_image", "signature"]);

function fieldPlain(field: FieldDef, row: object, yes: string, no: string): string {
  const raw = (row as Record<string, unknown>)[field.name];
  if (raw == null || raw === "") return "";
  if (field.type === "select") return field.options?.find((option) => option.value === String(raw))?.label ?? String(raw);
  if (field.type === "checkbox") return raw ? yes : no;
  if (field.type === "date" || field.type === "datetime-local") return formatDate(String(raw));
  return String(raw);
}

export function AccessWorkspace<T extends object>({
  caption,
  helpKey,
  records,
  isLoading,
  error,
  fields,
  columns,
  idField,
  getId,
  recordParam,
  canEdit,
  onSave,
  onCreate,
  onDelete,
  related,
  commands,
  exportPrefix,
  exportParams,
  filenameBase,
  onLookup,
  onSuggest,
  confirmDelete,
  submitting,
  formBody,
  framed = true,
  backHref,
  backLabel,
  titleBlue,
  newDefaults,
  newDefaultsKey,
  validate,
  /** "summary" = only the table `columns` in datasheet (faster for large lists). */
  sheetMode = "fields",
}: {
  caption: string;
  helpKey?: string;
  records: T[] | undefined;
  isLoading?: boolean;
  error?: Error | null;
  fields: FieldDef[];
  columns: Column<T>[];
  idField: keyof T;
  getId?: (row: T) => string | number;
  recordParam?: string;
  canEdit: boolean;
  onSave: (id: string | number, values: Record<string, unknown>) => void | Promise<void>;
  onCreate: (values: Record<string, unknown>) => void | Promise<void>;
  onDelete: (id: string | number) => void;
  related?: (row: T) => React.ReactNode;
  commands?: React.ReactNode;
  exportPrefix?: string;
  exportParams?: Record<string, unknown>;
  filenameBase?: string;
  onLookup?: (name: string, value: unknown, values: Record<string, unknown>) => Promise<T | null>;
  /** Patch form fields from a live lookup (e.g. serial → Assembly fill) without changing the current record. */
  onSuggest?: (
    name: string,
    value: unknown,
    values: Record<string, unknown>
  ) => Promise<Record<string, unknown> | null>;
  confirmDelete?: (row: T) => string;
  submitting?: boolean;
  /** Replaces the generic field list. Used by the printed inspection sheet. */
  formBody?: (ctx: {
    values: Record<string, unknown>;
    onChange: (name: string, value: unknown) => void;
    onPatch: (patch: Record<string, unknown>) => void;
    readOnly: boolean;
    recordId: string | number | null;
    isNew: boolean;
  }) => React.ReactNode;
  framed?: boolean;
  backHref?: string;
  backLabel?: string;
  titleBlue?: boolean;
  newDefaults?: () => Record<string, unknown>;
  newDefaultsKey?: string;
  validate?: (values: Record<string, unknown>, ctx: { isNew: boolean }) => string | null;
  sheetMode?: "fields" | "summary";
}) {
  const { t } = useI18n();
  const router = useRouter();
  const readId = useCallback(
    (row: T) => (getId ? getId(row) : ((row as Record<string, unknown>)[idField as string] as string | number)),
    [getId, idField]
  );
  const [extra, setExtra] = useState<T | null>(null);
  const lookupSeq = useRef(0);
  const skipUrlSync = useRef(false);
  const baseRows = records ?? [];
  const rows = useMemo(() => {
    if (!extra) return baseRows;
    const extraId = String(readId(extra));
    return [extra, ...baseRows.filter((row) => String(readId(row)) !== extraId)];
  }, [extra, baseRows, readId]);
  const paramName = recordParam ?? String(idField);
  const [view, setView] = useState<"form" | "datasheet">("form");
  const [index, setIndex] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const [findValue, setFindValue] = useState("");
  const [saveError, setSaveError] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() => valuesFromRecord(fields, null));

  const current = !isNew && rows[index] ? rows[index] : null;

  useEffect(() => {
    if (isNew || rows.length === 0) return;
    if (index > rows.length - 1) setIndex(rows.length - 1);
  }, [rows.length, index, isNew]);

  useEffect(() => {
    if (skipUrlSync.current) {
      skipUrlSync.current = false;
      return;
    }
    const wanted = new URLSearchParams(window.location.search).get(paramName);
    if (!wanted || rows.length === 0) return;
    const found = rows.findIndex((row) => {
      if (String(readId(row)) === String(wanted)) return true;
      const named = (row as Record<string, unknown>)[paramName];
      if (named != null && String(named) === String(wanted)) return true;
      return named != null && sameNr(String(named), wanted);
    });
    if (found >= 0) {
      setIsNew(false);
      setIndex(found);
    }
    // Intentionally not depending on readId identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, paramName]);

  const currentId = current ? String(readId(current)) : isNew ? "__new__" : "";
  useEffect(() => {
    const defaults = newDefaults?.() ?? {};
    if (formBody) {
      if (!current) {
        setValues({ ...defaults });
        setSaveError("");
        return;
      }
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
        if (value !== null && typeof value === "object") continue;
        copy[key] = value;
      }
      setValues(copy);
      setSaveError("");
      return;
    }
    if (isNew) {
      setValues({ ...valuesFromRecord(fields, null), ...defaults });
    } else {
      setValues(valuesFromRecord(fields, current));
    }
    setSaveError("");
    // Reset draft only when the record changes, not when field defs are rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, isNew]);

  useEffect(() => {
    if (!isNew) return;
    const defaults = newDefaults?.() ?? {};
    setValues((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(defaults)) {
        if (value == null || value === "") continue;
        if (!String(next[key] ?? "").trim()) next[key] = value;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, newDefaultsKey]);

  function go(nextIndex: number) {
    const clamped = Math.max(0, Math.min(nextIndex, Math.max(rows.length - 1, 0)));
    setIsNew(false);
    setIndex(clamped);
    if (rows[clamped]) {
      const row = rows[clamped] as Record<string, unknown>;
      const token = row[paramName] ?? readId(rows[clamped]);
      const url = new URL(window.location.href);
      // Keep other query keys (e.g. tab=). Record id is for navigation/selection only —
      // list pages must not treat it as a search filter.
      url.searchParams.set(paramName, String(token));
      router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
    }
  }

  function handleFind(q: string) {
    setFindValue(q);
    if (!q) return;
    const needle = q.toLowerCase();
    const found = rows.findIndex((row) =>
      Object.values(row as Record<string, unknown>).some((v) => v != null && String(v).toLowerCase().includes(needle))
    );
    if (found >= 0) go(found);
  }

  async function handleCommit(name: string, value: unknown) {
    if (!String(value ?? "").trim()) return;
    const nextValues = { ...values, [name]: value };
    const seq = ++lookupSeq.current;

    if (onSuggest) {
      try {
        const patch = await onSuggest(name, value, nextValues);
        if (seq !== lookupSeq.current) return;
        if (patch) {
          setValues((prev) => {
            const merged: Record<string, unknown> = { ...prev, [name]: value };
            for (const [key, raw] of Object.entries(patch)) {
              if (key === name) continue;
              const field = fields.find((f) => f.name === key);
              merged[key] = field ? toAccessValue(field.type, raw) : raw ?? "";
            }
            return merged;
          });
          return;
        }
      } catch {
        // Fall through to onLookup when suggest fails.
      }
    }

    if (!onLookup) return;
    try {
      const found = await onLookup(name, value, nextValues);
      if (seq !== lookupSeq.current || !found) return;
      skipUrlSync.current = true;
      setValues(valuesFromRecord(fields, found));
      setExtra(found);
      setIsNew(false);
      setIndex(0);
    } catch {
      // Keep the value the user typed when the lookup is unavailable.
    }
  }

  async function handleSave() {
    const payload = formBody ? values : accessPayload(fields, values);
    const message = validate?.(payload, { isNew: isNew || !current });
    if (message) {
      setSaveError(message);
      return;
    }
    setSaveError("");
    try {
      if (isNew || !current) await onCreate(payload);
      else await onSave(readId(current), payload);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDelete() {
    if (!current) return;
    const msg = confirmDelete ? confirmDelete(current) : t("common.confirmDeleteGeneric");
    if (confirm(msg)) onDelete(readId(current));
  }

  const yes = t("common.yes");
  const no = t("common.no");
  const sheetColumns = useMemo(() => {
    if (sheetMode === "summary" && columns.length) return columns;
    const used = new Set<string>();
    const out: Column<T>[] = [];
    if (fields.length) {
      for (const field of fields) {
        used.add(field.name);
        const summary = columns.find((column) => column.key === field.name);
        out.push({
          key: field.name,
          header: field.label,
          className: field.type === "textarea" ? "max-w-[18rem] whitespace-normal" : undefined,
          render: summary?.render ?? ((row) => fieldPlain(field, row, yes, no) || "—"),
          filterText: (row) => {
            const shown = fieldPlain(field, row, yes, no);
            const raw = (row as Record<string, unknown>)[field.name];
            const plain = raw == null ? "" : String(raw);
            return shown && plain && shown !== plain ? `${shown} ${plain}` : shown || plain;
          },
        });
      }
      for (const column of columns) {
        if (used.has(column.key)) continue;
        used.add(column.key);
        out.push(column);
      }
    } else {
      for (const column of columns) {
        used.add(column.key);
        out.push(column);
      }
      for (const row of rows.slice(0, 40)) {
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (used.has(key) || HIDDEN_SHEET_KEYS.has(key)) continue;
          if (value !== null && typeof value === "object") continue;
          if (typeof value === "string" && (value.startsWith("data:") || value.length > 400)) continue;
          used.add(key);
          out.push({ key, header: humanizeKey(key) });
        }
      }
    }
    return out;
  }, [fields, columns, rows, yes, no, sheetMode]);

  function locate(row: T) {
    return rows.findIndex((item) => String(readId(item)) === String(readId(row)));
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const body =
    view === "datasheet" ? (
        <DatasheetPane
          columns={sheetColumns}
          rows={rows}
          keyField={idField}
          selectedKey={current ? readId(current) : null}
          canEdit={canEdit}
          emptyTitle={t("common.noRecordsFound")}
          onSelect={(row) => {
            const found = locate(row);
            if (found >= 0) go(found);
          }}
          onOpen={(row) => {
            const found = locate(row);
            if (found >= 0) {
              go(found);
              setView("form");
            }
          }}
          onDelete={
            canEdit
              ? (row) => {
                  const msg = confirmDelete ? confirmDelete(row) : t("common.confirmDeleteGeneric");
                  if (confirm(msg)) onDelete(readId(row));
                }
              : undefined
          }
        />
      ) : (
        <>
          {formBody ? (
            formBody({
              values,
              onChange: (name, value) => setValues((v) => ({ ...v, [name]: value })),
              onPatch: (patch) => setValues((v) => ({ ...v, ...patch })),
              readOnly: !canEdit,
              recordId: current ? readId(current) : null,
              isNew,
            })
          ) : (
            <AccessFields
              fields={fields}
              values={values}
              onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
              onCommit={onLookup || onSuggest ? handleCommit : undefined}
              readOnly={!canEdit}
            />
          )}
          {saveError ? (
            <p className="mt-2 border-2 border-[#b54a4a] bg-[#fde8e8] px-2 py-1 text-[11px] font-semibold text-[#8a1f1f]">
              {saveError}
            </p>
          ) : null}
          {current && related ? related(current) : null}
        </>
      );

  const nav = (
        <AccessNav
          index={isNew ? rows.length : index}
          total={rows.length}
          isNew={isNew}
          canEdit={canEdit}
          onFirst={() => go(0)}
          onPrev={() => go(index - 1)}
          onNext={() => go(index + 1)}
          onLast={() => go(rows.length - 1)}
          onNew={() => {
            setExtra(null);
            setIsNew(true);
            setSaveError("");
            setValues({
              ...(formBody ? {} : valuesFromRecord(fields, null)),
              ...(newDefaults?.() ?? {}),
            });
          }}
          onSave={handleSave}
          onDelete={handleDelete}
          onFind={handleFind}
          findValue={findValue}
          saving={submitting}
          view={view}
          onView={setView}
          hideFind={view === "datasheet"}
        />
  );

  if (!framed) {
    return (
      <div>
        {body}
        <div className="access-form-nav mt-2">{nav}</div>
      </div>
    );
  }

  return (
    <AccessFormWindow
      caption={caption}
      helpKey={helpKey}
      backHref={backHref}
      backLabel={backLabel}
      titleBlue={titleBlue}
      commands={
        <>
          {exportPrefix ? (
            <ExportButtons
              prefix={exportPrefix}
              params={{ ...exportParams, ...(current && !isNew ? { id: readId(current) } : {}) }}
              filenameBase={filenameBase}
              exportColumns={fields
                .filter((f) => !HIDDEN_SHEET_KEYS.has(f.name))
                .map((f) => ({ key: f.name, label: f.label }))}
            />
          ) : null}
          {commands}
        </>
      }
      nav={nav}
    >
      {body}
    </AccessFormWindow>
  );
}
