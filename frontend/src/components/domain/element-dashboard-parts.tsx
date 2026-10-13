"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Boxes, CalendarClock, Flame, Layers, ShieldAlert, Timer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { elementDashboardApi } from "@/lib/endpoints";
import type { DashPart } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatNumber } from "@/lib/utils";
import { Chips, DashKpi, Days, ExportButton, LifeBadge, LifeBar } from "./element-dashboard-ui";

type Kind = "anode" | "cathode" | "membrane";

type SortKey = "serial" | "where" | "commissioned" | "dol" | "total" | "life" | "left" | "recoats" | "coating";

function sortValue(r: DashPart, key: SortKey, electrode: boolean): string | number | null {
  switch (key) {
    case "serial":
      return r.serial;
    case "where":
      return r.installed ? `0-${r.element_nr ?? ""}` : r.at_coater ? "1" : `2-${r.bucket}`;
    case "commissioned":
      return r.commissioning_date;
    case "dol":
      return electrode ? r.coating_dol : r.total_dol;
    case "total":
      return r.total_dol;
    case "life":
      return r.life_pct;
    case "left":
      return r.life_left;
    case "recoats":
      return r.recoat_count ?? 0;
    case "coating":
      return r.last_coating_return ?? null;
  }
}

export function partsCsv(rows: DashPart[], kind: Kind, t: (key: string, vars?: Record<string, string | number>) => string) {
  const electrode = kind !== "membrane";
  const header = [
    t(`elDash.col.${kind}`),
    t("elDash.col.element"),
    t("elDash.col.electrolyzer"),
    t("elDash.col.where"),
    t("elDash.col.commissioned"),
    electrode ? t("elDash.col.dolCoating") : t("elDash.col.dol"),
    t("elDash.col.totalDol"),
    t("elDash.col.life"),
    t("elDash.col.status"),
    t("elDash.col.daysLeft"),
    electrode ? t("elDash.col.recoats") : t("elDash.col.type"),
    ...(electrode ? [t("elDash.col.lastCoating"), t("elDash.col.residual")] : []),
  ];
  const body = rows.map((r) => [
    r.serial,
    r.element_nr ?? "",
    r.electrolyzer ?? "",
    r.installed ? t("elDash.installed") : r.at_coater ? t("elDash.atCoater") : t(`elDash.bucket.${r.bucket}`),
    r.commissioning_date ?? "",
    (electrode ? r.coating_dol : r.total_dol) ?? "",
    r.total_dol ?? "",
    r.life_pct ?? "",
    t(`elDash.life.${r.life_status}`),
    r.life_left ?? "",
    electrode ? (r.recoat_count ?? 0) : (r.membrane_type ?? ""),
    ...(electrode ? [r.last_coating_return ?? "", r.residual_thickness ?? ""] : []),
  ]);
  return { header, body };
}

export function PartsTable({ rows, kind, showReasons }: { rows: DashPart[]; kind: Kind; showReasons?: boolean }) {
  const { t } = useI18n();
  const electrode = kind !== "membrane";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const shown = sort
    ? [...rows].sort((a, b) => {
        const x = sortValue(a, sort.key, electrode);
        const y = sortValue(b, sort.key, electrode);
        if (x == null && y == null) return 0;
        if (x == null) return 1; // empty values always last
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      })
    : rows;
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort?.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="ed-sort" onClick={() => setSort(sort?.key === key ? (sort.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 })}>
        {label}
        {sort?.key === key ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  );
  return (
    <div className="ed-table-wrap">
      <table className="ed-table">
        <thead>
          <tr>
            {th("serial", t(`elDash.col.${kind}`))}
            {th("where", t("elDash.col.where"))}
            {th("commissioned", t("elDash.col.commissioned"))}
            {th("dol", electrode ? t("elDash.col.dolCoating") : t("elDash.col.dol"))}
            {electrode ? th("total", t("elDash.col.totalDol")) : null}
            {th("life", t("elDash.col.life"))}
            <th>{t("elDash.col.status")}</th>
            {th("left", t("elDash.col.daysLeft"))}
            {electrode ? (
              <>
                {th("recoats", t("elDash.col.recoats"))}
                {th("coating", t("elDash.col.lastCoating"))}
                <th>{t("elDash.col.residual")}</th>
              </>
            ) : (
              <th>{t("elDash.col.type")}</th>
            )}
            {showReasons ? <th>{t("elDash.col.reasons")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
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

export function ElementPartsTab({ initial }: { initial?: { kind?: Kind; life?: string; where?: string; due?: string } }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "anode");
  const [where, setWhere] = useState(initial?.where ?? "all");
  const [life, setLife] = useState(initial?.life ?? "alert");
  const [minDol, setMinDol] = useState("");
  const [maxDol, setMaxDol] = useState("");
  const [due, setDue] = useState(initial?.due ?? "");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["element-dashboard", "parts", kind, where, life, minDol, maxDol, due, search],
    queryFn: () =>
      elementDashboardApi.parts({
        kind,
        where,
        life,
        min_dol: minDol === "" ? undefined : Number(minDol),
        max_dol: maxDol === "" ? undefined : Number(maxDol),
        due_within: due === "" ? undefined : Number(due),
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
          <DashKpi
            label={t("elDash.parts.due90")}
            value={formatNumber(s.due_90, 0)}
            hint={t("elDash.parts.dueHint", { d30: s.due_30, d180: s.due_180 })}
            icon={CalendarClock}
            tone={s.due_90 ? "warning" : "ok"}
            active={due === "90"}
            onClick={() => {
              setWhere("installed");
              setLife("all");
              setDue("90");
            }}
          />
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
          {t("elDash.filter.due")}
          <select value={due} onChange={(e) => setDue(e.target.value)}>
            <option value="">{t("elDash.filter.all")}</option>
            <option value="30">{t("elDash.filter.dueDays", { days: 30 })}</option>
            <option value="90">{t("elDash.filter.dueDays", { days: 90 })}</option>
            <option value="180">{t("elDash.filter.dueDays", { days: 180 })}</option>
            <option value="365">{t("elDash.filter.dueDays", { days: 365 })}</option>
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
          <div className="ed-actionbar">
            <span className="mon-sub">{t("elDash.matched", { count: data.matched })}</span>
            <ExportButton
              filename={`${kind}-life`}
              header={partsCsv(data.items, kind, t).header}
              rows={() => partsCsv(data.items, kind, t).body}
            />
          </div>
          <PartsTable rows={data.items} kind={kind} />
          {data.truncated ? <p className="mon-sub">{t("elDash.truncated", { count: data.items.length })}</p> : null}
        </>
      )}
    </div>
  );
}
