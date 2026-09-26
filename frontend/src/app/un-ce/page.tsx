"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { currentEfficiencyEntriesApi, electrolyzersApi, voltageReadingsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";

export default function UnCePage() {
  const { t } = useI18n();
  const [from, setFrom] = useState("2006-06-01");
  const [till, setTill] = useState("2016-10-04");
  const [elNr, setElNr] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [drawn, setDrawn] = useState(false);

  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const unQuery = useQuery({ queryKey: ["voltage-readings"], queryFn: () => voltageReadingsApi.list({ limit: 2000 }) });
  const ceQuery = useQuery({
    queryKey: ["current-efficiency-entries"],
    queryFn: () => currentEfficiencyEntriesApi.list({ limit: 2000 }),
  });

  const names = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);
  const rows = useMemo(() => {
    if (!drawn) return [];
    const byDate: Record<string, { date: string; un?: number; ce?: number }> = {};
    for (const r of unQuery.data || []) {
      if (elNr && !showAll && r.electrolyzer !== elNr) continue;
      const d = r.date?.slice(0, 10);
      if (!d) continue;
      if (from && d < from) continue;
      if (till && d > till) continue;
      byDate[d] = { ...(byDate[d] || { date: d }), un: r.standardized_voltage ?? r.voltage ?? undefined };
    }
    for (const r of ceQuery.data || []) {
      if (elNr && !showAll && r.scope_ref !== elNr) continue;
      const d = r.date?.slice(0, 10);
      if (!d) continue;
      if (from && d < from) continue;
      if (till && d > till) continue;
      byDate[d] = { ...(byDate[d] || { date: d }), ce: r.value_pct ?? undefined };
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [drawn, unQuery.data, ceQuery.data, elNr, showAll, from, till]);

  return (
    <AccessHub title={t("mainMenu.unCe")}>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <div className="max-w-md">
        <div className="mb-2 text-[12px] font-bold">{t("menus.electrolyzer")}</div>
        <select
          className="access-inset-field mb-3 w-40"
          value={elNr}
          onChange={(e) => {
            setElNr(e.target.value);
            setShowAll(false);
          }}
        >
          <option value="">—</option>
          {names.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <div className="flex flex-col gap-2">
          <AccessBtn className="!w-[140px]" onClick={() => setDrawn(true)}>
            {t("menus.graph")}
          </AccessBtn>
          <div className="text-[12px]">{t("menus.allElectrolyzers")}</div>
          <AccessBtn
            className="!w-[140px]"
            onClick={() => {
              setShowAll(true);
              setDrawn(true);
            }}
          >
            {t("menus.graph")}
          </AccessBtn>
        </div>
      </div>
      {drawn ? (
        <div className="access-sunken mt-4">
          {rows.length === 0 ? (
            <div className="p-3 text-[12px]">{t("menus.noUnCe")}</div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
                <XAxis dataKey="date" stroke="#000" fontSize={11} />
                <YAxis yAxisId="left" stroke="#000" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="#000" fontSize={11} />
                <Tooltip />
                <Line yAxisId="left" type="monotone" dataKey="un" name={t("menus.graphUn")} stroke="#0a246a" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="ce" name={t("menus.graphCe")} stroke="#c41212" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : null}
    </AccessHub>
  );
}
