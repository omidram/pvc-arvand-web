"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Activity, Boxes, PowerOff, Zap, Clock, Gauge } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { downloadExport, reportsApi } from "@/lib/endpoints";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { formatDateTime, formatDisplayedDate, formatNumber, orDash } from "@/lib/utils";
import type { Column } from "@/components/ui/data-table";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

export default function ReportsPage() {
  const { t } = useI18n();
  useCalendar();
  const [electrolyzer, setElectrolyzer] = useState("");
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const filter = electrolyzer || undefined;

  const summaryQuery = useQuery({
    queryKey: ["reports", "summary", filter],
    queryFn: () => reportsApi.summary(filter),
  });
  const trendsQuery = useQuery({
    queryKey: ["reports", "trends", filter],
    queryFn: () => reportsApi.trends(filter),
  });

  async function handleExport(format: "xlsx" | "pdf") {
    setExporting(format);
    try {
      await downloadExport("/reports", format, { electrolyzer: filter }, `report.${format}`);
    } finally {
      setExporting(null);
    }
  }

  const summary = summaryQuery.data;

  const outlierColumns: Column<{ label: string; value: number; z_score: number }>[] = [
    { key: "label", header: t("reports.label") },
    { key: "value", header: t("fields.standardizedVoltage"), render: (r) => formatNumber(r.value, 4) },
    { key: "z_score", header: t("reports.zScore") },
  ];

  const categoryColumns: Column<{ category: string; count: number; total_hours: number }>[] = [
    { key: "category", header: t("fields.category") },
    { key: "count", header: t("fields.count") },
    { key: "total_hours", header: t("reports.totalShutdownHours"), render: (r) => formatNumber(r.total_hours, 1) },
  ];

  const recentShutdownColumns: Column<NonNullable<typeof summary>["recent_shutdowns"][number]>[] = [
    { key: "plant_part", header: t("fields.plantPart"), render: (r) => orDash(r.plant_part) },
    { key: "category", header: t("fields.category"), render: (r) => orDash(r.category) },
    { key: "cause", header: t("fields.cause"), render: (r) => orDash(r.cause) },
    { key: "shutdown_time", header: t("fields.shutdownTime"), render: (r) => formatDateTime(r.shutdown_time) },
    { key: "startup_time", header: t("fields.startupTime"), render: (r) => formatDateTime(r.startup_time) },
  ];

  return (
    <AccessFormWindow
      caption={t("reports.title")}
      helpKey="reports"
      commands={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => handleExport("xlsx")} disabled={exporting !== null}>
            <FileSpreadsheet size={16} /> {exporting === "xlsx" ? t("common.exporting") : t("reports.exportExcel")}
          </Button>
          <Button variant="secondary" onClick={() => handleExport("pdf")} disabled={exporting !== null}>
            <FileText size={16} /> {exporting === "pdf" ? t("common.exporting") : t("reports.exportPdf")}
          </Button>
        </div>
      }
    >

      <div className="mb-4 max-w-xs">
        <Label>{t("reports.electrolyzerFilter")}</Label>
        <Input value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)} placeholder="e.g. E1" />
      </div>

      {summaryQuery.isLoading ? (
        <LoadingState />
      ) : summaryQuery.isError ? (
        <ErrorState message={(summaryQuery.error as Error).message} />
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label={t("reports.activeElements")} value={summary.counts.active_elements} icon={Boxes} accent="cyan" />
            <StatCard label={t("reports.totalElements")} value={summary.counts.total_elements} icon={Boxes} accent="blue" />
            <StatCard label={t("reports.totalShutdowns")} value={summary.counts.shutdowns} icon={PowerOff} accent="rose" />
            <StatCard label={t("reports.voltageReadings")} value={summary.counts.voltage_readings} icon={Zap} accent="amber" />
            <StatCard
              label={t("reports.avgStandardizedVoltage")}
              value={summary.voltage_stats ? formatNumber(summary.voltage_stats.mean, 4) : "—"}
              icon={Gauge}
              accent="emerald"
            />
            <StatCard
              label={t("reports.avgShutdownDuration")}
              value={summary.shutdown_stats.avg_duration_hours != null ? formatNumber(summary.shutdown_stats.avg_duration_hours, 1) : "—"}
              icon={Clock}
              accent="violet"
            />
            <StatCard label={t("reports.totalShutdownHours")} value={formatNumber(summary.shutdown_stats.total_hours, 1)} icon={Clock} accent="rose" />
            <StatCard
              label={t("reports.avgDol")}
              value={summary.dol_stats.mean_days != null ? formatNumber(summary.dol_stats.mean_days, 0) : "—"}
              icon={Activity}
              accent="cyan"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("reports.voltageTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                {!trendsQuery.data || trendsQuery.data.voltage_trend.length === 0 ? (
                  <EmptyState title={t("reports.noData")} />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={trendsQuery.data.voltage_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                      <XAxis dataKey="period" stroke="#3f3f3f" fontSize={11} tickFormatter={(value) => formatDisplayedDate(value)} />
                      <YAxis stroke="#3f3f3f" fontSize={11} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value) => formatDisplayedDate(value)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="avg_voltage" name={t("reports.avgStandardizedVoltage")} stroke="#0a246a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("reports.shutdownTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                {!trendsQuery.data || trendsQuery.data.shutdown_trend.length === 0 ? (
                  <EmptyState title={t("reports.noData")} />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={trendsQuery.data.shutdown_trend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                      <XAxis dataKey="period" stroke="#3f3f3f" fontSize={11} tickFormatter={(value) => formatDisplayedDate(value)} />
                      <YAxis stroke="#3f3f3f" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(value) => formatDisplayedDate(value)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="count" name={t("fields.count")} fill="#c99a3f" />
                      <Bar dataKey="total_hours" name={t("reports.totalShutdownHours")} fill="#0a246a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("reports.shutdownsByCategory")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={categoryColumns}
                data={summary.shutdown_stats.by_category}
                keyField="category"
                emptyTitle={t("reports.noData")}
              />
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("reports.voltageOutliers")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-[var(--win-muted)]">{t("reports.voltageOutliersHelp")}</p>
              {summary.voltage_outliers.length === 0 ? (
                <EmptyState title={t("reports.noOutliers")} />
              ) : (
                <DataTable columns={outlierColumns} data={summary.voltage_outliers} keyField="label" />
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("reports.recentShutdowns")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={recentShutdownColumns}
                data={summary.recent_shutdowns}
                keyField="nr"
                emptyTitle={t("reports.noData")}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </AccessFormWindow>
  );
}
