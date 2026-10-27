"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatNumber } from "@/lib/utils";

type Pick = { kind: "group"; value: string } | { kind: "company"; value: string; side: "anode" | "cathode" | "total" };

const PALETTE = ["#0f766e", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2", "#4d7c0f", "#be185d"];

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <span className="isb-bar" aria-hidden>
      <i style={{ width: `${max ? Math.max(3, (value / max) * 100) : 0}%`, background: color }} />
    </span>
  );
}

/** Cells running in the plant now: by Group Definition and by coating company; click a row to list its cells. */
export function InServiceBreakdown() {
  const { locale } = useI18n();
  const fa = (f: string, e: string) => (locale === "fa" ? f : e);
  const [pick, setPick] = useState<Pick | null>(null);
  const q = useQuery({
    queryKey: ["element-dashboard", "in-service-breakdown"],
    queryFn: elementDashboardApi.inServiceBreakdown,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const cells = useQuery({
    queryKey: ["element-dashboard", "in-service-cells", pick],
    queryFn: () =>
      elementDashboardApi.inServiceCells(
        pick?.kind === "group" ? { group: pick.value } : { company: pick!.value, side: (pick as { side: string }).side }
      ),
    enabled: !!pick,
  });
  if (q.isLoading) return <div className="isb-note">…</div>;
  if (q.isError || !q.data) return null;
  const { by_group, by_company, total } = q.data;
  const maxGroup = Math.max(1, ...by_group.map((r) => r.cells));
  const maxCompany = Math.max(1, ...by_company.map((r) => r.total));
  const isGroup = (g: string) => pick?.kind === "group" && pick.value === g;
  const isCompany = (c: string, side: string) => pick?.kind === "company" && pick.value === c && pick.side === side;
  const title =
    pick?.kind === "group"
      ? fa(`سل‌های گروه ${pick.value}`, `Cells of group ${pick.value}`)
      : pick
        ? fa(`سل‌های شرکت ${pick.value}`, `Cells of ${pick.value}`) +
          (pick.side === "anode" ? fa(" — آند", " — anode") : pick.side === "cathode" ? fa(" — کاتد", " — cathode") : "")
        : "";

  return (
    <div className="isb-wrap">
      <div className="isb">
        <section className="isb-card">
          <h4>
            <span className="isb-dot" style={{ background: PALETTE[0] }} />
            {fa("سل‌های در مدار بر اساس تعریف گروه", "Cells in the plant by group definition")}
            <b>{formatNumber(total, 0)}</b>
          </h4>
          <div className="isb-scroll">
            <table className="isb-table">
              <thead>
                <tr>
                  <th>{fa("گروه", "Group")}</th>
                  <th>{fa("تعداد سل", "Cells")}</th>
                  <th>{fa("پوشش آند", "Anode coating")}</th>
                  <th>{fa("پوشش کاتد", "Cathode coating")}</th>
                  <th>{fa("ممبران", "Membrane")}</th>
                  <th>{fa("فاصله", "Gap")}</th>
                </tr>
              </thead>
              <tbody>
                {by_group.map((r, i) => (
                  <tr key={r.group} className={cn("isb-row", isGroup(r.group) && "is-on")} onClick={() => setPick(isGroup(r.group) ? null : { kind: "group", value: r.group })}>
                    <td>
                      <span className="isb-chip" style={{ background: PALETTE[i % PALETTE.length] }}>
                        {r.group}
                      </span>
                    </td>
                    <td>
                      <span className="isb-count">
                        <strong>{formatNumber(r.cells, 0)}</strong>
                        <Bar value={r.cells} max={maxGroup} color={PALETTE[i % PALETTE.length]} />
                      </span>
                    </td>
                    <td>{r.anode_coating || "—"}</td>
                    <td>{r.cathode_coating || "—"}</td>
                    <td>{r.membrane_type || "—"}</td>
                    <td>{r.gap_mm || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="isb-card">
          <h4>
            <span className="isb-dot" style={{ background: PALETTE[1] }} />
            {fa("آمار بر اساس شرکت پوشش‌دهنده", "By coating company")}
          </h4>
          <div className="isb-scroll">
            <table className="isb-table">
              <thead>
                <tr>
                  <th>{fa("شرکت", "Company")}</th>
                  <th>{fa("آند", "Anode")}</th>
                  <th>{fa("کاتد", "Cathode")}</th>
                  <th>{fa("جمع", "Total")}</th>
                </tr>
              </thead>
              <tbody>
                {by_company.map((r, i) => (
                  <tr key={r.company} className={cn("isb-row", pick?.kind === "company" && pick.value === r.company && "is-on")}>
                    <td onClick={() => setPick(isCompany(r.company, "total") ? null : { kind: "company", value: r.company, side: "total" })}>
                      <span className="isb-chip" style={{ background: PALETTE[i % PALETTE.length] }}>
                        {r.company}
                      </span>
                    </td>
                    <td className={cn("isb-num", isCompany(r.company, "anode") && "is-cell-on")} onClick={() => setPick(isCompany(r.company, "anode") ? null : { kind: "company", value: r.company, side: "anode" })}>
                      {formatNumber(r.anode, 0)}
                    </td>
                    <td className={cn("isb-num", isCompany(r.company, "cathode") && "is-cell-on")} onClick={() => setPick(isCompany(r.company, "cathode") ? null : { kind: "company", value: r.company, side: "cathode" })}>
                      {formatNumber(r.cathode, 0)}
                    </td>
                    <td onClick={() => setPick(isCompany(r.company, "total") ? null : { kind: "company", value: r.company, side: "total" })}>
                      <span className="isb-count">
                        <strong>{formatNumber(r.total, 0)}</strong>
                        <Bar value={r.total} max={maxCompany} color={PALETTE[i % PALETTE.length]} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {pick ? (
        <section className="isb-card isb-detail">
          <h4>
            {title} <b>{cells.data ? formatNumber(cells.data.length, 0) : "…"}</b>
            <button type="button" className="isb-close" onClick={() => setPick(null)} aria-label={fa("بستن", "Close")}>
              <X size={14} />
            </button>
          </h4>
          {cells.isLoading ? <div className="isb-note">…</div> : null}
          {cells.data ? (
            <div className="isb-scroll isb-scroll-tall">
              <table className="isb-table">
                <thead>
                  <tr>
                    <th>{fa("المنت", "Element")}</th>
                    <th>{fa("الکترولایزر", "Electrolyzer")}</th>
                    <th>{fa("موقعیت", "Position")}</th>
                    <th>{fa("گروه", "Group")}</th>
                    <th>{fa("آند", "Anode")}</th>
                    <th>{fa("کاتد", "Cathode")}</th>
                    <th>{fa("ممبران", "Membrane")}</th>
                    <th>{fa("پوشش آند", "Anode coating")}</th>
                    <th>{fa("پوشش کاتد", "Cathode coating")}</th>
                    <th>{fa("روز در مدار", "DOL")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.data.map((r) => (
                    <tr key={String(r.element_nr)}>
                      <td>{r.element_nr}</td>
                      <td>{r.electrolyzer || "—"}</td>
                      <td>{r.position || "—"}</td>
                      <td>{r.group}</td>
                      <td>{r.anode_nr || "—"}</td>
                      <td>{r.cathode_nr || "—"}</td>
                      <td>{r.membrane_nr || "—"}</td>
                      <td>{r.anode_coating}</td>
                      <td>{r.cathode_coating}</td>
                      <td>{r.dol ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
