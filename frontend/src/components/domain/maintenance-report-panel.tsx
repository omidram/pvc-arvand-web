"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AccessGroup, AccessHub } from "@/components/layout/access-hub";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import {
  maintenanceReportsApi,
  relationsApi,
  type MaintenanceReportFile,
  type MaintenanceReportKind,
} from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { appAlert, appConfirm } from "@/lib/dialog";

const FORM_KEY = { anode: "anodes", cathode: "cathodes", membrane: "membranes" } as const;
const LOOKUP = { anode: "anode-numbers", cathode: "cathode-numbers", membrane: "membrane-numbers" } as const;
const TITLE_KEY = {
  anode: "maintenanceReports.titleAnode",
  cathode: "maintenanceReports.titleCathode",
  membrane: "maintenanceReports.titleMembrane",
} as const;

const FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,application/pdf,image/*";

function isImageName(name: string, type: string): boolean {
  return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name);
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadButton({ label, onPick }: { label: string; onPick: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={FILE_ACCEPT}
        multiple
        onChange={(e) => {
          const next = [...(e.target.files || [])];
          e.target.value = "";
          if (next.length) onPick(next);
        }}
      />
    </>
  );
}

function SelectedFilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useI18n();
  const image = isImageName(file.name, file.type);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, image]);
  return (
    <figure className="w-[96px] border border-[var(--win-border-shadow)] bg-white p-1">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-16 w-full object-cover" />
      ) : (
        <span className="grid h-16 w-full place-items-center bg-[var(--win-face-dark)] text-[10px] font-bold">PDF</span>
      )}
      <figcaption className="mt-1 truncate text-[10px]" title={file.name}>
        {file.name}
      </figcaption>
      <button type="button" className="mt-1 text-[10px] font-bold underline" onClick={onRemove}>
        {t("maintenanceReports.remove")}
      </button>
    </figure>
  );
}

function ReportFileLink({
  reportId,
  file,
  canEdit,
  onRemove,
}: {
  reportId: number;
  file: MaintenanceReportFile;
  canEdit: boolean;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const isImage = file.content_type.startsWith("image/");
  const blobQuery = useQuery({
    queryKey: ["maintenance-report-file", reportId, file.id],
    queryFn: () => maintenanceReportsApi.fileBlob(reportId, file.id),
    enabled: isImage,
  });
  const preview = useMemo(() => (blobQuery.data ? URL.createObjectURL(blobQuery.data) : null), [blobQuery.data]);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function open() {
    const blob = blobQuery.data || (await maintenanceReportsApi.fileBlob(reportId, file.id));
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div className="report-file">
      <button type="button" className="report-file-thumb" onClick={() => void open()} title={t("maintenanceReports.open")}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" />
        ) : (
          <span>{file.content_type === "application/pdf" ? "PDF" : "FILE"}</span>
        )}
      </button>
      <div className="report-file-meta">
        <button type="button" className="report-file-name" onClick={() => void open()} title={file.original_name}>
          {file.original_name}
        </button>
        <div className="report-file-size">{fileSize(file.size_bytes)}</div>
      </div>
      <button type="button" className="report-mini-btn" onClick={() => void open()}>
        {t("maintenanceReports.open")}
      </button>
      {canEdit ? (
        <button type="button" className="report-mini-btn" onClick={onRemove}>
          {t("maintenanceReports.remove")}
        </button>
      ) : null}
    </div>
  );
}

export function MaintenanceReportPanel({ kind }: { kind: MaintenanceReportKind }) {
  const { t } = useI18n();
  const { canView, canEdit } = useAuth();
  useCalendar();
  const qc = useQueryClient();
  const editable = canEdit(FORM_KEY[kind]);
  const [nr, setNr] = useState("");
  const [queryNr, setQueryNr] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => setQueryNr(nr.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [nr]);

  const lookupQuery = useQuery({
    queryKey: ["relations", LOOKUP[kind]],
    queryFn: () => relationsApi.lookup(LOOKUP[kind]),
  });
  const historyQuery = useQuery({
    queryKey: ["maintenance-reports", kind, queryNr],
    queryFn: () => maintenanceReportsApi.history(kind, queryNr),
    enabled: queryNr.length > 0 && canView(FORM_KEY[kind]),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      maintenanceReportsApi.create({
        kind,
        component_nr: queryNr,
        report_date: reportDate || undefined,
        title,
        notes,
        files,
      }),
    onSuccess: () => {
      setTitle("");
      setNotes("");
      setFiles([]);
      setReportDate("");
      setFormError("");
      qc.invalidateQueries({ queryKey: ["maintenance-reports", kind, queryNr] });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const addFilesMutation = useMutation({
    mutationFn: ({ reportId, next }: { reportId: number; next: File[] }) => maintenanceReportsApi.addFiles(reportId, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance-reports", kind, queryNr] }),
  });
  const removeMutation = useMutation({
    mutationFn: (reportId: number) => maintenanceReportsApi.remove(reportId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance-reports", kind, queryNr] }),
  });
  const removeFileMutation = useMutation({
    mutationFn: ({ reportId, fileId }: { reportId: number; fileId: number }) =>
      maintenanceReportsApi.removeFile(reportId, fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance-reports", kind, queryNr] }),
  });

  if (!canView(FORM_KEY[kind])) return null;
  const data = historyQuery.data;

  return (
    <AccessHub title={t(TITLE_KEY[kind])} titleBlue backHref="/elements" backLabel={t("elements.title")}>
      <p className="mb-3 text-xs text-[var(--win-muted)]">{t("maintenanceReports.hint")}</p>
      <div className="mb-3 max-w-sm">
        <Label>{t("maintenanceReports.number")}</Label>
        <Input
          list="maintenance-report-numbers"
          value={nr}
          onChange={(e) => setNr(e.target.value)}
          autoComplete="off"
        />
        <datalist id="maintenance-report-numbers">
          {(lookupQuery.data || []).map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>

      {!queryNr ? <div className="mon-empty">{t("maintenanceReports.emptyNumber")}</div> : null}
      {historyQuery.isLoading ? <LoadingState /> : null}
      {historyQuery.isError ? <ErrorState message={(historyQuery.error as Error).message} /> : null}

      {data ? (
        <div className="flex flex-col gap-4">
          <AccessGroup legend={t("maintenanceReports.maintenanceHistory")}>
            {data.maintenance.length === 0 ? (
              <div className="mon-empty">{t("maintenanceReports.noMaintenance")}</div>
            ) : (
              <div className="sheet-scroll overflow-auto border border-black bg-white">
                <table className="access-cont-table min-w-[720px]">
                  <thead>
                    <tr>
                      <th>{t("fields.date")}</th>
                      {kind === "membrane" ? (
                        <th>{t("fields.repairWork")}</th>
                      ) : (
                        <>
                          <th>{t("fields.findings")}</th>
                          <th>{t("fields.action")}</th>
                          <th>{t("fields.despatch")}</th>
                          <th>{t("fields.sheetReturn")}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.maintenance.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.date)}</td>
                        {kind === "membrane" ? (
                          <td>{row.repair_work || ""}</td>
                        ) : (
                          <>
                            <td>{row.finding || ""}</td>
                            <td>{row.action || ""}</td>
                            <td>{formatDate(row.dispatch_date)}</td>
                            <td>{formatDate(row.return_date)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AccessGroup>

          <AccessGroup legend={t("maintenanceReports.reports")}>
            {data.reports.length === 0 ? <div className="mon-empty">{t("maintenanceReports.noReports")}</div> : null}
            <div className="flex flex-col gap-3">
              {data.reports.map((report) => (
                <section key={report.id} className="report-card">
                  <div className="report-card-head">
                    <strong className="text-sm">
                      {formatDate(report.report_date) || "—"}
                      {report.title ? ` · ${report.title}` : ""}
                    </strong>
                    {editable ? (
                      <button
                        type="button"
                        className="report-mini-btn"
                        onClick={() => {
                          void appConfirm(t("maintenanceReports.removeReport")).then((ok) => {
                            if (ok) removeMutation.mutate(report.id);
                          });
                        }}
                      >
                        {t("maintenanceReports.remove")}
                      </button>
                    ) : null}
                  </div>
                  {report.notes ? <p className="mb-2 whitespace-pre-wrap text-xs">{report.notes}</p> : null}
                  <div className="flex flex-col gap-2">
                    {report.files.map((file) => (
                      <ReportFileLink
                        key={file.id}
                        reportId={report.id}
                        file={file}
                        canEdit={editable}
                        onRemove={() => {
                          void appConfirm(t("maintenanceReports.removeFile")).then((ok) => {
                            if (ok) {
                              removeFileMutation.mutate({ reportId: report.id, fileId: file.id });
                            }
                          });
                        }}
                      />
                    ))}
                  </div>
                  {editable ? (
                    <div className="mt-2">
                      <UploadButton
                        label={t("maintenanceReports.upload")}
                        onPick={(next) => addFilesMutation.mutate({ reportId: report.id, next })}
                      />
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </AccessGroup>

          {editable ? (
            <AccessGroup legend={t("maintenanceReports.newReport")}>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>{t("fields.date")}</Label>
                  <DateInput value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
                </div>
                <div>
                  <Label>{t("maintenanceReports.reportTitle")}</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label>{t("maintenanceReports.notes")}</Label>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label>{t("maintenanceReports.files")}</Label>
                  <UploadButton label={t("maintenanceReports.upload")} onPick={(next) => setFiles((prev) => [...prev, ...next])} />
                  <p className="mt-1 text-[10px] text-[var(--win-muted)]">{t("maintenanceReports.fileTypes")}</p>
                  {files.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {files.map((file, index) => (
                        <SelectedFilePreview
                          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                          file={file}
                          onRemove={() => setFiles((prev) => prev.filter((_, item) => item !== index))}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              {formError ? <p className="mt-2 text-xs text-[var(--win-danger)]">{formError}</p> : null}
              <Button
                type="button"
                className="mt-3"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? t("maintenanceReports.saving") : t("maintenanceReports.save")}
              </Button>
            </AccessGroup>
          ) : null}
        </div>
      ) : null}
    </AccessHub>
  );
}
