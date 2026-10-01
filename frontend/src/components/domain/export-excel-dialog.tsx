"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Modal } from "@/components/ui/modal";
import { fetchExportMeta, type ExportMeta } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { humanizeKey } from "@/lib/utils";

export type ExportColumnOption = { key: string; label?: string };

export type ExportExcelOptions = {
  columns: string[];
  dateField: string | null;
  dateFrom: string;
  dateTo: string;
};

type Props = {
  open: boolean;
  prefix: string;
  params?: Record<string, unknown>;
  columnHints?: ExportColumnOption[];
  onClose: () => void;
  onConfirm: (options: ExportExcelOptions) => void;
};

function labelFor(t: (path: string) => string, key: string, hint?: string) {
  if (hint) return hint;
  const translated = t(`fields.${key}`);
  if (translated !== `fields.${key}`) return translated;
  return humanizeKey(key);
}

export function ExportExcelDialog({ open, prefix, params, columnHints, onClose, onConfirm }: Props) {
  const { t } = useI18n();
  const [meta, setMeta] = useState<ExportMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dateField, setDateField] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hintMap = useMemo(() => new Map((columnHints ?? []).map((c) => [c.key, c.label])), [columnHints]);
  const metaParams = useMemo(() => {
    if (!params) return undefined;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === "limit" || key === "skip" || value == null || value === "") continue;
      next[key] = value;
    }
    return Object.keys(next).length ? next : undefined;
  }, [params]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchExportMeta(prefix, metaParams)
      .then((data) => {
        if (cancelled) return;
        setMeta(data);
        const fields = data.fields.length ? data.fields : (columnHints ?? []).map((c) => c.key);
        setSelected(new Set(fields));
        const dates = data.date_fields.length ? data.date_fields : fields.filter((f) => f.toLowerCase().includes("date"));
        setDateField(dates[0] ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        const fields = (columnHints ?? []).map((c) => c.key);
        setMeta({ fields, date_fields: fields.filter((f) => f.toLowerCase().includes("date")) });
        setSelected(new Set(fields));
        setDateField(fields.find((f) => f.toLowerCase().includes("date")) ?? "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, prefix, metaParams, columnHints]);

  const fields = meta?.fields.length ? meta.fields : (columnHints ?? []).map((c) => c.key);
  const dateFields = meta?.date_fields.length
    ? meta.date_fields
    : fields.filter((f) => f.toLowerCase().includes("date") || f.toLowerCase().includes("time"));

  function toggleColumn(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(fields) : new Set());
  }

  function submit() {
    const cols = fields.filter((f) => selected.has(f));
    onConfirm({
      columns: cols.length ? cols : fields,
      dateField: dateField || null,
      dateFrom,
      dateTo,
    });
  }

  if (!open) return null;

  return (
    <Modal open title={t("exportOptions.title")} onClose={onClose} wide>
      <p className="mb-3 text-xs text-[var(--win-muted)]">{t("exportOptions.help")}</p>
      {loading ? <p className="text-sm">{t("common.loading")}</p> : null}

      <div className="export-opt-section">
        <div className="export-opt-head">
          <strong>{t("exportOptions.columns")}</strong>
          <span className="export-opt-actions">
            <button type="button" onClick={() => selectAll(true)}>
              {t("exportOptions.selectAll")}
            </button>
            <button type="button" onClick={() => selectAll(false)}>
              {t("exportOptions.selectNone")}
            </button>
          </span>
        </div>
        <div className="export-opt-columns">
          {fields.map((key) => (
            <label key={key} className="export-opt-col">
              <input type="checkbox" checked={selected.has(key)} onChange={() => toggleColumn(key)} />
              <span>{labelFor(t, key, hintMap.get(key))}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="export-opt-section mt-3">
        <strong>{t("exportOptions.dateFilter")}</strong>
        <div className="export-opt-dates mt-2">
          <label>
            <span>{t("exportOptions.dateField")}</span>
            <select value={dateField} onChange={(e) => setDateField(e.target.value)}>
              <option value="">{t("exportOptions.noDateFilter")}</option>
              {dateFields.map((f) => (
                <option key={f} value={f}>
                  {labelFor(t, f, hintMap.get(f))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("exportOptions.dateFrom")}</span>
            <DateInput type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={!dateField} />
          </label>
          <label>
            <span>{t("exportOptions.dateTo")}</span>
            <DateInput type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={!dateField} />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={submit} disabled={loading}>
          {t("exportOptions.download")}
        </Button>
      </div>
    </Modal>
  );
}

export function buildExportQueryParams(options: ExportExcelOptions): Record<string, string> {
  const out: Record<string, string> = {};
  if (options.columns.length) out.columns = options.columns.join(",");
  if (options.dateField && options.dateFrom) out.date_from = options.dateFrom;
  if (options.dateField && options.dateTo) out.date_to = options.dateTo;
  if (options.dateField) out.date_field = options.dateField;
  return out;
}
