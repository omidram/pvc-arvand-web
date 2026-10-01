"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { ReportColumn, ResultsPane, useColumnState } from "@/components/layout/access-report";
import { statisticsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function twoYearsAgoIso() {
  const day = new Date();
  day.setFullYear(day.getFullYear() - 2);
  return day.toISOString().slice(0, 10);
}

export default function PowerConsumptionPage() {
  const { t } = useI18n();
  const [from, setFrom] = useState(twoYearsAgoIso);
  const [till, setTill] = useState(todayIso);
  const [group, setGroup] = useState<"plant" | "train" | "electrolyzer" | "rack">("electrolyzer");
  const plant = useColumnState({ result: "table" });
  const train = useColumnState({ result: "table" });
  const el = useColumnState({ result: "table" });
  const rack = useColumnState({ result: "table" });

  const powerQuery = useQuery({
    queryKey: ["statistics", "power-consumption", group, from, till],
    queryFn: () => statisticsApi.powerConsumption({ group, date_from: from, date_till: till }),
  });

  const rows = useMemo(
    () =>
      (powerQuery.data?.rows || []).map((row) => ({
        label: row.key,
        value: formatNumber(row.energy_kwh, 1),
        current: row.current_ka,
        power: row.avg_kw,
        hours: row.hours,
      })),
    [powerQuery.data]
  );

  return (
    <AccessHub title={t("mainMenu.powerConsumption")}>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <p className="mb-2 text-[11px] text-[var(--win-muted)]">
        {powerQuery.data?.formula || "kWh = V_total × I_kA × hours"}
        {powerQuery.data?.total_kwh != null ? ` · ${t("monitoring.energyKwh")} ${formatNumber(powerQuery.data.total_kwh, 0)}` : ""}
      </p>
      <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4">
        <ReportColumn
          title={t("menus.totalPlant")}
          values={plant.values}
          onChange={plant.onChange}
          onDisplay={() => setGroup("plant")}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [{ value: "table", label: t("menus.table") }],
            },
          ]}
        />
        <ReportColumn
          title={t("menus.train")}
          values={train.values}
          onChange={train.onChange}
          onDisplay={() => setGroup("train")}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [{ value: "table", label: t("menus.table") }],
            },
          ]}
        />
        <ReportColumn
          title={t("menus.electrolyzers")}
          values={el.values}
          onChange={el.onChange}
          onDisplay={() => setGroup("electrolyzer")}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [{ value: "table", label: t("menus.table") }],
            },
          ]}
        />
        <ReportColumn
          title={`${t("monitoring.rack1")} / ${t("monitoring.rack2")}`}
          values={rack.values}
          onChange={rack.onChange}
          onDisplay={() => setGroup("rack")}
          groups={[
            {
              legend: t("menus.resultsAs"),
              name: "result",
              options: [{ value: "table", label: t("menus.table") }],
            },
          ]}
        />
      </div>
      <ResultsPane
        mode="table"
        title={`${t("monitoring.energyKwh")} · ${group}`}
        rows={rows}
        xKey="label"
        yKey="value"
        yLabel="kWh"
      />
      {powerQuery.isFetching ? <p className="mt-2 text-[11px]">{t("common.loading")}</p> : null}
    </AccessHub>
  );
}
