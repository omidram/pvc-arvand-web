"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Copy, Layers, Zap } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { InstalledPart } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { DashKpi, ExportButton, LifeBadge, StageBadge } from "./element-dashboard-ui";

function PartCell({ part }: { part: InstalledPart }) {
  if (!part.serial) return <span className="ed-badge ed-tone-red">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{part.serial}</span>
      {part.life_status === "warning" || part.life_status === "expired" ? <LifeBadge status={part.life_status} /> : null}
    </span>
  );
}

export function ElementInstalledTab() {
  const { t } = useI18n();
  const [electrolyzer, setElectrolyzer] = useState("all");
  const [search, setSearch] = useState("");
  const [onlyAlert, setOnlyAlert] = useState(false);
  const query = useQuery({ queryKey: ["element-dashboard", "installed"], queryFn: elementDashboardApi.installed });
  const data = query.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.elements.filter((e) => {
      if (electrolyzer !== "all" && e.electrolyzer !== electrolyzer) return false;
      if (onlyAlert && ![e.anode, e.cathode, e.membrane].some((p) => p.life_status === "warning" || p.life_status === "expired")) return false;
      if (!needle) return true;
      return [e.element_nr, e.anode.serial, e.cathode.serial, e.membrane.serial, e.group_nr, e.position]
        .some((v) => (v ?? "").toString().toLowerCase().includes(needle));
    });
  }, [data, electrolyzer, search, onlyAlert]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;
  const s = data.summary;
  const dupTotal = s.duplicates.anode + s.duplicates.cathode + s.duplicates.membrane;
  const missingTotal = s.missing.anode + s.missing.cathode + s.missing.membrane;

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.installedHelp")}</p>
      <div className="mon-kpi-row">
        <DashKpi label={t("elDash.inst.cells")} value={formatNumber(s.cells, 0)} hint={t("elDash.inst.capacity", { cap: s.capacity })} icon={Layers} tone="info" />
        <DashKpi label={t("elDash.inst.inService")} value={formatNumber(s.in_service, 0)} icon={Zap} tone="ok" />
        <DashKpi label={t("elDash.kind.anode")} value={formatNumber(s.anodes, 0)} hint={t("elDash.inst.missing", { count: s.missing.anode })} icon={Layers} tone="info" />
        <DashKpi label={t("elDash.kind.cathode")} value={formatNumber(s.cathodes, 0)} hint={t("elDash.inst.missing", { count: s.missing.cathode })} icon={Layers} tone="info" />
        <DashKpi label={t("elDash.kind.membrane")} value={formatNumber(s.membranes, 0)} hint={t("elDash.inst.missing", { count: s.missing.membrane })} icon={Layers} tone="info" />
        <DashKpi label={t("elDash.inst.duplicates")} value={formatNumber(dupTotal, 0)} hint={t("elDash.inst.duplicatesHint")} icon={Copy} tone={dupTotal ? "danger" : "ok"} />
        <DashKpi label={t("elDash.inst.missingTotal")} value={formatNumber(missingTotal, 0)} icon={CircleAlert} tone={missingTotal ? "warning" : "ok"} />
      </div>

      {dupTotal ? (
        <section className="ed-note is-danger">
          <strong>{t("elDash.inst.duplicatesTitle")}</strong>
          {(["anode", "cathode", "membrane"] as const).map((k) =>
            data.duplicates[k].length ? (
              <p key={k} className="mt-1">
                {t(`elDash.kind.${k}`)}: {data.duplicates[k].join(" · ")}
              </p>
            ) : null
          )}
        </section>
      ) : null}

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t("elDash.inst.byElectrolyzer")}</h3>
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th>{t("elDash.col.electrolyzer")}</th>
                <th>{t("elDash.inst.cells")}</th>
                <th>{t("elDash.inst.fill")}</th>
                <th>{t("elDash.kind.anode")}</th>
                <th>{t("elDash.kind.cathode")}</th>
                <th>{t("elDash.kind.membrane")}</th>
              </tr>
            </thead>
            <tbody>
              {data.by_electrolyzer.map((row) => (
                <tr key={row.electrolyzer} className={electrolyzer === row.electrolyzer ? "is-selected" : undefined} onClick={() => setElectrolyzer(electrolyzer === row.electrolyzer ? "all" : row.electrolyzer)} style={{ cursor: "pointer" }}>
                  <td>
                    <strong>{row.electrolyzer}</strong>
                  </td>
                  <td className="ed-num">
                    {row.cells} / {row.capacity}
                  </td>
                  <td>
                    <div className="ed-bar-cell">
                      <div className="ed-life-bar">
                        <div className="ed-life-fill" style={{ width: `${Math.min(100, (row.cells * 100) / row.capacity)}%`, background: "#2563eb" }} />
                      </div>
                      <span className="ed-num">{formatNumber((row.cells * 100) / row.capacity, 0)}%</span>
                    </div>
                  </td>
                  <td className="ed-num">{row.anodes}</td>
                  <td className="ed-num">{row.cathodes}</td>
                  <td className="ed-num">{row.membranes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mon-panel">
        <h3 className="mon-panel-title">{t("elDash.inst.onWhichElement")}</h3>
        <div className="ed-filters mb-2">
          <label>
            {t("elDash.col.electrolyzer")}
            <select value={electrolyzer} onChange={(e) => setElectrolyzer(e.target.value)}>
              <option value="all">{t("elDash.filter.all")}</option>
              {data.by_electrolyzer.map((r) => (
                <option key={r.electrolyzer} value={r.electrolyzer}>
                  {r.electrolyzer}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("elDash.search")}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("elDash.searchInstalledHint")} />
          </label>
          <label className="flex-row items-center gap-1">
            <input type="checkbox" checked={onlyAlert} onChange={(e) => setOnlyAlert(e.target.checked)} />
            {t("elDash.inst.onlyAlert")}
          </label>
          <span className="mon-sub">{t("elDash.matched", { count: rows.length })}</span>
          <ExportButton
            filename="installed-parts"
            disabled={!rows.length}
            header={[t("elDash.col.element"), t("elDash.col.stage"), t("elDash.col.electrolyzer"), t("elDash.col.cell"), t("elDash.col.group"), t("elDash.col.anode"), t("elDash.col.cathode"), t("elDash.col.membrane"), t("elDash.col.commissioned"), t("elDash.col.dol")]}
            rows={() => rows.map((e) => [e.element_nr, t(`elDash.stage.${e.state}`), e.electrolyzer, e.position, e.group_nr, e.anode.serial, e.cathode.serial, e.membrane.serial, e.commissioning_date, e.dol])}
          />
        </div>
        <div className="ed-table-wrap">
          <table className="ed-table">
            <thead>
              <tr>
                <th>{t("elDash.col.element")}</th>
                <th>{t("elDash.col.stage")}</th>
                <th>{t("elDash.col.cell")}</th>
                <th>{t("elDash.col.group")}</th>
                <th>{t("elDash.col.anode")}</th>
                <th>{t("elDash.col.cathode")}</th>
                <th>{t("elDash.col.membrane")}</th>
                <th>{t("elDash.col.commissioned")}</th>
                <th>{t("elDash.col.dol")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 800).map((e) => (
                <tr key={e.element_nr}>
                  <td>
                    <strong>{e.element_nr}</strong>
                  </td>
                  <td>
                    <StageBadge stage={e.state} />
                  </td>
                  <td>{e.electrolyzer ? `${e.electrolyzer}-${e.position ?? ""}` : "—"}</td>
                  <td>{e.group_nr || "—"}</td>
                  <td>
                    <PartCell part={e.anode} />
                  </td>
                  <td>
                    <PartCell part={e.cathode} />
                  </td>
                  <td>
                    <PartCell part={e.membrane} />
                  </td>
                  <td>{formatDate(e.commissioning_date)}</td>
                  <td className="ed-num">{e.dol ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 800 ? <p className="mon-sub">{t("elDash.truncated", { count: 800 })}</p> : null}
      </section>
    </div>
  );
}
