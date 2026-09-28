"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  CircleDot,
  Layers,
  PowerOff,
  ClipboardCheck,
  FlaskConical,
  Zap,
  Factory,
} from "lucide-react";
import { statisticsApi, shutdownSummaryApi } from "@/lib/endpoints";
import { AccessFormWindow } from "@/components/layout/access-form";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { VoltageReportPanel } from "@/components/domain/voltage-report-panel";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#0a246a", "#3a6ea5", "#7fa8d9", "#a10000", "#c99a3f", "#5fa85f"];
const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

export default function OverviewPage() {
  const { t } = useI18n();
  const dashboardQuery = useQuery({
    queryKey: ["statistics", "dashboard", "with-voltage-gauges"],
    queryFn: statisticsApi.dashboard,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const dolQuery = useQuery({ queryKey: ["statistics", "dol-by-membrane-type"], queryFn: statisticsApi.dolByMembraneType });
  const shutdownSummaryQuery = useQuery({ queryKey: ["shutdowns", "summary"], queryFn: shutdownSummaryApi.get });

  if (dashboardQuery.isLoading) return <LoadingState label={t("dashboard.loading")} />;
  if (dashboardQuery.isError) return <ErrorState message={(dashboardQuery.error as Error).message} />;

  const stats = dashboardQuery.data!;
  const counts = stats.counts;
  const voltage = stats.voltage ?? null;

  return (
    <AccessFormWindow caption={t("dashboard.title", { customer: stats.customer || "Plant" })} helpKey="overview">
      <VoltageReportPanel
        voltage={voltage}
        loading={dashboardQuery.isLoading}
        error={dashboardQuery.isError ? (dashboardQuery.error as Error).message : null}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t("dashboard.electrolyzers")} value={counts.electrolyzers} icon={Factory} accent="cyan" />
        <StatCard label={t("dashboard.elementsActive")} value={counts.elements_active} icon={Boxes} accent="emerald" />
        <StatCard label={t("dashboard.elementsTotal")} value={counts.elements_total} icon={Boxes} accent="blue" />
        <StatCard label={t("dashboard.anodes")} value={counts.anodes} icon={CircleDot} accent="violet" />
        <StatCard label={t("dashboard.cathodes")} value={counts.cathodes} icon={CircleDot} accent="violet" />
        <StatCard label={t("dashboard.membranes")} value={counts.membranes} icon={Layers} accent="amber" />
        <StatCard label={t("dashboard.shutdowns")} value={counts.shutdowns} icon={PowerOff} accent="rose" />
        <StatCard label={t("dashboard.inspections")} value={counts.inspections} icon={ClipboardCheck} accent="cyan" />
        <StatCard label={t("dashboard.analysisSamples")} value={counts.analysis_samples} icon={FlaskConical} accent="emerald" />
        <StatCard
          label={t("dashboard.plantTotalVoltage")}
          value={voltage?.plant_total_voltage != null ? `${formatNumber(voltage.plant_total_voltage, 1)} V` : "—"}
          icon={Zap}
          accent="blue"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.dolByMembrane")}</CardTitle>
          </CardHeader>
          <CardContent>
            {dolQuery.isLoading ? (
              <LoadingState />
            ) : !dolQuery.data || dolQuery.data.length === 0 ? (
              <EmptyState title={t("dashboard.noMembraneData")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dolQuery.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                  <XAxis dataKey="membrane_type" stroke="#3f3f3f" fontSize={11} />
                  <YAxis stroke="#3f3f3f" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="active" name={t("dashboard.active")} fill="#0a246a" />
                  <Bar dataKey="passive" name={t("dashboard.retired")} fill="#9a978d" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.shutdownsByCategory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {shutdownSummaryQuery.isLoading ? (
              <LoadingState />
            ) : !shutdownSummaryQuery.data || shutdownSummaryQuery.data.by_category.length === 0 ? (
              <EmptyState title={t("dashboard.noShutdownData")} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={shutdownSummaryQuery.data.by_category}
                    dataKey="count"
                    nameKey="category"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {shutdownSummaryQuery.data.by_category.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </AccessFormWindow>
  );
}
