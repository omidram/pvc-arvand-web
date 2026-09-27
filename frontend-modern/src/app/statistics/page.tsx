"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { statisticsApi } from "@/lib/endpoints";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TOOLTIP_STYLE = { background: "#ffffff", border: "1px solid #808080", borderRadius: 0, fontSize: 12, color: "#000" };

export default function StatisticsPage() {
  const { t } = useI18n();
  const dolQuery = useQuery({ queryKey: ["statistics", "dol-by-membrane-type"], queryFn: statisticsApi.dolByMembraneType });
  const groupsQuery = useQuery({ queryKey: ["statistics", "groups"], queryFn: statisticsApi.groups });

  const [electrolyzer, setElectrolyzer] = useState("");
  const powerQuery = useQuery({
    queryKey: ["statistics", "power-consumption", electrolyzer],
    queryFn: () => statisticsApi.powerConsumption(electrolyzer || undefined),
  });

  return (
    <div>
      <PageHeader title={t("statistics.title")} description={t("statistics.description")} helpKey="statistics" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("statistics.dolTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {dolQuery.isLoading ? (
              <LoadingState />
            ) : !dolQuery.data || dolQuery.data.length === 0 ? (
              <EmptyState title={t("statistics.noData")} />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dolQuery.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#b8b5ad" />
                  <XAxis dataKey="membrane_type" stroke="#3f3f3f" fontSize={11} />
                  <YAxis stroke="#3f3f3f" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="active" name={t("dashboard.active")} fill="#0a246a" />
                  <Bar dataKey="passive" name={t("dashboard.retired")} fill="#9a978d" />
                  <Bar dataKey="total_dol_days" name={t("statistics.totalDolDays")} fill="#c99a3f" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("statistics.powerTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Label>{t("statistics.filterElectrolyzerOptional")}</Label>
              <Input value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)} className="max-w-xs" />
            </div>
            {powerQuery.isLoading ? (
              <LoadingState />
            ) : (
              <div className="space-y-3">
                <StatCard
                  label={t("statistics.recordsAnalyzed")}
                  value={(powerQuery.data?.records as number) ?? 0}
                  icon={Zap}
                  accent="cyan"
                />
                <StatCard
                  label={t("statistics.avgSpecificPower")}
                  value={
                    powerQuery.data?.average_specific_power_kwh_per_kA_h
                      ? t("statistics.avgCellVoltage", {
                          value: powerQuery.data.average_specific_power_kwh_per_kA_h as number,
                        })
                      : "—"
                  }
                  icon={Zap}
                  accent="amber"
                />
                <p className="text-xs text-[var(--win-muted)]">{t("statistics.powerNote")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("statistics.groupStatsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {groupsQuery.isError ? (
            <ErrorState message={(groupsQuery.error as Error).message} />
          ) : (
            <DataTable
              columns={[
                { key: "group_nr", header: t("fields.groupNr") },
                { key: "element_count", header: t("fields.elementCount") },
                { key: "anode_coating", header: t("fields.anodeCoating") },
                { key: "cathode_coating", header: t("fields.cathodeCoating") },
                { key: "membrane_type", header: t("fields.membraneType") },
                { key: "gap_mm", header: t("fields.gapMm") },
              ]}
              data={groupsQuery.data}
              keyField="group_nr"
              isLoading={groupsQuery.isLoading}
              emptyTitle={t("statistics.noGroups")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
