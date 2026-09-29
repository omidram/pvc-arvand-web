"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadExport, importExcel, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { useI18n } from "@/lib/i18n/context";

/** Excel export, Excel import, and PDF export for the form the user is in. */
export function ExportButtons({
  prefix,
  params,
  filenameBase,
  allowImport = true,
}: {
  prefix: string;
  params?: Record<string, unknown>;
  filenameBase?: string;
  allowImport?: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"xlsx" | "pdf" | "import" | null>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  async function handle(format: "xlsx" | "pdf") {
    setBusy(format);
    setNote("");
    try {
      await downloadExport(prefix, format, params, filenameBase ? `${filenameBase}.${format}` : undefined);
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("common.export"));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
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
      <Button type="button" variant="secondary" size="sm" onClick={() => handle("xlsx")} disabled={busy !== null}>
        <FileSpreadsheet size={14} /> {busy === "xlsx" ? t("common.exporting") : t("common.exportExcel")}
      </Button>
      {allowImport ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
          <FileUp size={14} /> {busy === "import" ? t("common.importing") : t("common.importExcel")}
        </Button>
      ) : null}
      <Button type="button" variant="secondary" size="sm" onClick={() => handle("pdf")} disabled={busy !== null}>
        <FileText size={14} /> {busy === "pdf" ? t("common.exporting") : t("common.exportPdf")}
      </Button>
      {allowImport ? (
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
