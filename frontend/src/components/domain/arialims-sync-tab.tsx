"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Play, RefreshCw, Wifi } from "lucide-react";
import { ariaLimsSyncApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { AriaLimsPoints } from "@/components/domain/arialims-points";
import type { AriaLimsEndMode, AriaLimsStartMode, AriaLimsSyncRunResult, AriaLimsSyncSettings } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";

const START_MODES: AriaLimsStartMode[] = ["lookback", "last_success", "fixed"];
const END_MODES: AriaLimsEndMode[] = ["auto", "yesterday", "today", "fixed"];

function WindowText({ range, t }: { range: string[]; t: (k: string, v?: Record<string, string>) => string }) {
  if (range.length !== 2) return <>—</>;
  return (
    <span dir="ltr">
      {t("ariaLimsSync.windowRange", { from: range[0], to: range[1] })} ({formatDate(range[0])} – {formatDate(range[1])})
    </span>
  );
}

function SyncForm({ initial }: { initial: AriaLimsSyncSettings }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(initial.enabled);
  const [baseUrl, setBaseUrl] = useState(initial.base_url || "");
  const [username, setUsername] = useState(initial.username || "");
  const [password, setPassword] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [dailyTime, setDailyTime] = useState(initial.daily_time || "01:00");
  const [lookbackDays, setLookbackDays] = useState(initial.lookback_days || 7);
  const [startMode, setStartMode] = useState<AriaLimsStartMode>(initial.start_mode || "lookback");
  const [startDate, setStartDate] = useState(initial.start_date || "");
  const [endMode, setEndMode] = useState<AriaLimsEndMode>(initial.end_mode || "auto");
  const [endDate, setEndDate] = useState(initial.end_date || "");
  const [analysisTypes, setAnalysisTypes] = useState(initial.analysis_types || "");
  const [saved, setSaved] = useState(false);
  const [lastResult, setLastResult] = useState<AriaLimsSyncRunResult | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const saveMutation = useMutation({
    mutationFn: () =>
      ariaLimsSyncApi.updateSettings({
        enabled,
        base_url: baseUrl || null,
        username: username || null,
        password: password || undefined,
        api_token: apiToken || undefined,
        daily_time: dailyTime || "01:00",
        lookback_days: lookbackDays,
        start_mode: startMode,
        start_date: startDate || null,
        end_mode: endMode,
        end_date: endDate || null,
        analysis_types: analysisTypes || null,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["arialims-sync-settings"], data);
      setPassword("");
      setApiToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const runMutation = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return ariaLimsSyncApi.runNow(setProgress);
    },
    onSuccess: (data) => {
      setLastResult(data);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["arialims-sync-settings"] });
    },
    onError: () => setProgress(null),
  });

  const testMutation = useMutation({
    mutationFn: () => ariaLimsSyncApi.testConnection(),
    onSuccess: (data) => {
      setTestMessage(data.ok ? t("ariaLimsSync.testOk", { msg: data.message }) : t("ariaLimsSync.testFail", { msg: data.message }));
    },
    onError: (err) => setTestMessage((err as Error)?.message || t("ariaLimsSync.testFail", { msg: "" })),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--win-text-dim)]">{t("ariaLimsSync.description")}</p>

      <div className="rounded border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        {t("ariaLimsSync.pendingNotice")}
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t("ariaLimsSync.enable")}
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>{t("ariaLimsSync.baseUrl")}</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://192.168.x.x:port"
          />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.baseUrlHelp")}</p>
        </div>
        <div>
          <Label>{t("ariaLimsSync.username")}</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <Label>{t("ariaLimsSync.password")}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={initial.password_set ? t("ariaLimsSync.passwordKept") : ""}
            autoComplete="current-password"
          />
        </div>
        <div className="sm:col-span-2">
          <Label>{t("ariaLimsSync.apiToken")}</Label>
          <Input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={initial.api_token_set ? t("ariaLimsSync.tokenKept") : t("ariaLimsSync.apiTokenPlaceholder")}
            autoComplete="off"
          />
        </div>
        <div>
          <Label>{t("ariaLimsSync.dailyTime")}</Label>
          <Input type="time" value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} className="max-w-[160px]" />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.dailyTimeHelp")}</p>
        </div>
        <div>
          <Label>{t("ariaLimsSync.lookbackDays")}</Label>
          <Input
            type="number"
            min={1}
            max={90}
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Math.min(90, Math.max(1, Number(e.target.value) || 7)))}
            className="max-w-[160px]"
            disabled={startMode === "fixed"}
          />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.lookbackDaysHelp")}</p>
        </div>
        <div>
          <Label>{t("ariaLimsSync.startMode")}</Label>
          <Select value={startMode} onChange={(e) => setStartMode(e.target.value as AriaLimsStartMode)}>
            {START_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`ariaLimsSync.startModes.${m}`)}
              </option>
            ))}
          </Select>
          {startMode === "fixed" ? (
            <div className="mt-2">
              <Label>{t("ariaLimsSync.startDate")}</Label>
              <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          ) : null}
          {startMode === "last_success" && !initial.last_success_at ? (
            <p className="mt-1 text-xs text-amber-800">{t("ariaLimsSync.lastSuccessFallback")}</p>
          ) : null}
        </div>
        <div>
          <Label>{t("ariaLimsSync.endMode")}</Label>
          <Select value={endMode} onChange={(e) => setEndMode(e.target.value as AriaLimsEndMode)}>
            {END_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`ariaLimsSync.endModes.${m}`)}
              </option>
            ))}
          </Select>
          {endMode === "fixed" ? (
            <div className="mt-2">
              <Label>{t("ariaLimsSync.endDate")}</Label>
              <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          ) : null}
        </div>
        <div className="sm:col-span-2 rounded border border-[var(--win-shadow)] bg-[var(--win-face-hi)] px-3 py-2 text-xs">
          <div>
            <span className="font-semibold">{t("ariaLimsSync.windowScheduled")}: </span>
            <WindowText range={initial.scheduled_window} t={t} />
          </div>
          <div>
            <span className="font-semibold">{t("ariaLimsSync.windowManual")}: </span>
            <WindowText range={initial.manual_window} t={t} />
          </div>
          <div className="mt-1 text-[var(--win-text-dim)]">{t("ariaLimsSync.windowHint")}</div>
        </div>
        <div className="sm:col-span-2">
          <Label>{t("ariaLimsSync.analysisTypes")}</Label>
          <Input
            value={analysisTypes}
            onChange={(e) => setAnalysisTypes(e.target.value)}
            placeholder={t("ariaLimsSync.analysisTypesPlaceholder")}
          />
          <p className="mt-1 text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.analysisTypesHelp")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? t("ariaLimsSync.saving") : t("ariaLimsSync.save")}
        </Button>
        {saved ? <span className="text-sm font-semibold text-green-700">{t("ariaLimsSync.saved")}</span> : null}
        {saveMutation.isError ? (
          <span className="text-sm text-red-700">{(saveMutation.error as Error)?.message || t("ariaLimsSync.saveError")}</span>
        ) : null}
      </div>

      <div className="rounded border border-[var(--win-shadow)] bg-[var(--win-face-hi)] p-3 text-sm">
        <div className="mt-1">
          <span className="font-semibold">{t("ariaLimsSync.lastSuccess")}: </span>
          {initial.last_success_at ? formatDateTime(initial.last_success_at) : t("ariaLimsSync.lastRunNever")}
        </div>
        <div className="mt-1">
          <span className="font-semibold">{t("ariaLimsSync.lastRun")}: </span>
          {initial.last_run_at ? formatDateTime(initial.last_run_at) : t("ariaLimsSync.lastRunNever")}
          {initial.last_run_status ? ` · ${initial.last_run_status}` : ""}
        </div>
        <div className="mt-0.5 text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.lastRunHint")}</div>
        {initial.next_run_at ? (
          <div className="mt-1">
            <span className="font-semibold">{t("ariaLimsSync.nextRun")}: </span>
            {formatDateTime(initial.next_run_at)}
          </div>
        ) : null}
        {initial.last_run_message ? (
          <div className="mt-1 text-xs text-[var(--win-text-dim)]">{initial.last_run_message}</div>
        ) : null}
        <div className="mt-2">
          <span className="font-semibold">{t("ariaLimsSync.catalogTitle")}</span>
          <ul className="mt-1 list-inside list-disc text-xs text-[var(--win-text-dim)]">
            {(initial.catalog || []).map((row) => (
              <li key={row.analysis_type}>
                {row.analysis_type}: {row.path} ({row.status})
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}>
          <Wifi className="h-4 w-4" />
          {testMutation.isPending ? t("ariaLimsSync.testing") : t("ariaLimsSync.testConnection")}
        </Button>
        <Button type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runMutation.isPending ? t("ariaLimsSync.running") : t("ariaLimsSync.runNow")}
        </Button>
      </div>

      {testMessage ? <div className="text-sm text-[var(--win-text-dim)]">{testMessage}</div> : null}
      {progress && runMutation.isPending ? <ImportProgressBar progress={progress} wide /> : null}
      {runMutation.isError ? (
        <div className="text-sm text-red-700">{(runMutation.error as Error)?.message}</div>
      ) : null}
      {lastResult ? (
        <div className="rounded border border-[var(--win-shadow)] p-3 text-sm">
          <div className="font-semibold">
            {lastResult.ok
              ? t("ariaLimsSync.statusSuccess")
              : lastResult.contract_ready === false
                ? t("ariaLimsSync.statusPending")
                : t("ariaLimsSync.statusError")}
          </div>
          <div className="mt-1">{lastResult.message}</div>
          <div className="mt-1 text-xs text-[var(--win-text-dim)]">
            {t("ariaLimsSync.summary", { rows: String(lastResult.rows_upserted) })}
          </div>
          {lastResult.details
            .filter((d) => d.status === "error")
            .map((d) => (
              <div key={String(d.scid)} className="mt-1 text-xs text-red-700">
                SCID {String(d.scid)}: {String(d.error)}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function AriaLimsSyncTab() {
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["arialims-sync-settings"],
    queryFn: () => ariaLimsSyncApi.getSettings(),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) {
    return (
      <div className="space-y-2">
        <ErrorState message={(error as Error)?.message || t("ariaLimsSync.loadError")} />
        <Button type="button" variant="secondary" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          {t("ariaLimsSync.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("ariaLimsSync.pointsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AriaLimsPoints />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("ariaLimsSync.scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SyncForm key={`${data.id}-${data.last_run_at || "none"}`} initial={data} />
        </CardContent>
      </Card>
    </div>
  );
}
