"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Grid3x3, Layers, RefreshCw, Zap } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { CellSlot, CellStatus, CellsOverview } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Chips, DashKpi, ExportButton, StageBadge } from "./element-dashboard-ui";

const RACKS = [
  { id: 1, start: 1, end: 84 },
  { id: 2, start: 85, end: 168 },
];

function statusKey(slot: CellSlot | undefined): "empty" | CellStatus {
  return slot ? slot.status : "empty";
}

/** What is installed in every cell of every train, and where an element is entered twice. */
export function ElementCellsTab({ initialTrain }: { initialTrain?: string }) {
  const { t } = useI18n();
  const [train, setTrain] = useState<string>(initialTrain ?? "1");
  const [electrolyzer, setElectrolyzer] = useState<string>("");
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [filter, setFilter] = useState<"all" | "problems" | "ok">("all");
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["element-dashboard", "cells"], queryFn: () => elementDashboardApi.cells(false) });
  const data: CellsOverview | undefined = query.data;

  const byCell = useMemo(() => {
    const map = new Map<string, CellSlot>();
    for (const c of data?.cells ?? []) map.set(`${c.electrolyzer}|${c.position}`, c);
    return map;
  }, [data]);

  const trainRows = data?.trains.find((x) => x.train === train)?.electrolyzers ?? [];
  const activeEl = electrolyzer && trainRows.some((r) => r.electrolyzer === electrolyzer) ? electrolyzer : trainRows[0]?.electrolyzer ?? "";

  const listRows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.cells.filter((c) => {
      if (train !== "all" && !c.electrolyzer.endsWith(train)) return false;
      if (filter === "problems" && c.status === "ok") return false;
      if (filter === "ok" && c.status !== "ok") return false;
      if (!needle) return true;
      return (
        `${c.electrolyzer}-${c.position}`.toLowerCase().includes(needle) ||
        c.elements.some((e) => [e.element_nr, e.anode_nr, e.cathode_nr, e.membrane_nr].some((v) => (v ?? "").toLowerCase().includes(needle)))
      );
    });
  }, [data, train, filter, search]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;

  const s = data.summary;
  const slot = selected != null ? byCell.get(`${activeEl}|${selected}`) : undefined;
  const problemCells = data.cells.filter((c) => c.status !== "ok");

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elDash.cells.help")}</p>
      <div className="mon-kpi-row">
        <DashKpi label={t("elDash.cells.occupied")} value={formatNumber(s.occupied_cells, 0)} hint={t("elDash.inst.capacity", { cap: s.capacity })} icon={Layers} tone="info" />
        <DashKpi label={t("elDash.cells.empty")} value={formatNumber(s.empty_cells, 0)} icon={Grid3x3} tone="neutral" />
        <DashKpi label={t("elDash.cells.conflict")} value={formatNumber(s.conflict_cells, 0)} hint={t("elDash.cells.conflictHint")} icon={Copy} tone={s.conflict_cells ? "danger" : "ok"} />
        <DashKpi label={t("elDash.cells.multi")} value={formatNumber(s.multi_cell_elements, 0)} hint={t("elDash.cells.multiHint")} icon={Copy} tone={s.multi_cell_elements ? "danger" : "ok"} />
        <DashKpi label={t("elDash.cells.unplaced")} value={formatNumber(s.unplaced + s.out_of_range, 0)} hint={t("elDash.cells.unplacedHint")} icon={Zap} tone={s.unplaced + s.out_of_range ? "warning" : "ok"} />
      </div>

      {s.problems === 0 ? (
        <section className="ed-note">
          <strong>{t("elDash.cells.allClear")}</strong>
        </section>
      ) : (
        <section className="ed-note is-danger">
          <strong>{t("elDash.cells.problemsTitle", { count: s.problems })}</strong>
          {problemCells.slice(0, 40).map((c) => (
            <p key={`${c.electrolyzer}-${c.position}`} className="mt-1">
              <button
                type="button"
                className="cl-link"
                onClick={() => {
                  setTrain(c.electrolyzer.slice(-1));
                  setElectrolyzer(c.electrolyzer);
                  setSelected(c.position);
                  setView("map");
                }}
              >
                {c.electrolyzer}-{c.position}
              </button>{" "}
              <span className={cn("ed-badge", c.status === "conflict" ? "ed-tone-red" : "ed-tone-amber")}>{t(`elDash.cells.status.${c.status}`)}</span>{" "}
              {c.elements.map((e) => `${e.element_nr} (${t(`elDash.stage.${e.state}`)})`).join(" · ")}
            </p>
          ))}
          {data.multi_cell.slice(0, 40).map((m) => (
            <p key={m.element_nr} className="mt-1">
              <strong>{t("elDash.cells.elementIn", { nr: m.element_nr })}</strong> {m.cells.join(" · ")}
            </p>
          ))}
        </section>
      )}

      <div className="ed-filters">
        <Chips
          value={train}
          onChange={(k) => {
            setTrain(k);
            setElectrolyzer("");
            setSelected(null);
          }}
          options={[
            { key: "1", label: t("elDash.cells.train", { n: 1 }) },
            { key: "2", label: t("elDash.cells.train", { n: 2 }) },
            ...(view === "list" ? [{ key: "all", label: t("elDash.filter.all") }] : []),
          ]}
        />
        <Chips
          value={view}
          onChange={setView}
          options={[
            { key: "map", label: t("elDash.cells.viewMap") },
            { key: "list", label: t("elDash.cells.viewList") },
          ]}
        />
        <Button type="button" variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} />
          {t("elDash.refresh")}
        </Button>
      </div>

      {view === "map" ? (
        <>
          <section className="mon-panel">
            <h3 className="mon-panel-title">{t("elDash.cells.perElectrolyzer", { n: train })}</h3>
            <div className="ed-table-wrap">
              <table className="ed-table">
                <thead>
                  <tr>
                    <th>{t("elDash.col.electrolyzer")}</th>
                    <th>{t("elDash.cells.occupied")}</th>
                    <th>{t("elDash.inst.fill")}</th>
                    <th>{t("elDash.cells.empty")}</th>
                    <th>{t("elDash.cells.conflict")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trainRows.map((r) => (
                    <tr
                      key={r.electrolyzer}
                      className={activeEl === r.electrolyzer ? "is-selected" : undefined}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setElectrolyzer(r.electrolyzer);
                        setSelected(null);
                      }}
                    >
                      <td>
                        <strong>{r.electrolyzer}</strong>
                      </td>
                      <td className="ed-num">
                        {r.occupied} / {r.capacity}
                      </td>
                      <td>
                        <div className="ed-bar-cell">
                          <div className="ed-life-bar">
                            <div className="ed-life-fill" style={{ width: `${Math.min(100, (r.occupied * 100) / r.capacity)}%`, background: "#2563eb" }} />
                          </div>
                          <span className="ed-num">{formatNumber((r.occupied * 100) / r.capacity, 0)}%</span>
                        </div>
                      </td>
                      <td className="ed-num">{r.empty}</td>
                      <td className={cn("ed-num", r.conflict && "cl-bad")}>{r.conflict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mon-panel">
            <h3 className="mon-panel-title">{t("elDash.cells.mapTitle", { name: activeEl })}</h3>
            <div className="cl-legend">
              <span className="cl-key is-ok">{t("elDash.cells.status.ok")}</span>
              <span className="cl-key is-conflict">{t("elDash.cells.status.conflict")}</span>
              <span className="cl-key is-stale">{t("elDash.cells.status.stale")}</span>
              <span className="cl-key is-empty">{t("elDash.cells.status.empty")}</span>
            </div>
            {RACKS.map((rack) => (
              <div key={rack.id} className="cl-rack">
                <div className="cl-rack-title">
                  {t("elDash.cells.rack", { n: rack.id })} · {rack.start}–{rack.end}
                </div>
                <div className="cl-grid" dir="ltr">
                  {Array.from({ length: rack.end - rack.start + 1 }, (_, i) => rack.start + i).map((pos) => {
                    const cell = byCell.get(`${activeEl}|${pos}`);
                    const key = statusKey(cell);
                    const first = cell?.elements[0];
                    return (
                      <button
                        key={pos}
                        type="button"
                        className={cn("cl-tile", `is-${key}`, selected === pos && "is-selected")}
                        onClick={() => setSelected(selected === pos ? null : pos)}
                        title={cell ? cell.elements.map((e) => `${e.element_nr} · ${t(`elDash.stage.${e.state}`)}`).join("\n") : t("elDash.cells.status.empty")}
                      >
                        <span className="cl-pos">{pos}</span>
                        <span className="cl-el">{first ? first.element_nr : "·"}</span>
                        {cell && cell.elements.length > 1 ? <span className="cl-more">+{cell.elements.length - 1}</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {selected != null ? (
              <div className="cl-detail">
                <h4>
                  {t("elDash.cells.cellTitle", { cell: `${activeEl}-${selected}` })}{" "}
                  <span className={cn("ed-badge", `ed-tone-${slot ? (slot.status === "ok" ? "green" : slot.status === "conflict" ? "red" : "amber") : "slate"}`)}>
                    {t(`elDash.cells.status.${statusKey(slot)}`)}
                  </span>
                </h4>
                {!slot ? (
                  <p className="mon-sub">{t("elDash.cells.emptyCell")}</p>
                ) : (
                  <div className="ed-table-wrap">
                    <table className="ed-table">
                      <thead>
                        <tr>
                          <th>{t("elDash.col.element")}</th>
                          <th>{t("elDash.col.stage")}</th>
                          <th>{t("elDash.col.group")}</th>
                          <th>{t("elDash.col.anode")}</th>
                          <th>{t("elDash.col.cathode")}</th>
                          <th>{t("elDash.col.membrane")}</th>
                          <th>{t("elDash.col.commissioned")}</th>
                          <th>{t("elDash.col.dol")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slot.elements.map((e) => (
                          <tr key={e.element_nr}>
                            <td>
                              <strong>{e.element_nr}</strong>
                            </td>
                            <td>
                              <StageBadge stage={e.state} />
                            </td>
                            <td>{e.group_nr || "—"}</td>
                            <td>{e.anode_nr || "—"}</td>
                            <td>{e.cathode_nr || "—"}</td>
                            <td>{e.membrane_nr || "—"}</td>
                            <td>{formatDate(e.commissioning_date)}</td>
                            <td className="ed-num">{e.dol ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="mon-panel">
          <h3 className="mon-panel-title">{t("elDash.cells.listTitle")}</h3>
          <div className="ed-filters mb-2">
            <Chips
              value={filter}
              onChange={setFilter}
              options={[
                { key: "all", label: t("elDash.filter.all") },
                { key: "problems", label: t("elDash.cells.onlyProblems"), count: problemCells.length },
                { key: "ok", label: t("elDash.cells.status.ok") },
              ]}
            />
            <label>
              {t("elDash.search")}
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("elDash.cells.searchHint")} />
            </label>
            <span className="mon-sub">{t("elDash.matched", { count: listRows.length })}</span>
            <ExportButton
              filename="cells-installed-elements"
              disabled={!listRows.length}
              header={[t("elDash.cells.train", { n: "" }), t("elDash.col.electrolyzer"), t("elDash.col.cell"), t("elDash.cells.statusCol"), t("elDash.col.element"), t("elDash.col.stage"), t("elDash.col.group"), t("elDash.col.anode"), t("elDash.col.cathode"), t("elDash.col.membrane"), t("elDash.col.commissioned"), t("elDash.col.dol")]}
              rows={() =>
                listRows.flatMap((c) =>
                  c.elements.map((e) => [c.electrolyzer.slice(-1), c.electrolyzer, c.position, t(`elDash.cells.status.${c.status}`), e.element_nr, t(`elDash.stage.${e.state}`), e.group_nr, e.anode_nr, e.cathode_nr, e.membrane_nr, e.commissioning_date, e.dol])
                )
              }
            />
          </div>
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th>{t("elDash.cells.trainCol")}</th>
                  <th>{t("elDash.col.electrolyzer")}</th>
                  <th>{t("elDash.col.cell")}</th>
                  <th>{t("elDash.cells.statusCol")}</th>
                  <th>{t("elDash.col.element")}</th>
                  <th>{t("elDash.col.anode")}</th>
                  <th>{t("elDash.col.cathode")}</th>
                  <th>{t("elDash.col.membrane")}</th>
                  <th>{t("elDash.col.dol")}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.slice(0, 900).map((c) => (
                  <tr key={`${c.electrolyzer}-${c.position}`} className={c.status === "conflict" ? "cl-row-bad" : c.status === "stale" ? "cl-row-warn" : undefined}>
                    <td>{c.electrolyzer.slice(-1)}</td>
                    <td>
                      <strong>{c.electrolyzer}</strong>
                    </td>
                    <td className="ed-num">{c.position}</td>
                    <td>
                      <span className={cn("ed-badge", c.status === "ok" ? "ed-tone-green" : c.status === "conflict" ? "ed-tone-red" : "ed-tone-amber")}>{t(`elDash.cells.status.${c.status}`)}</span>
                    </td>
                    <td>
                      {c.elements.map((e) => (
                        <div key={e.element_nr}>
                          <strong>{e.element_nr}</strong> {c.elements.length > 1 ? <StageBadge stage={e.state} /> : null}
                        </div>
                      ))}
                    </td>
                    <td>{c.elements.map((e) => <div key={e.element_nr}>{e.anode_nr || "—"}</div>)}</td>
                    <td>{c.elements.map((e) => <div key={e.element_nr}>{e.cathode_nr || "—"}</div>)}</td>
                    <td>{c.elements.map((e) => <div key={e.element_nr}>{e.membrane_nr || "—"}</div>)}</td>
                    <td className="ed-num">{c.elements.map((e) => <div key={e.element_nr}>{e.dol ?? "—"}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {listRows.length > 900 ? <p className="mon-sub">{t("elDash.truncated", { count: 900 })}</p> : null}
        </section>
      )}
    </div>
  );
}
