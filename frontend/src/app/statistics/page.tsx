"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { electrolyzersApi, statisticsApi, voltageCalcApi } from "@/lib/endpoints";
import { AccessFormWindow } from "@/components/layout/access-form";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
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

function StatisticsMenu() {
  const { t } = useI18n();
  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const [elNr, setElNr] = useState(elQuery.data?.[0]?.name || "1G");
  const names = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);
  return (
    <AccessHub title={t("statistics.title")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.singleElementVoltages")}</div>
          <label className="mb-2 mt-2 block text-[12px]">
            {t("menus.electrolyzer")}
            <select className="access-inset-field mt-1 w-full" value={elNr} onChange={(e) => setElNr(e.target.value)}>
              {(names.length ? names : ["1G"]).map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <AccessBtn href={`/statistics?form=voltages&electrolyzer=${encodeURIComponent(elNr)}`}>{t("menus.elementVoltages")}</AccessBtn>
            <AccessBtn href="/statistics?form=high">{t("menus.highVoltages")}</AccessBtn>
            <AccessBtn href={`/statistics?form=distribution&electrolyzer=${encodeURIComponent(elNr)}`}>
              {t("menus.distributionUn")}
            </AccessBtn>
          </div>
        </div>
        <div className="access-sunken">
          <div className="access-col-title">{t("mainMenu.powerConsumption")}</div>
          <div className="mt-6 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=power">{t("menus.electrolyzers")}</AccessBtn>
          </div>
        </div>
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.membranes")}</div>
          <div className="mt-6 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=dol">{t("menus.dol")}</AccessBtn>
          </div>
        </div>
        <div className="access-sunken">
          <div className="access-col-title">{t("menus.groups")}</div>
          <div className="mt-6 flex flex-col gap-2">
            <AccessBtn href="/statistics?form=groups">{t("menus.unGroupsByDate")}</AccessBtn>
            <AccessBtn href="/statistics?form=groups">{t("menus.unGroupsByElDate")}</AccessBtn>
            <AccessBtn href="/statistics?form=groups">{t("menus.unGroupsInEl")}</AccessBtn>
          </div>
        </div>
      </div>
    </AccessHub>
  );
}

function StatisticsDetails() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const form = searchParams.get("form");
  const preEl = searchParams.get("electrolyzer") || "";
  const dolQuery = useQuery({ queryKey: ["statistics", "dol-by-membrane-type"], queryFn: statisticsApi.dolByMembraneType });
  const groupsQuery = useQuery({ queryKey: ["statistics", "groups"], queryFn: statisticsApi.groups });
  const [electrolyzer, setElectrolyzer] = useState(preEl);
  const powerQuery = useQuery({
    queryKey: ["statistics", "power-consumption", electrolyzer],
    queryFn: () => statisticsApi.powerConsumption(electrolyzer || undefined),
  });
  const distQuery = useQuery({
    queryKey: ["voltage", "distribution", electrolyzer],
    queryFn: () => voltageCalcApi.distribution(electrolyzer || undefined),
    enabled: form === "distribution" || form === "voltages" || form === "high",
  });
  const highQuery = useQuery({
    queryKey: ["voltage", "high", electrolyzer],
    queryFn: () => voltageCalcApi.highDeviation({ electrolyzer: electrolyzer || undefined }),
    enabled: form === "high",
  });

  const title =
    form === "power"
      ? t("mainMenu.powerConsumption")
      : form === "dol"
        ? t("menus.dol")
        : form === "distribution"
          ? t("menus.distributionUn")
          : form === "high"
            ? t("menus.highVoltages")
            : form === "voltages"
              ? t("menus.elementVoltages")
              : t("statistics.title");

  return (
    <AccessFormWindow caption={title} helpKey="statistics" backHref="/statistics" backLabel={t("statistics.title")}>
      {(form === "dol" || !form) && (
        <Card className="mb-4">
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
      )}

      {(form === "power" || form === "voltages") && (
        <Card className="mb-4" id="power">
          <CardHeader>
            <CardTitle>{form === "power" ? "Average Power Consumption" : "Element Voltages"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Label>Electrolyzer</Label>
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(form === "distribution" || form === "high") && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Label>Electrolyzer</Label>
              <Input value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)} className="max-w-xs" />
            </div>
            {form === "high" ? (
              highQuery.isLoading ? (
                <LoadingState />
              ) : (
                <pre className="access-sunken overflow-auto p-2 text-[11px]">{JSON.stringify(highQuery.data, null, 2)}</pre>
              )
            ) : distQuery.isLoading ? (
              <LoadingState />
            ) : (
              <pre className="access-sunken overflow-auto p-2 text-[11px]">{JSON.stringify(distQuery.data, null, 2)}</pre>
            )}
          </CardContent>
        </Card>
      )}

      {(form === "groups" || form === "dol") && (
        <Card>
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
      )}
    </AccessFormWindow>
  );
}

function StatisticsInner() {
  const searchParams = useSearchParams();
  if (!searchParams.get("form")) return <StatisticsMenu />;
  return <StatisticsDetails />;
}

export default function StatisticsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <StatisticsInner />
    </Suspense>
  );
}
