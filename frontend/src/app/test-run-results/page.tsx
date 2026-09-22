"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { performanceTestsApi, settingsApi } from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { PerformanceTest } from "@/lib/types";
import { AccessHub } from "@/components/layout/access-hub";
import { useAuth } from "@/lib/auth/context";

export default function TestRunResultsPage() {
  const { canEdit } = useAuth();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const { listQuery, createMutation, updateMutation } = useCrudResource<PerformanceTest>(
    "performance-tests",
    performanceTestsApi,
    { limit: 500 }
  );
  const [active, setActive] = useState<number | "new" | null>(null);
  const rows = listQuery.data || [];
  const s = settingsQuery.data;

  function save(row: PerformanceTest, patch: Partial<PerformanceTest>) {
    if (!canEdit("voltage")) return;
    updateMutation.mutate({ id: row.id, payload: { ...row, ...patch } });
  }

  return (
    <AccessHub title="Performance Test Results" titleBlue>
      <div className="access-plant-bar">
        <span>{s?.customer || "PVC Arvand"}</span>
        <span>{s?.plant_type === "KOH" ? "KOH Electrolysis" : "NaCl Electrolysis"}</span>
        <span>{s?.uan || "03-3039"}</span>
      </div>
      <table className="access-cont-table">
        <thead>
          <tr>
            <th className="w-4" />
            <th className="w-40">Date</th>
            <th>Part of Plant</th>
            <th className="w-28">CE [%]</th>
            <th className="w-40">SPC [kWh/t NaOH]</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => setActive(row.id)}>
              <td className="access-selector">{active === row.id ? "►" : ""}</td>
              <td>
                <input
                  type="date"
                  value={row.date?.slice(0, 10) || ""}
                  onChange={(e) => save(row, { date: e.target.value || null })}
                  disabled={!canEdit("voltage")}
                />
              </td>
              <td>
                <input
                  className="w-full"
                  value={row.plant_part || ""}
                  onChange={(e) => save(row, { plant_part: e.target.value })}
                  disabled={!canEdit("voltage")}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  className="w-24"
                  value={row.ce_pct ?? ""}
                  onChange={(e) => save(row, { ce_pct: e.target.value === "" ? null : Number(e.target.value) })}
                  disabled={!canEdit("voltage")}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  className="w-28"
                  value={row.spc_kwh ?? ""}
                  onChange={(e) => save(row, { spc_kwh: e.target.value === "" ? null : Number(e.target.value) })}
                  disabled={!canEdit("voltage")}
                />
              </td>
            </tr>
          ))}
          {canEdit("voltage") ? (
            <tr onClick={() => setActive("new")}>
              <td className="access-selector">*</td>
              <td>
                <input
                  type="date"
                  onBlur={(e) => {
                    if (e.target.value) createMutation.mutate({ date: e.target.value } as never);
                  }}
                />
              </td>
              <td>
                <input className="w-full" />
              </td>
              <td>
                <input className="w-24" />
              </td>
              <td>
                <input className="w-28" />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </AccessHub>
  );
}
