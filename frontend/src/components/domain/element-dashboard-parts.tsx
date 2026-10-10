"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Flame, Layers, ShieldAlert, Timer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { elementDashboardApi } from "@/lib/endpoints";
import type { DashPart } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { Chips, DashKpi, Days, LifeBadge, LifeBar } from "./element-dashboard-ui";

type Kind = "anode" | "cathode" | "membrane";

export function PartsTable({ rows, kind, showReasons }: { rows: DashPart[]; kind: Kind; showReasons?: boolean }) {
  const { t } = useI18n();
  const electrode = kind !== "membrane";
  return (
    <div className="ed-table-wrap">
      <table className="ed-table">
        <thead>
          <tr>
            <th>{t(`elDash.col.${kind}`)}</th>
            <th>{t("elDash.col.where")}</th>
            <th>{t("elDash.col.commissioned")}</th>
            <th>{t("elDash.col.dol")}</th>
            {electrode ? <th>{t("elDash.col.totalDol")}</th> : null}
            <th>{t("elDash.col.life")}</th>
            <th>{t("elDash.col.status")}</th>
            <th>{t("elDash.col.daysLeft")}</th>
            {electrode ? (
              <>
                <th>{t("elDash.col.recoats")}</th>
                <th>{t("elDash.col.lastCoating")}</th>
                <th>{t("elDash.col.residual")}</th>
              </>
            ) : (
              <th>{t("elDash.col.type")}</th>
            )}
            {showReasons ? <th>{t("elDash.col.reasons")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.key}`}>
              <td>
                <strong>{r.serial}</strong>
              </td>
              <td>
                {r.installed ? (
                  <span>
                    {t("elDash.onElement", { nr: r.element_nr ?? "—" })}
                    {r.electrolyzer ? ` · ${r.electrolyzer}-${r.position ?? ""}` : ""}
                  </span>
                ) : r.at_coater ? (
                  <span className="ed-badge ed-tone-blue">{t("elDash.atCoater")}</span>
                ) : (
                  <span className="ed-mute">{t(`elDash.bucket.${r.bucket}`)}</span>
                )}
              </td>
              <td>{formatDate(r.commissioning_date)}</td>
              <td>
                <Days value={electrode ? r.coating_dol : r.total_dol} />
              </td>
              {electrode ? (
                <td>
                  <Days value={r.total_dol} />
                </td>
              ) : null}
              <td>
                <LifeBar pct={r.life_pct} status={r.life_status} />
              </td>
              <td>
                <LifeBadge status={r.life_status} />
              </td>
              <td className="ed-num">{r.life_left == null ? "—" : formatNumber(r.life_left, 0)}</td>
              {electrode ? (
                <>
                  <td className="ed-num">{r.recoat_count ?? 0}</td>
                  <td>{formatDate(r.last_coating_return)}</td>
                  <td className="ed-num">{r.residual_thickness == null ? "—" : formatNumber(r.residual_thickness, 1)}</td>
                </>
              ) : (
                <td>{r.membrane_type || "—"}</td>
              )}
              {showReasons ? (
                <td>
                  <div className="ed-chips">
                    {(r.reasons ?? []).map((reason) => (
                      <span key={reason} className="ed-badge ed-tone-amber">
                        {t(`elDash.reason.${reason}`)}
                      </span>
                    ))}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ElementPartsTab({ initial }: { initial?: { kind?: Kind; life?: string; where?: string } }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "anode");
  const [where, setWhere] = useState(initial?.where ?? "all");
  const [life, setLife] = useState(initial?.life ?? "alert");
  const [minDol, setMinDol] = useState("");
  const [maxDol, setMaxDol] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["element-dashboard", "parts", kind, where, life, minDol, maxDol, search],
    queryFn: () =>
      elementDashboardApi.parts({
        kind,
        where,
        life,
        min_dol: minDol === "" ? undefined : Number(minDol),
        max_dol: maxDol === "" ? undefined : Number(maxDol),
        q: search.trim() || undefined,
        limit: 1500,
      }),
  });
  const data = query.data;
  const s = data?.summary;

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.partsHelp")}</p>
      <Chips
        value={kind}
        onChange={setKind}
        options={[
          { key: "anode", label: t("elDash.kind.anode") },
          { key: "cathode", label: t("elDash.kind.cathode") },
          { key: "membrane", label: t("elDash.kind.membrane") },
        ]}
      />

      {s ? (
        <div className="mon-kpi-row">
          <DashKpi label={t("elDash.parts.total")} value={formatNumber(s.total, 0)} icon={Boxes} tone="info" onClick={() => { setWhere("all"); setLife("all"); }} />
          <DashKpi label={t("elDash.parts.installed")} value={formatNumber(s.installed, 0)} hint={t("elDash.parts.inService", { count: s.in_service })} icon={Layers} tone="info" active={where === "installed" && life === "all"} onClick={() => { setWhere("installed"); setLife("all"); }} />
          <DashKpi label={t("elDash.parts.warning")} value={formatNumber(s.warning, 0)} hint={t("elDash.parts.ofWhichInstalled", { count: s.installed_warning })} icon={Timer} tone="warning" active={life === "warning"} onClick={() => setLife("warning")} />
          <DashKpi label={t("elDash.parts.expired")} value={formatNumber(s.expired, 0)} hint={t("elDash.parts.ofWhichInstalled", { count: s.installed_expired })} icon={Flame} tone="danger" active={life === "expired"} onClick={() => setLife("expired")} />
          <DashKpi label={t("elDash.parts.needAttention")} value={formatNumber(s.warning + s.expired, 0)} icon={ShieldAlert} tone="warning" active={life === "alert"} onClick={() => setLife("alert")} />
        </div>
      ) : null}

      <div className="ed-grid-2">
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.parts.histogram")}</h3>
          <div className="ed-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.histogram ?? []} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="installed" name={t("elDash.installed")} stackId="a" fill="#2563eb" />
                <Bar dataKey="warehouse" name={t("elDash.notInstalled")} stackId="a" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.parts.limitTitle")}</h3>
          <p className="mon-sub">
            {t("elDash.parts.limitLine", { days: data?.limit_days ?? "—", warn: data?.warn_percent ?? "—" })}
          </p>
          <p className="mon-sub">{kind === "membrane" ? t("elDash.parts.basisMembrane") : t("elDash.parts.basisElectrode")}</p>
        </section>
      </div>

      <div className="ed-filters">
        <label>
          {t("elDash.filter.where")}
          <select value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="all">{t("elDash.filter.all")}</option>
            <option value="installed">{t("elDash.installed")}</option>
            <option value="warehouse">{t("elDash.notInstalled")}</option>
          </select>
        </label>
        <label>
          {t("elDash.filter.life")}
          <select value={life} onChange={(e) => setLife(e.target.value)}>
            <option value="all">{t("elDash.filter.all")}</option>
            <option value="alert">{t("elDash.life.alert")}</option>
            <option value="ok">{t("elDash.life.ok")}</option>
            <option value="warning">{t("elDash.life.warning")}</option>
            <option value="expired">{t("elDash.life.expired")}</option>
          </select>
        </label>
        <label>
          {t("elDash.filter.minDol")}
          <input type="number" min={0} value={minDol} onChange={(e) => setMinDol(e.target.value)} style={{ width: "7rem" }} />
        </label>
        <label>
          {t("elDash.filter.maxDol")}
          <input type="number" min={0} value={maxDol} onChange={(e) => setMaxDol(e.target.value)} style={{ width: "7rem" }} />
        </label>
        <label>
          {t("elDash.search")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("elDash.searchPartsHint")} />
        </label>
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : !data?.items.length ? (
        <div className="mon-empty">{t("elDash.noParts")}</div>
      ) : (
        <>
          <p className="mon-sub">{t("elDash.matched", { count: data.matched })}</p>
          <PartsTable rows={data.items} kind={kind} />
          {data.truncated ? <p className="mon-sub">{t("elDash.truncated", { count: data.items.length })}</p> : null}
        </>
      )}
    </div>
  );
}
