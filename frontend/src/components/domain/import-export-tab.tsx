"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UploadCloud } from "lucide-react";
import { dataTransferApi } from "@/lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";

type ImportMode = "replace" | "merge";

export function ImportExportTab() {
  return (
    <div className="space-y-6">
      <ImportAccessCard />
      <ImportExcelCard />
    </div>
  );
}

function ImportAccessCard() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [log, setLog] = useState<string[] | null>(null);

  const mutation = useMutation({
    mutationFn: () => dataTransferApi.importAccess(file!, mode),
    onSuccess: (res) => setLog(res.log),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("importExport.importAccessTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-[var(--win-muted)]">{t("importExport.importAccessHelp")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>{t("importExport.selectFile")}</Label>
            <input
              type="file"
              accept=".mdb,.accdb"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] px-2 py-1 text-sm"
            />
          </div>
          <div>
            <Label>{t("importExport.modeLabel")}</Label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="merge">{t("importExport.modeMerge")}</option>
              <option value="replace">{t("importExport.modeReplace")}</option>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending}>
            <UploadCloud size={16} /> {mutation.isPending ? t("common.importing") : t("importExport.startImport")}
          </Button>
        </div>
        {mutation.isError && (
          <p className="mt-3 text-xs font-semibold text-[var(--win-danger)]">{(mutation.error as Error).message}</p>
        )}
        {mutation.isSuccess && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-[#0d5c0d]">{t("importExport.importSuccess")}</p>
            {log && (
              <pre className="mt-2 max-h-40 overflow-y-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] p-2 text-[11px]">
                {log.join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportExcelCard() {
  const { t } = useI18n();
  const [resource, setResource] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");

  const resourcesQuery = useQuery({ queryKey: ["data", "importable-resources"], queryFn: dataTransferApi.importableResources });
  const mutation = useMutation({
    mutationFn: () => dataTransferApi.importExcel(resource, file!, mode),
  });

  const options = resourcesQuery.data || [];
  const activeResource = resource || options[0] || "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("importExport.importExcelTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-[var(--win-muted)]">{t("importExport.importExcelHelp")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <Label>{t("importExport.selectResource")}</Label>
            <Select value={activeResource} onChange={(e) => setResource(e.target.value)}>
              {options.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>{t("importExport.selectFile")}</Label>
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] px-2 py-1 text-sm"
            />
          </div>
          <div>
            <Label>{t("importExport.modeLabel")}</Label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="merge">{t("importExport.modeMerge")}</option>
              <option value="replace">{t("importExport.modeReplace")}</option>
            </Select>
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => mutation.mutate()} disabled={!file || !activeResource || mutation.isPending}>
            <UploadCloud size={16} /> {mutation.isPending ? t("common.importing") : t("importExport.startImport")}
          </Button>
        </div>
        {mutation.isError && (
          <p className="mt-3 text-xs font-semibold text-[var(--win-danger)]">{(mutation.error as Error).message}</p>
        )}
        {mutation.isSuccess && mutation.data && (
          <div className="mt-3 space-y-1 text-xs">
            <p className="font-semibold text-[#0d5c0d]">
              {t("importExport.importedRows", { count: mutation.data.imported })}
              {mutation.data.skipped > 0 ? ` — ${t("importExport.skippedRows", { count: mutation.data.skipped })}` : ""}
            </p>
            {mutation.data.errors.length > 0 && (
              <pre className="max-h-32 overflow-y-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] p-2 text-[11px] text-[var(--win-danger)]">
                {mutation.data.errors.join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
