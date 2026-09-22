"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadExport } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";

/** Excel / PDF export buttons for a resource list, reused across every form page. */
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
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);

  async function handle(format: "xlsx" | "pdf") {
    setBusy(format);
    try {
      await downloadExport(prefix, format, params, filenameBase ? `${filenameBase}.${format}` : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => handle("xlsx")} disabled={busy !== null}>
        <FileSpreadsheet size={14} /> {busy === "xlsx" ? t("common.exporting") : t("common.exportExcel")}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => handle("pdf")} disabled={busy !== null}>
        <FileText size={14} /> {busy === "pdf" ? t("common.exporting") : t("common.exportPdf")}
      </Button>
    </>
  );
}
