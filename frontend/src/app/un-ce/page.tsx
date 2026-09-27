"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn, AccessHub, AccessPeriod } from "@/components/layout/access-hub";
import { currentEfficiencyEntriesApi, electrolyzersApi, voltageNormalizationsApi, voltageReadingsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";

function avg(vals: number[]): number | undefined {
  if (!vals.length) return undefined;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3));
}

export default function UnCePage() {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [till, setTill] = useState("");
  const [elNr, setElNr] = useState("");
  const [mode, setMode] = useState<"one" | "all" | null>(null);

  const elQuery = useQuery({ queryKey: ["electrolyzers"], queryFn: () => electrolyzersApi.list() });
  const unQuery = useQuery({ queryKey: ["voltage-readings", "unce"], queryFn: () => voltageReadingsApi.list({ limit: 5000 }) });
  const normsQuery = useQuery({
    queryKey: ["voltage-normalizations", "unce"],
    queryFn: () => voltageNormalizationsApi.list({ limit: 2000 }),
  });
  const ceQuery = useQuery({
    queryKey: ["current-efficiency-entries", "unce"],
    queryFn: () => currentEfficiencyEntriesApi.list({ limit: 5000 }),
  });

  const names = (elQuery.data || []).map((e) => e.name || String(e.nr)).filter(Boolean);

  useEffect(() => {
    if (!elNr && names[0]) setElNr(names[0]);
  }, [elNr, names]);

  useEffect(() => {
    if (from || till) return;
    const dates = [
      ...(unQuery.data || []).map((r) => r.date?.slice(0, 10)),
      ...(ceQuery.data || []).map((r) => r.date?.slice(0, 10)),
      ...(normsQuery.data || []).map((r) => r.date?.slice(0, 10)),
    ].filter(Boolean) as string[];
    if (!dates.length) {
      setFrom("2006-06-01");
      setTill("2016-10-04");
      return;
    }
    dates.sort();
    setFrom(dates[0]);
    setTill(dates[dates.length - 1]);
  }, [unQuery.data, ceQuery.data, normsQuery.data, from, till]);

  const rows = useMemo(() => {
    if (!mode) return [];
    const byDate: Record<string, { date: string; unVals: number[]; ceVals: number[] }> = {};

    const take = (day: string | null | undefined, electrolyzer: string | null | undefined) => {
      if (!day) return false;
      if (from && day < from) return false;
      if (till && day > till) return false;
      if (mode === "one" && elNr && electrolyzer !== elNr) return false;
      return true;
    };

    for (const r of normsQuery.data || []) {
      const day = r.date?.slice(0, 10);
      if (!take(day, r.electrolyzer)) continue;
      const u =
        r.total_voltage != null && r.element_count
          ? r.total_voltage / Math.max(r.element_count, 1)
          : null;
      if (u == null) continue;
      const bucket = (byDate[day!] ||= { date: day!, unVals: [], ceVals: [] });
      bucket.unVals.push(u);
    }

    for (const r of unQuery.data || []) {
      const day = r.date?.slice(0, 10);
      if (!take(day, r.electrolyzer)) continue;
      const u = r.standardized_voltage ?? r.voltage;
      if (u == null) continue;
      const bucket = (byDate[day!] ||= { date: day!, unVals: [], ceVals: [] });
      // Prefer electrolyzer norms; still fill gaps from element readings
      if (!normsQuery.data?.length) bucket.unVals.push(u);
    }

    for (const r of ceQuery.data || []) {
      const day = r.date?.slice(0, 10);
      if (!take(day, r.scope_ref)) continue;
      if (r.value_pct == null) continue;
      const bucket = (byDate[day!] ||= { date: day!, unVals: [], ceVals: [] });
      bucket.ceVals.push(r.value_pct);
    }

    return Object.values(byDate)
      .map((b) => ({ date: b.date, un: avg(b.unVals), ce: avg(b.ceVals) }))
      .filter((r) => r.un != null || r.ce != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [mode, unQuery.data, normsQuery.data, ceQuery.data, elNr, from, till]);

  return (
    <AccessHub title={t("mainMenu.unCe")} titleBlue>
      <AccessPeriod from={from} till={till} onFrom={setFrom} onTill={setTill} />
      <div className="flex flex-wrap items-start gap-10">
        <div className="min-w-[200px]">
          <div className="mb-2 text-[12px] font-bold">{t("menus.electrolyzer")}</div>
          <select
            className="access-inset-field mb-3 w-40"
            value={elNr}
            onChange={(e) => {
              setElNr(e.target.value);
              setMode(null);
            }}
          >
            <option value="">—</option>
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <AccessBtn
            className="!w-[140px]"
            onClick={() => setMode("one")}
            disabled={!elNr}
          >
            {t("menus.graph")}
          </AccessBtn>
        </div>
        <div className="min-w-[200px]">
          <div className="mb-2 text-[12px] font-bold">{t("menus.allElectrolyzers")}</div>
          <div className="mb-3 h-[26px]" />
          <AccessBtn className="!w-[140px]" onClick={() => setMode("all")}>
            {t("menus.graph")}
          </AccessBtn>
        </div>
      </div>

      {mode ? (
        <div className="access-sunken mt-4">
          <div className="mb-2 text-[12px] font-bold">
            {mode === "all" ? t("menus.allElectrolyzers") : `${t("menus.electrolyzer")}: ${elNr}`}
          </div>
          {rows.length === 0 ? (
            <div className="p-3 text-[12px]">{t("menus.noUnCe")}</div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
                <XAxis dataKey="date" stroke="#000" fontSize={11} />
                <YAxis
                  yAxisId="left"
                  stroke="#0a246a"
                  fontSize={11}
                  label={{ value: t("menus.graphUn"), angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#c41212"
                  fontSize={11}
                  label={{ value: t("menus.graphCe"), angle: 90, position: "insideRight", style: { fontSize: 11 } }}
                />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="un" name={t("menus.graphUn")} stroke="#0a246a" dot={false} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="ce" name={t("menus.graphCe")} stroke="#c41212" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      ) : null}
    </AccessHub>
  );
}
