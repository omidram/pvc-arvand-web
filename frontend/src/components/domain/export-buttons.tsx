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
}: {
  prefix: string;
  params?: Record<string, unknown>;
  filenameBase?: string;
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
      <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
        <FileUp size={14} /> {busy === "import" ? t("common.importing") : t("common.importExcel")}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => handle("pdf")} disabled={busy !== null}>
        <FileText size={14} /> {busy === "pdf" ? t("common.exporting") : t("common.exportPdf")}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {progress ? <ImportProgressBar progress={progress} /> : null}
      {note ? <span className="access-import-note">{note}</span> : null}
    </>
  );
}
