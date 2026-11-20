"use client";

import { useState } from "react";
import { launchImportApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SLOTS = [
  "elements",
  "segregation",
  "pickup",
  "disassemble",
  "tafkik",
  "assembly",
  "membrane",
  "qc",
  "ready",
  "mechanical",
  "coating",
  "rateoff",
  "packed",
  "atcoater",
] as const;

type Slot = (typeof SLOTS)[number];

type Result = {
  ok: boolean;
  dry_run: boolean;
  accepted: number;
  rejected: { row: number; message: string; value?: string }[];
  rejected_count: number;
  error: string | null;
  links?: { renamed_rows: number; created_masters: number; masters_filled: number; groups_aligned: number };
};

export function LaunchImportTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.launch.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{t("settings.launch.intro")}</p>
          <p>{t("settings.launch.warn")}</p>
        </CardContent>
      </Card>
      {SLOTS.map((slot) => (
        <SlotCard key={slot} slot={slot} />
      ))}
    </div>
  );
}

function SlotCard({ slot }: { slot: Slot }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "apply">("");
  const [result, setResult] = useState<Result | null>(null);
  const [failed, setFailed] = useState("");

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "check" : "apply");
    setFailed("");
    try {
      setResult(await launchImportApi.run(slot, file, dryRun));
    } catch {
      setResult(null);
      setFailed(t("settings.launch.failed"));
    } finally {
      setBusy("");
    }
  }

  const shown = result?.rejected.slice(0, 40) ?? [];
  const hidden = Math.max(0, (result?.rejected_count ?? 0) - shown.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t(`settings.launch.slots.${slot}`)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground" dir="ltr">
          {t(`settings.launch.files.${slot}`)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
              setFailed("");
            }}
          />
          <Button type="button" variant="secondary" disabled={!file || busy !== ""} onClick={() => run(true)}>
            {busy === "check" ? "…" : t("settings.launch.check")}
          </Button>
          <Button type="button" disabled={!file || busy !== ""} onClick={() => run(false)}>
            {busy === "apply" ? "…" : t("settings.launch.apply")}
          </Button>
        </div>
        {!file && !result && <p className="text-muted-foreground">{t("settings.launch.idle")}</p>}
        {failed && <p>{failed}</p>}
        {result && (
          <div className="space-y-1">
            <p>
              {result.dry_run ? t("settings.launch.dry") : result.ok ? t("settings.launch.saved") : ""}{" "}
              {t("settings.launch.accepted")}: {result.accepted}
              {" · "}
              {t("settings.launch.refused")}: {result.rejected_count}
            </p>
            {result.links ? (
              <p>
                {t("settings.launch.links", {
                  renamed: result.links.renamed_rows,
                  masters: result.links.created_masters,
                  filled: result.links.masters_filled,
                  groups: result.links.groups_aligned,
                })}
              </p>
            ) : null}
            {result.error && <p>{result.error}</p>}
            {shown.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-auto">
                {shown.map((row, index) => (
                  <li key={`${row.row}-${index}`}>
                    {row.row}
                    {row.value ? ` · ${row.value}` : ""}
                    {" — "}
                    {row.message}
                  </li>
                ))}
              </ul>
            )}
            {hidden > 0 && <p>{t("settings.launch.more", { count: hidden })}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
