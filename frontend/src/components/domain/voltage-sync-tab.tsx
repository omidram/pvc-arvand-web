"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Play, Upload, RefreshCw } from "lucide-react";
import { voltageSyncApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import type { VoltageSyncRunResult, VoltageSyncSettings } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";

function SyncForm({ initial }: { initial: VoltageSyncSettings }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [enabled, setEnabled] = useState(initial.enabled);
  const [username, setUsername] = useState(initial.username || "");
  const [password, setPassword] = useState("");
  const [dailyTime, setDailyTime] = useState(initial.daily_time || "00:00");
  const [lookbackDays, setLookbackDays] = useState(initial.lookback_days || 1);
  const [watchDir, setWatchDir] = useState(initial.watch_dir || initial.resolved_watch_dir || "");
  const [pollSeconds, setPollSeconds] = useState(initial.poll_seconds);
  const [sourceUrl, setSourceUrl] = useState(initial.source_url || "");
  const [saved, setSaved] = useState(false);
  const [lastResult, setLastResult] = useState<VoltageSyncRunResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      voltageSyncApi.updateSettings({
        enabled,
        username: username || null,
        password: password || undefined,
        daily_time: dailyTime || "00:00",
        lookback_days: lookbackDays,
        watch_dir: watchDir || null,
        poll_seconds: pollSeconds,
        source_url: sourceUrl || null,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["voltage-sync-settings"], data);
      setPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const runMutation = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return voltageSyncApi.runNow(setProgress);
    },
    onSuccess: (data) => {
      setLastResult(data);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["voltage-sync-settings"] });
    },
    onError: () => setProgress(null),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return voltageSyncApi.importFile(file, undefined, setProgress);
    },
    onSuccess: (data) => {
      setLastResult(data);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["voltage-sync-settings"] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: () => setProgress(null),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--win-text-dim)]">{t("voltageSync.description")}</p>

      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("voltageSync.enable")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("voltageSync.username")}</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <Label>{t("voltageSync.password")}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial.password_set ? t("voltageSync.passwordKept") : ""}
            autoComplete="current-password"
          />
        </div>
        <div>
          <Label>{t("voltageSync.dailyTime")}</Label>
          <Input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="max-w-[160px]" />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("voltageSync.dailyTimeHelp")}</p>
        </div>
        <div>
          <Label>{t("voltageSync.lookbackDays")}</Label>
          <Input
            type="number"
            min={1}
            max={90}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.min(90, Math.max(1, Number(e.target.value) || 7)))}
            className="max-w-[160px]"
          />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("voltageSync.lookbackDaysHelp")}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {[1, 3, 7, 14, 30].map((n) => (
              <Button
                key={n}
                type="button"
                variant={lookbackDays === n ? "default" : "secondary"}
                className="h-7 px-2 text-xs"
                onClick={() => setLookbackDays(n)}
              >
                {t("voltageSync.lookbackPreset", { days: String(n) })}
              </Button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label>{t("voltageSync.sourceUrl")}</Label>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>{t("voltageSync.watchDir")}</Label>
          <Input value={watchDir} onChange={(e) => setWatchDir(e.target.value)} placeholder={initial.resolved_watch_dir || ""} />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("voltageSync.watchDirHelp")}</p>
        </div>
        <div>
          <Label>{t("voltageSync.pollSeconds")}</Label>
          <Input
            type="number"
            min={30}
            max={3600}
            value={pollSeconds}
            onChange={(e) => setPollSeconds(Number(e.target.value) || 30)}
            className="max-w-[160px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? t("voltageSync.saving") : t("voltageSync.save")}
        </Button>
        {saved ? <span className="text-sm font-semibold text-green-700">{t("voltageSync.saved")}</span> : null}
        {saveMutation.isError ? (
          <span className="text-sm text-red-700">{(saveMutation.error as Error)?.message || t("voltageSync.saveError")}</span>
        ) : null}
      </div>

      <div className="rounded border border-[var(--win-shadow)] bg-[var(--win-face-hi)] p-3 text-sm">
        <div>
          <span className="font-semibold">{t("voltageSync.resolvedDir")}: </span>
          <code className="text-xs">{initial.resolved_watch_dir}</code>
        </div>
        <div className="mt-1">
          <span className="font-semibold">{t("voltageSync.filesInFolder")}: </span>
          {initial.watched_file_count}
        </div>
        <div className="mt-1">
          <span className="font-semibold">{t("voltageSync.lastRun")}: </span>
          {initial.last_run_at ? formatDateTime(initial.last_run_at) : t("voltageSync.lastRunNever")}
          {initial.last_run_status ? ` · ${initial.last_run_status}` : ""}
        </div>
        {initial.next_run_at ? (
          <div className="mt-1">
            <span className="font-semibold">{t("voltageSync.nextRun")}: </span>
            {formatDateTime(initial.next_run_at)}
          </div>
        ) : null}
        {initial.last_run_message ? (
          <div className="mt-1 text-xs text-[var(--win-text-dim)]">{initial.last_run_message}</div>
        ) : null}
        <div className="mt-1 text-xs text-[var(--win-text-dim)]">
          {initial.password_set ? t("voltageSync.credentialsReady") : t("voltageSync.credentialsMissing")}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runMutation.isPending ? t("voltageSync.running") : t("voltageSync.runNow")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploadMutation.isPending}>
          <Upload className="h-4 w-4" />
          {uploadMutation.isPending ? t("voltageSync.uploading") : t("voltageSync.uploadExcel")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadMutation.mutate(f);
          }}
        />
      </div>

      {progress && (runMutation.isPending || uploadMutation.isPending) ? <ImportProgressBar progress={progress} wide /> : null}
      {runMutation.isError ? (
        <div className="text-sm text-red-700">{(runMutation.error as Error)?.message}</div>
      ) : null}
      {lastResult ? (
        <div className="rounded border border-[var(--win-shadow)] p-3 text-sm">
          <div className="font-semibold">{lastResult.ok ? t("voltageSync.statusSuccess") : t("voltageSync.statusError")}</div>
          <div className="mt-1">{lastResult.message}</div>
          <div className="mt-1 text-xs text-[var(--win-text-dim)]">
            {t("voltageSync.summary", {
              scanned: String(lastResult.files_scanned),
              applied: String(lastResult.files_applied),
              rows: String(lastResult.rows_upserted),
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function VoltageSyncTab() {
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["voltage-sync-settings"],
    queryFn: () => voltageSyncApi.getSettings(),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) {
    return (
      <div className="space-y-2">
        <ErrorState message={(error as Error)?.message || t("voltageSync.loadError")} />
        <Button type="button" variant="secondary" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          {t("voltageSync.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("voltageSync.scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncForm key={`${data.id}-${data.last_run_at || "none"}-${data.watched_file_count}`} initial={data} />
        </CardContent>
      </Card>
    </div>
  );
}
