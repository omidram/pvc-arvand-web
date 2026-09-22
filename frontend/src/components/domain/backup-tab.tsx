"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, DatabaseBackup, Save, Play } from "lucide-react";
import { backupApi } from "@/lib/endpoints";
import type { BackupFileInfo, BackupSettings } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";

const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof ALL_DAYS)[number];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Owns the editable schedule fields, initialized once from the loaded
 * settings (mounted only after data is available, so no effect-based sync
 * from query -> local state is needed). */
function ScheduleForm({ initial }: { initial: BackupSettings }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [time, setTime] = useState(initial.time);
  const [days, setDays] = useState<Set<Day>>(new Set(initial.days_of_week.split(",").filter(Boolean) as Day[]));
  const [retentionCount, setRetentionCount] = useState(initial.retention_count);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      backupApi.updateSettings({
        enabled,
        time,
        days_of_week: Array.from(days).join(","),
        retention_count: retentionCount,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["backup-settings"], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function toggleDay(day: Day) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("backup.enable")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("backup.time")}</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="max-w-[160px]" />
        </div>
        <div>
          <Label>{t("backup.retentionCount")}</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={retentionCount}
            onChange={(e) => setRetentionCount(Number(e.target.value) || 1)}
            className="max-w-[160px]"
          />
        </div>
      </div>

      <div>
        <Label>{t("backup.days")}</Label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ALL_DAYS.map((day) => {
            const active = days.has(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={
                  active
                    ? "border-2 border-[var(--win-navy)] bg-[var(--win-navy)] px-2.5 py-1 text-xs font-bold text-white [border-style:inset]"
                    : "border-2 border-[var(--win-face)] bg-[var(--win-face)] px-2.5 py-1 text-xs font-semibold text-[var(--win-text)] [border-style:outset] hover:bg-[var(--win-face-hi)]"
                }
              >
                {t(`backup.day.${day}`)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setDays(new Set(ALL_DAYS))}>
            {t("backup.everyDay")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setDays(new Set(["sat", "sun"]))}>
            {t("backup.weekendsOnly")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setDays(new Set(["mon", "tue", "wed", "thu", "fri"]))}
          >
            {t("backup.weekdaysOnly")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t-2 border-[var(--win-face-dark)] pt-3 text-xs text-[var(--win-muted)]">
        <div>
          {t("backup.nextRun")}:{" "}
          <span className="font-semibold text-[var(--win-text)]">
            {initial.next_run_at ? formatDateTime(initial.next_run_at) : t("backup.never")}
          </span>
        </div>
      </div>

      {initial.last_run_at && (
        <div className="text-xs text-[var(--win-muted)]">
          {t("backup.lastRun")}:{" "}
          <span
            className={initial.last_run_status === "error" ? "font-semibold text-[var(--win-danger)]" : "font-semibold text-[#0d5c0d]"}
          >
            {formatDateTime(initial.last_run_at)} — {initial.last_run_status === "error" ? t("backup.statusError") : t("backup.statusSuccess")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save size={14} /> {t("backup.save")}
        </Button>
        {saved && <span className="text-xs font-semibold text-[#0d5c0d]">{t("backup.saved")}</span>}
      </div>
    </div>
  );
}

export function BackupTab() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["backup-settings"], queryFn: backupApi.getSettings });
  const listQuery = useQuery({ queryKey: ["backup-list"], queryFn: backupApi.list });

  const runMutation = useMutation({
    mutationFn: backupApi.runNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backup-list"] });
      queryClient.invalidateQueries({ queryKey: ["backup-settings"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: backupApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backup-list"] }),
  });

  const columns: Column<BackupFileInfo>[] = [
    { key: "filename", header: t("backup.filename"), className: "font-mono" },
    { key: "size_bytes", header: t("backup.size"), render: (r) => formatBytes(r.size_bytes) },
    { key: "created_at", header: t("backup.created"), render: (r) => formatDateTime(r.created_at) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("backup.scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {settingsQuery.isLoading ? (
            <LoadingState />
          ) : settingsQuery.isError ? (
            <ErrorState message={(settingsQuery.error as Error).message} />
          ) : settingsQuery.data ? (
            <ScheduleForm initial={settingsQuery.data} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backup.manualTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--win-muted)]">{t("backup.manualDescription")}</p>
          <Button type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <Play size={14} /> {runMutation.isPending ? t("backup.running") : t("backup.runNow")}
          </Button>
          {runMutation.isSuccess && (
            <p className="mt-2 text-xs font-semibold text-[#0d5c0d]">{t("backup.runSuccess")}</p>
          )}
          {runMutation.isError && <ErrorState message={(runMutation.error as Error).message} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup size={16} /> {t("backup.historyTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable<BackupFileInfo>
            columns={columns}
            data={listQuery.data}
            keyField="filename"
            isLoading={listQuery.isLoading}
            emptyTitle={t("backup.noBackups")}
            actions={(row) => (
              <>
                <Button size="sm" variant="ghost" onClick={() => backupApi.download(row.filename)} title={t("backup.download")}>
                  <Download size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(t("backup.confirmDelete"))) deleteMutation.mutate(row.filename);
                  }}
                  title={t("backup.delete")}
                >
                  <Trash2 size={14} className="text-[var(--win-danger)]" />
                </Button>
              </>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
