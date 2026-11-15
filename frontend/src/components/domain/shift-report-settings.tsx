"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw, Save } from "lucide-react";
import { voltageSyncApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import type { VoltageSyncRunResult, VoltageSyncSettings } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";

/** AriaORMS cell-room shift report: URL, the two daily pull times, and a manual run. */
export function ShiftReportSettings({ initial }: { initial: VoltageSyncSettings }) {
  const { locale } = useI18n();
  const fa = locale === "fa";
  const queryClient = useQueryClient();
  const times = (initial.shift_report_times || "07:00,19:00").split(",");
  const [enabled, setEnabled] = useState(initial.shift_report_enabled);
  const [url, setUrl] = useState(initial.shift_report_url || "");
  const [first, setFirst] = useState(times[0] || "07:00");
  const [second, setSecond] = useState(times[1] || "19:00");
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<VoltageSyncRunResult | null>(null);

  const save = useMutation({
    mutationFn: () =>
      voltageSyncApi.updateSettings({
        shift_report_enabled: enabled,
        shift_report_url: url || null,
        shift_report_times: [first, second].filter(Boolean).join(","),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["voltage-sync-settings"], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const run = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return voltageSyncApi.runShiftNow(setProgress);
    },
    onSuccess: (data) => {
      setResult(data);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ["voltage-sync-settings"] });
    },
    onError: () => setProgress(null),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fa ? "گزارش شیفت AriaORMS (الکترولایزرهای در سرویس و کیلوآمپر)" : "AriaORMS shift report (in-service electrolyzers and kA)"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-[var(--win-text-dim)]">
            {fa
              ? "ساعت صبح، شیفت ۱۲ شبِ روز قبل را می‌گیرد. ساعت عصر، شیفت ۱۲ صبحِ همان روز را می‌گیرد. کیلوآمپر قطار، تعداد در سرویس و نام سرپرست مبنای داشبورد هستند. نام کاربری و رمز همان تنظیمات بالاست."
              : "The morning time pulls the previous day's 12 شب shift. The evening time pulls the same day's 12 صبح shift. Train kiloamperes, the in-service count and the supervisor are what the dashboard uses. The login is the one saved above."}
          </p>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {fa ? "دریافت خودکار گزارش شیفت فعال باشد" : "Pull the shift report automatically"}
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>{fa ? "لینک گزارش شیفت" : "Shift report link"}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" />
            </div>
            <div>
              <Label>{fa ? "صبح — شیفت ۱۲ شب روز قبل" : "Morning — previous day's 12 شب"}</Label>
              <Input type="time" value={first} onChange={(e) => setFirst(e.target.value)} className="max-w-[160px]" />
            </div>
            <div>
              <Label>{fa ? "عصر — شیفت ۱۲ صبح همان روز" : "Evening — same day's 12 صبح"}</Label>
              <Input type="time" value={second} onChange={(e) => setSecond(e.target.value)} className="max-w-[160px]" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              <Save className="h-4 w-4" />
              {fa ? "ذخیره" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => run.mutate()} disabled={run.isPending || progress != null}>
              {run.isPending || progress != null ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {fa ? "دریافت گزارش شیفت اکنون" : "Pull the shift report now"}
            </Button>
            {saved ? <span className="text-sm font-semibold text-green-700">{fa ? "ذخیره شد" : "Saved"}</span> : null}
            {save.isError ? <span className="text-sm text-red-700">{(save.error as Error)?.message}</span> : null}
          </div>
          <div className="rounded border border-[var(--win-shadow)] bg-[var(--win-face-hi)] p-3 text-sm">
            <div>
              <span className="font-semibold">{fa ? "آخرین دریافت" : "Last pull"}: </span>
              {initial.shift_last_run_at ? formatDateTime(initial.shift_last_run_at) : fa ? "هنوز انجام نشده" : "never"}
              {initial.shift_last_status ? ` · ${initial.shift_last_status}` : ""}
            </div>
            {initial.shift_next_run_at ? (
              <div className="mt-1">
                <span className="font-semibold">{fa ? "دریافت بعدی" : "Next pull"}: </span>
                {formatDateTime(initial.shift_next_run_at)}
              </div>
            ) : null}
            {initial.shift_last_message ? <div className="mt-1 text-xs text-[var(--win-text-dim)]">{initial.shift_last_message}</div> : null}
          </div>
          {progress ? <ImportProgressBar progress={progress} wide /> : null}
          {run.isError ? <div className="text-sm text-red-700">{(run.error as Error)?.message}</div> : null}
          {result ? (
            <div className="rounded border border-[var(--win-shadow)] p-3 text-sm">
              <div className="font-semibold">{result.ok ? (fa ? "موفق" : "Success") : fa ? "ناموفق" : "Not saved"}</div>
              <div className="mt-1">{result.message}</div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}