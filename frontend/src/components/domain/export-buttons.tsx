"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ExportExcelDialog,
  buildExportQueryParams,
  type ExportColumnOption,
  type ExportExcelOptions,
} from "@/components/domain/export-excel-dialog";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { downloadExport, importExcel, type ImportProgress } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

/** Excel export, Excel import, and PDF export for the form the user is in. */
export function ExportButtons({
  prefix,
  params,
  filenameBase,
  allowImport = true,
  exportColumns,
}: {
  prefix: string;
  params?: Record<string, unknown>;
  filenameBase?: string;
  allowImport?: boolean;
  /** Optional column labels when export.meta is unavailable. */
  exportColumns?: ExportColumnOption[];
}) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | "import" | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const canImport = allowImport && isAdmin;

  async function runExport(format: "xlsx" | "pdf", excelOptions?: ExportExcelOptions) {
    setBusy(format);
    setNote("");
    try {
      const filterParams = format === "xlsx" && excelOptions ? buildExportQueryParams(excelOptions) : {};
      await downloadExport(
        prefix,
        format,
        { ...params, ...filterParams },
        filenameBase ? `${filenameBase}.${format}` : undefined
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("common.export"));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file || !canImport) return;
    setBusy("import");
    setNote("");
    setProgress({ percent: 0, processed: 0, total: 0 });
    try {
      const result = await importExcel(prefix, file, setProgress);
      await queryClient.invalidateQueries();
      const done = t("common.importDone", { created: result.created ?? 0, updated: result.updated ?? 0 });
      setNote(result.arranged ? `${done} ${t("common.importArranged")}` : done);
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("common.import"));
    } finally {
      setBusy(null);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setExportOpen(true)} disabled={busy !== null}>
        <FileSpreadsheet size={14} /> {busy === "xlsx" ? t("common.exporting") : t("common.exportExcel")}
      </Button>
      {canImport ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          <FileUp size={14} /> {busy === "import" ? t("common.importing") : t("common.importExcel")}
        </Button>
      ) : null}
      <Button type="button" variant="secondary" size="sm" onClick={() => runExport("pdf")} disabled={busy !== null}>
        <FileText size={14} /> {busy === "pdf" ? t("common.exporting") : t("common.exportPdf")}
      </Button>
      {canImport ? (
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      ) : null}
      {progress ? <ImportProgressBar progress={progress} /> : null}
      {note ? <span className="access-import-note">{note}</span> : null}
      <ExportExcelDialog
        open={exportOpen}
        prefix={prefix}
        params={params}
        columnHints={exportColumns}
        onClose={() => setExportOpen(false)}
        onConfirm={(options) => {
          setExportOpen(false);
          void runExport("xlsx", options);
        }}
      />
    </>
  );
}

/** Excel / PDF for the current monitoring view. Does not import. */
export function MonitoringExport(props: {
  scope: "plant" | "train" | "electrolyzer" | "cells" | "alerts" | "rules" | "issues" | "history";
  train?: string;
  electrolyzer?: string;
  position?: string;
  status?: string;
  span?: string;
  filenameBase?: string;
}) {
  const params: Record<string, unknown> = { scope: props.scope };
  if (props.train) params.train = props.train;
  if (props.electrolyzer) params.electrolyzer = props.electrolyzer;
  if (props.position) params.position = props.position;
  if (props.status) params.status = props.status;
  if (props.span) params.span = props.span;
  return (
    <span className="mon-export">
      <ExportButtons prefix="/monitoring" params={params} filenameBase={props.filenameBase || `monitoring-${props.scope}`} allowImport={false} />
    </span>
  );
}
