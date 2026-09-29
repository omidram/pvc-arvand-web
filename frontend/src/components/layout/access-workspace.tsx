"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AccessFields, accessPayload, valuesFromRecord } from "@/components/ui/access-fields";
import type { FieldDef } from "@/components/ui/resource-form";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { AccessFormWindow, AccessNav } from "@/components/layout/access-form";
import { useI18n } from "@/lib/i18n/context";
import { ExportButtons } from "@/components/domain/export-buttons";

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
  confirmDelete,
  submitting,
  formBody,
  framed = true,
  backHref,
  backLabel,
  titleBlue,
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
  onSave: (id: string | number, values: Record<string, unknown>) => void;
  onCreate: (values: Record<string, unknown>) => void;
  onDelete: (id: string | number) => void;
  related?: (row: T) => React.ReactNode;
  commands?: React.ReactNode;
  exportPrefix?: string;
  exportParams?: Record<string, unknown>;
  filenameBase?: string;
  onLookup?: (name: string, value: unknown, values: Record<string, unknown>) => Promise<T | null>;
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
      return named != null && String(named) === String(wanted);
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
    if (formBody) {
      if (!current) {
        setValues({});
        return;
      }
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
        if (value !== null && typeof value === "object") continue;
        copy[key] = value;
      }
      setValues(copy);
      return;
    }
    setValues(valuesFromRecord(fields, current));
    // Reset draft only when the record changes, not when field defs are rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, isNew]);

  function go(nextIndex: number) {
    const clamped = Math.max(0, Math.min(nextIndex, Math.max(rows.length - 1, 0)));
    setIsNew(false);
    setIndex(clamped);
    if (rows[clamped]) {
      const row = rows[clamped] as Record<string, unknown>;
      const token = row[paramName] ?? readId(rows[clamped]);
      const url = new URL(window.location.href);
      url.searchParams.set(paramName, String(token));
      router.replace(`${url.pathname}?${url.searchParams.toString()}`);
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
    if (!onLookup) return;
    if (!String(value ?? "").trim()) return;
    const seq = ++lookupSeq.current;
    try {
      const found = await onLookup(name, value, { ...values, [name]: value });
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

  function handleSave() {
    const payload = formBody ? values : accessPayload(fields, values);
    if (isNew || !current) onCreate(payload);
    else onSave(readId(current), payload);
  }

  function handleDelete() {
    if (!current) return;
    const msg = confirmDelete ? confirmDelete(current) : t("common.confirmDeleteGeneric");
    if (confirm(msg)) onDelete(readId(current));
  }

  const filtered = useMemo(() => {
    if (!findValue || view !== "datasheet") return rows;
    const needle = findValue.toLowerCase();
    return rows.filter((row) =>
      Object.values(row as Record<string, unknown>).some((v) => v != null && String(v).toLowerCase().includes(needle))
    );
  }, [rows, findValue, view]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const body =
    view === "datasheet" ? (
        <DataTable
          columns={columns}
          data={filtered}
          keyField={idField}
          selectedKey={current ? readId(current) : null}
          onRowClick={(row) => {
            const found = rows.findIndex((r) => String(readId(r)) === String(readId(row)));
            if (found >= 0) {
              go(found);
              setView("form");
            }
          }}
          emptyTitle={t("common.noRecordsFound")}
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
              onCommit={onLookup ? handleCommit : undefined}
              readOnly={!canEdit}
            />
          )}
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
            setValues(formBody ? {} : valuesFromRecord(fields, null));
          }}
          onSave={handleSave}
          onDelete={handleDelete}
          onFind={handleFind}
          findValue={findValue}
          saving={submitting}
          view={view}
          onView={setView}
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
          {exportPrefix ? <ExportButtons prefix={exportPrefix} params={exportParams} filenameBase={filenameBase} /> : null}
          {commands}
        </>
      }
      nav={nav}
    >
      {body}
    </AccessFormWindow>
  );
}
