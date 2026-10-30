"use client";

import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { monitoringApi } from "@/lib/endpoints";
import { secMatch } from "@/lib/sec-formula";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

/** One-glance management strip: how close the plant's real DC power consumption
 * intensity is to the design curve, across every electrolyzer with a live current reading. */
export function SecMatchSummary() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["monitoring", "snapshot", "sec-match"],
    queryFn: monitoringApi.snapshot,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const rows = (q.data?.electrolyzers ?? [])
    .map((b) => secMatch(b.avg_voltage, b.current_ka))
    .filter((m): m is NonNullable<typeof m> => m != null);

  if (q.isLoading || !rows.length) return null;

  const ok = rows.filter((r) => r.tone === "ok").length;
  const warning = rows.filter((r) => r.tone === "warning").length;
  const danger = rows.filter((r) => r.tone === "danger").length;
  const avgMatch = rows.reduce((sum, r) => sum + r.matchPct, 0) / rows.length;
  const tone = danger > 0 ? "danger" : warning > 0 ? "warning" : "ok";

  return (
    <div className={`sms sms-${tone}`} title={t("monitoring.secMatchTitle")}>
      <span className="sms-icon">
        <Gauge size={18} />
      </span>
      <div className="sms-body">
        <div className="sms-title">{t("monitoring.secMatchTitle")}</div>
        <div className="sms-summary">{t("monitoring.secMatchSummary", { ok, warning, danger })}</div>
      </div>
      <div className="sms-gauge">
        <div className="sms-gauge-value">{formatNumber(avgMatch, 0)}%</div>
        <div className="sms-gauge-label">{t("monitoring.secMatchAvg")}</div>
      </div>
    </div>
  );
}
