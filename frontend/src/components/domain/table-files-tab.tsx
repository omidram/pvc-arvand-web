"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Trash2 } from "lucide-react";
import { tableFilesApi, type ImportProgress, type TableFileRow } from "@/lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { archiveTableLabel } from "@/lib/archive-names";
import { useI18n } from "@/lib/i18n/context";
import { appConfirm } from "@/lib/dialog";
import { formatDateTime } from "@/lib/utils";

function tableLabel(row: TableFileRow, t: (path: string) => string, locale: string): string {
  const named = t(`tableFiles.names.${row.key}`);
  if (!named.startsWith("tableFiles.names.")) return named;
  return row.section === "archive" ? archiveTableLabel(row.label, locale) : row.label;
}

function exactBytes(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

export function TableFilesTab() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<TableFileRow | null>(null);
  const [term, setTerm] = useState("");
  const [section, setSection] = useState<"all" | "application" | "archive">("all");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const query = useQuery({
    queryKey: ["table-files"],
    queryFn: tableFilesApi.list,
  });

  const remove = useMutation({
    mutationFn: (row: TableFileRow) => tableFilesApi.remove(row.key),
    onSuccess: () => {
      setNote(t("tableFiles.deleted"));
      queryClient.invalidateQueries({ queryKey: ["table-files"] });
    },
  });

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return (query.data || []).filter((row) => {
      if (section !== "all" && row.section !== section) return false;
      if (!needle) return true;
      const label = tableLabel(row, t, locale).toLowerCase();
      return label.includes(needle) || row.key.toLowerCase().includes(needle) || (row.file_name || "").toLowerCase().includes(needle);
    });
  }, [query.data, section, term, t, locale]);

  async function onDelete(row: TableFileRow) {
    const ok = await appConfirm(t("tableFiles.confirmDelete", { name: tableLabel(row, t, locale) }));
    if (!ok) return;
    setNote("");
    remove.mutate(row);
  }

  async function onPick(file: File | undefined) {
    const row = target;
    if (!file || !row) return;
    const ok = await appConfirm(t("tableFiles.confirmUpload", { name: tableLabel(row, t, locale) }));
    if (!ok) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setNote("");
    setProgress({ percent: 0, processed: 0, total: 0 });
    try {
      const result = await tableFilesApi.upload(row.key, file, setProgress);
      setNote(t("tableFiles.uploadedOk", { records: result.records ?? 0 }));
      await queryClient.invalidateQueries({ queryKey: ["table-files"] });
    } catch (err) {
      setNote(err instanceof Error ? err.message : t("common.import"));
    } finally {
      setProgress(null);
      setTarget(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const columns: Column<TableFileRow>[] = [
    {
      key: "label",
      header: t("tableFiles.table"),
      render: (row) => tableLabel(row, t, locale),
    },
    {
      key: "section",
      header: t("tableFiles.section"),
      render: (row) => t(row.section === "archive" ? "tableFiles.archive" : "tableFiles.application"),
    },
    {
      key: "records",
      header: t("tableFiles.records"),
      render: (row) => row.records.toLocaleString("en-US"),
    },
    {
      key: "file_name",
      header: t("tableFiles.file"),
      render: (row) => row.file_name || t("tableFiles.noFile"),
    },
    {
      key: "size_bytes",
      header: t("tableFiles.size"),
      render: (row) => exactBytes(row.size_bytes),
    },
    {
      key: "uploaded_at",
      header: t("tableFiles.uploaded"),
      render: (row) => (row.uploaded_at ? formatDateTime(row.uploaded_at) : "—"),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("tableFiles.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-[var(--win-muted)]">{t("tableFiles.help")}</p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-bold">
            {t("tableFiles.search")}
            <Input className="mt-1 block w-64" value={term} onChange={(e) => setTerm(e.target.value)} />
          </label>
          {(["all", "application", "archive"] as const).map((item) => (
            <Button key={item} type="button" size="sm" variant={section === item ? "primary" : "secondary"} onClick={() => setSection(item)}>
              {t(`tableFiles.${item}`)}
            </Button>
          ))}
        </div>
        {query.isLoading ? <LoadingState /> : null}
        {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
        {query.data ? (
          <DataTable
            columns={columns}
            data={rows}
            keyField="key"
            emptyTitle={t("tableFiles.empty")}
            actions={(row) => (
              <span className="flex flex-wrap gap-1">
                {row.has_file ? (
                  <Button type="button" size="sm" variant="ghost" title={t("tableFiles.download")} onClick={() => tableFilesApi.download(row.key, row.file_name || "table.xlsx")}>
                    <Download size={14} />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={progress !== null}
                  onClick={() => {
                    setTarget(row);
                    fileRef.current?.click();
                  }}
                >
                  <FileUp size={14} /> {t("tableFiles.upload")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={progress !== null || remove.isPending || (row.records === 0 && !row.has_file)}
                  onClick={() => onDelete(row)}
                >
                  <Trash2 size={14} /> {t("tableFiles.delete")}
                </Button>
              </span>
            )}
          />
        ) : null}
        {progress ? (
          <div className="mt-3">
            <ImportProgressBar progress={progress} wide />
          </div>
        ) : null}
        {note ? <p className="mt-3 text-xs font-semibold text-[var(--win-navy)]">{note}</p> : null}
        {remove.isError ? <p className="mt-2 text-xs font-semibold text-[var(--win-danger)]">{(remove.error as Error).message}</p> : null}
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </CardContent>
    </Card>
  );
}
