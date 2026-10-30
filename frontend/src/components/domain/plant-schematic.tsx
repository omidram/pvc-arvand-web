"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MonitoringCellStatus, MonitoringElectrolyzerBlock } from "@/lib/types";
import { monitoringApi, type CellHealthRow } from "@/lib/endpoints";
import { RACKS, TRAIN_LETTERS, electrolyzerName, trainOf, type TrainId } from "@/lib/plant-topology";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import { MonitoringExport } from "@/components/domain/export-buttons";
import { ElectrolyzerPropertiesPanel } from "@/components/domain/electrolyzer-properties";
import { CellHealthMini } from "@/components/domain/cell-health-chip";
import { secMatch } from "@/lib/sec-formula";

type Focus = "danger" | "warning" | "ok" | null;
type View =
  | { level: "plant" }
  | { level: "train"; train: TrainId }
  | { level: "electrolyzer"; train: TrainId; name: string };

function healthOf(block?: MonitoringElectrolyzerBlock): "ok" | "warning" | "danger" | "offline" {
  if (block?.online === false) return "offline";
  if (block?.cell_count) {
    if (block.danger_count > 0) return "danger";
    if (block.warning_count > 0) return "warning";
    return "ok";
  }
  if (block?.online || block?.current_ka || block?.power_kw) return "ok";
  return "offline";
}

function fmtFixed(value: number | null | undefined, digits: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function powerValue(kw: number | null | undefined): { scale: "mw" | "kw" | "none"; value: string } {
  if (kw == null || Number.isNaN(kw) || kw <= 0) return { scale: "none", value: "—" };
  if (kw >= 1000) return { scale: "mw", value: (kw / 1000).toFixed(2) };
  return { scale: "kw", value: String(Math.round(kw)) };
}

function energyValue(kwh: number | null | undefined): { scale: "gwh" | "mwh" | "none"; value: string } {
  if (kwh == null || Number.isNaN(kwh) || kwh <= 0) return { scale: "none", value: "—" };
  if (kwh >= 1_000_000) return { scale: "gwh", value: (kwh / 1_000_000).toFixed(2) };
  return { scale: "mwh", value: (kwh / 1000).toFixed(1) };
}

function gaugeArc(cx: number, cy: number, r: number, value: number): string {
  const start = -Math.PI * 0.75;
  const sweep = Math.PI * 1.5 * Math.max(0, Math.min(1, value));
  if (sweep <= 0.001) return "";
  const end = start + sweep;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Three rings: match to design, load, cell voltage. The centre is the match percent. */
function StatusGauge({
  match,
  voltage,
  current,
  tone,
}: {
  match: number | null;
  voltage: number | null;
  current: number | null;
  tone: "ok" | "warning" | "danger" | "muted";
}) {
  const toneColor = tone === "ok" ? "#10b981" : tone === "warning" ? "#f59e0b" : tone === "danger" ? "#ef4444" : "#94a3b8";
  const rings = [
    { r: 32, value: match == null ? 0 : match / 100, color: toneColor },
    { r: 25, value: current == null || current <= 0 ? 0 : current / 16, color: "#0891b2" },
    { r: 18, value: voltage == null || voltage <= 0 ? 0 : voltage / 4, color: "#2563eb" },
  ];
  return (
    <svg className="psm-gauge" viewBox="0 0 78 78" aria-hidden>
      {rings.map((ring) => (
        <g key={ring.r}>
          <path className="psm-gauge-track" d={gaugeArc(39, 39, ring.r, 1)} fill="none" stroke="#e2e8f0" strokeWidth="4.5" strokeLinecap="round" />
          <path d={gaugeArc(39, 39, ring.r, ring.value)} fill="none" stroke={ring.color} strokeWidth="4.5" strokeLinecap="round" />
        </g>
      ))}
      <text x="39" y="43" textAnchor="middle">
        {match == null ? "—" : `${Math.round(match)}%`}
      </text>
    </svg>
  );
}

function Metric({
  kind,
  label,
  value,
}: {
  kind: "v" | "i" | "p" | "e";
  label: string;
  value: string;
}) {
  return (
    <span className={`psm-metric psm-chip-${kind}`}>
      <small>{label}</small>
      <b>{value}</b>
    </span>
  );
}

function lastVoltages(block?: MonitoringElectrolyzerBlock) {
  const cells = block?.cells || [];
  const live = cells.filter((cell) => cell.live !== false);
  const source = live.length ? live : cells;
  const volts = source.map((cell) => cell.voltage).filter((value): value is number => value != null);
  return {
    liveCount: live.length,
    lastCount: cells.length,
    stale: live.length === 0 && cells.length > 0,
    avg: volts.length ? volts.reduce((sum, value) => sum + value, 0) / volts.length : null,
    max: volts.length ? Math.max(...volts) : null,
  };
}

function cellMap(block?: MonitoringElectrolyzerBlock): Map<number, MonitoringCellStatus> {
  const map = new Map<number, MonitoringCellStatus>();
  for (const cell of block?.cells || []) {
    const position = Number(cell.position);
    if (Number.isFinite(position)) map.set(position, cell);
  }
  return map;
}

function RackMeter({ cells, focus }: { cells: Map<number, MonitoringCellStatus>; focus: Focus }) {
  return (
    <div className="psm-meters">
      {RACKS.map((rack) => (
        <div key={rack.id} className="psm-meter" title={`Rack ${rack.id}`}>
          {Array.from({ length: rack.end - rack.start + 1 }, (_, index) => {
            const cell = cells.get(rack.start + index);
            const dim = Boolean(focus && cell && cell.severity !== focus);
            const stale = Boolean(cell && cell.live === false);
            return (
              <i
                key={rack.start + index}
                className={`psm-tick is-${cell?.severity || "empty"}${dim ? " is-dim" : ""}${stale ? " is-stale" : ""}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Faceplate({
  name,
  block,
  focus,
  onOpen,
}: {
  name: string;
  block?: MonitoringElectrolyzerBlock;
  focus: Focus;
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const fa = locale === "fa";
  const unit = {
    v: fa ? "ولت" : "Volt",
    ka: fa ? "کیلوآمپر" : "Kiloampere",
    mw: fa ? "مگاوات" : "Megawatt",
    kw: fa ? "کیلووات" : "Kilowatt",
  };
  const health = healthOf(block);
  const letter = name.slice(0, -1);
  const train = name.slice(-1);
  const last = lastVoltages(block);
  const voltage = block?.avg_voltage ?? last.avg;
  const sec = secMatch(voltage, block?.current_ka);
  const power = powerValue(block?.power_kw);
  return (
    <button type="button" className={`psm-face is-${health}`} onClick={onOpen}>
      <div className="psm-face-top">
        <span className="psm-face-name">
          {letter}
          <sub>{train}</sub>
        </span>
        <span className={`psm-lamp is-${health}`} />
      </div>
      <RackMeter cells={cellMap(block)} focus={focus} />
      <div className="psm-face-body">
        <StatusGauge
          match={sec?.matchPct ?? null}
          voltage={voltage}
          current={block?.current_ka ?? null}
          tone={sec?.tone ?? "muted"}
        />
        <div className="psm-face-readout">
          <Metric kind="v" label={unit.v} value={fmtFixed(voltage, 3)} />
          <Metric kind="i" label={unit.ka} value={fmtFixed(block?.current_ka, 1)} />
          <Metric kind="p" label={power.scale === "kw" ? unit.kw : unit.mw} value={power.value} />
        </div>
      </div>
      {sec ? (
        <div
          className={`psm-sec is-${sec.tone}`}
          title={t("monitoring.secMatchHint", {
            actual: fmtFixed(sec.actualSec, 0),
            design: fmtFixed(sec.designSec, 0),
            pct: fmtFixed(sec.matchPct, 0),
          })}
        >
          <span>{t("monitoring.secPair")}</span>
          <b>
            {fmtFixed(voltage, 1)} / {fmtFixed(sec.designVoltage, 1)}
          </b>
          <b>{fmtFixed(sec.matchPct, 0)}%</b>
        </div>
      ) : null}
      <div className="psm-face-alerts">
        {block?.cell_count ? (
          <>
            <span className="psm-chip is-danger">{block.danger_count}</span>
            <span className="psm-chip is-warning">{block.warning_count}</span>
          </>
        ) : last.stale ? (
          <span className="psm-chip psm-chip-muted">{t("monitoring.lastReading")}</span>
        ) : block?.current_ka || block?.power_kw ? (
          <span className="psm-chip psm-chip-muted">{t("monitoring.totalsOnly")}</span>
        ) : (
          <span className="psm-chip psm-chip-muted">{t("monitoring.offline")}</span>
        )}
      </div>
    </button>
  );
}

export function PlantSchematic({
  blocks,
  focus,
  view,
  onView,
  onOpenCell,
  onOpenTotal,
}: {
  blocks: MonitoringElectrolyzerBlock[];
  focus: Focus;
  view: View;
  onView: (view: View) => void;
  onOpenCell: (cell: Pick<MonitoringCellStatus, "electrolyzer" | "position">) => void;
  onOpenTotal: (electrolyzer: string) => void;
}) {
  const { t, locale } = useI18n();
  const fa = locale === "fa";
  const unit = {
    ka: fa ? "کیلوآمپر" : "Kiloampere",
    mw: fa ? "مگاوات" : "Megawatt",
    kw: fa ? "کیلووات" : "Kilowatt",
    mwh: fa ? "مگاوات‌ساعت" : "Megawatt-hour",
    gwh: fa ? "گیگاوات‌ساعت" : "Gigawatt-hour",
  };
  const byName = useMemo(() => {
    const map = new Map<string, MonitoringElectrolyzerBlock>();
    for (const block of blocks) map.set(block.electrolyzer.toUpperCase(), block);
    return map;
  }, [blocks]);

  const trainStats = (train: TrainId) => {
    const names = TRAIN_LETTERS.map((letter) => electrolyzerName(train, letter));
    const present = names.map((name) => byName.get(name)).filter(Boolean) as MonitoringElectrolyzerBlock[];
    return {
      names,
      danger: present.reduce((sum, block) => sum + block.danger_count, 0),
      warning: present.reduce((sum, block) => sum + block.warning_count, 0),
      cells: present.reduce((sum, block) => sum + block.cell_count, 0),
      online: present.filter(
        (block) => block.online !== false && (block.cell_count > 0 || Boolean(block.current_ka) || Boolean(block.power_kw)),
      ).length,
      load: present.reduce((sum, block) => sum + (block.online === false ? 0 : block.current_ka || 0), 0),
      power: present.reduce((sum, block) => sum + (block.online === false ? 0 : block.power_kw || 0), 0),
      energy: present.reduce((sum, block) => sum + (block.online === false ? 0 : block.energy_kwh_24h || 0), 0),
    };
  };

  return (
    <section className="psm">
      <div className="psm-crumb">
        <button type="button" onClick={() => onView({ level: "plant" })}>
          {t("monitoring.plant")}
        </button>
        {view.level !== "plant" ? (
          <>
            <span>/</span>
            <button type="button" onClick={() => onView({ level: "train", train: view.train })}>
              {t(view.train === "1" ? "monitoring.train1" : "monitoring.train2")}
            </button>
          </>
        ) : null}
        {view.level === "electrolyzer" ? (
          <>
            <span>/</span>
            <strong>{view.name}</strong>
          </>
        ) : null}
        <span className="psm-export">
          {view.level === "plant" ? <MonitoringExport scope="plant" filenameBase="monitoring-plant" /> : null}
          {view.level === "train" ? (
            <MonitoringExport scope="train" train={view.train} filenameBase={`monitoring-train-${view.train}`} />
          ) : null}
          {view.level === "electrolyzer" ? (
            <MonitoringExport scope="electrolyzer" electrolyzer={view.name} filenameBase={`monitoring-${view.name}`} />
          ) : null}
        </span>
      </div>

      {view.level === "plant" ? (
        <div className="psm-trains">
          {(["1", "2"] as const).map((train) => {
            const stats = trainStats(train);
            const trainPower = powerValue(stats.power);
            const trainEnergy = energyValue(stats.energy);
            return (
              <article key={train} className="psm-train">
                <header className="psm-train-head">
                  <div>
                    <div className="psm-kicker">{train === "1" ? "081" : "082"}</div>
                    <h3>{t(train === "1" ? "monitoring.train1" : "monitoring.train2")}</h3>
                  </div>
                  <button type="button" className="psm-enter" onClick={() => onView({ level: "train", train })}>
                    {t("monitoring.openTrain")}
                  </button>
                </header>
                <div className="psm-train-stats">
                  <span className="psm-chip psm-chip-muted psm-train-summary">
                    {t("monitoring.trainSummary", {
                      online: stats.online,
                      cells: stats.cells,
                      danger: stats.danger,
                      warning: stats.warning,
                    })}
                  </span>
                  <div className="psm-train-metrics">
                    <Metric kind="i" label={unit.ka} value={stats.load > 0 ? stats.load.toFixed(1) : "—"} />
                    <Metric kind="p" label={trainPower.scale === "kw" ? unit.kw : unit.mw} value={trainPower.value} />
                    <Metric kind="e" label={trainEnergy.scale === "gwh" ? unit.gwh : unit.mwh} value={trainEnergy.value} />
                  </div>
                </div>
                <div className="psm-train-export">
                  <MonitoringExport scope="train" train={train} filenameBase={`monitoring-train-${train}`} />
                </div>
                <div className="psm-elo-grid">
                  {stats.names.map((name) => (
                    <Faceplate
                      key={name}
                      name={name}
                      block={byName.get(name)}
                      focus={focus}
                      onOpen={() => onView({ level: "electrolyzer", train, name })}
                    />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {view.level === "train" ? (
        <article className="psm-train is-open">
          <header className="psm-train-head">
            <div>
              <div className="psm-kicker">{view.train === "1" ? "081" : "082"}</div>
              <h3>{t(view.train === "1" ? "monitoring.train1" : "monitoring.train2")}</h3>
            </div>
            <button type="button" className="psm-enter" onClick={() => onView({ level: "plant" })}>
              {t("monitoring.backPlant")}
            </button>
          </header>
          <div className="psm-train-export">
            <MonitoringExport scope="train" train={view.train} filenameBase={`monitoring-train-${view.train}`} />
          </div>
          <div className="psm-elo-grid is-large">
            {TRAIN_LETTERS.map((letter) => {
              const name = electrolyzerName(view.train, letter);
              return (
                <Faceplate
                  key={name}
                  name={name}
                  block={byName.get(name)}
                  focus={focus}
                  onOpen={() => onView({ level: "electrolyzer", train: view.train, name })}
                />
              );
            })}
          </div>
        </article>
      ) : null}

      {view.level === "electrolyzer" ? (
        <ElectrolyzerMimic
          name={view.name}
          block={byName.get(view.name)}
          focus={focus}
          onOpenCell={onOpenCell}
          onOpenTotal={() => onOpenTotal(view.name)}
          onBack={() => onView({ level: "train", train: view.train })}
        />
      ) : null}
    </section>
  );
}

function ElectrolyzerMimic({
  name,
  block,
  focus,
  onOpenCell,
  onOpenTotal,
  onBack,
}: {
  name: string;
  block?: MonitoringElectrolyzerBlock;
  focus: Focus;
  onOpenCell: (cell: Pick<MonitoringCellStatus, "electrolyzer" | "position">) => void;
  onOpenTotal: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useI18n();
  const fa = locale === "fa";
  const cells = cellMap(block);
  const train = trainOf(name);
  const last = lastVoltages(block);
  const healthQuery = useQuery({
    queryKey: ["monitoring", "cell-health-board", name],
    queryFn: () => monitoringApi.cellHealthBoard({ electrolyzer: name }),
    staleTime: 60_000,
  });
  const healthByPos = useMemo(() => {
    const map = new Map<number, CellHealthRow>();
    for (const row of healthQuery.data?.cells || []) {
      const position = Number(row.position);
      if (Number.isFinite(position)) map.set(position, row);
    }
    return map;
  }, [healthQuery.data]);
  const healthSummary = healthQuery.data?.summary;

  return (
    <article className="psm-elo">
      <header className="psm-elo-head">
        <div>
          <div className="psm-kicker">{train === "1" ? "081" : "082"}</div>
          <h3>
            {name.slice(0, -1)}
            <sub>{name.slice(-1)}</sub>
          </h3>
        </div>
        <div className="psm-elo-actions">
          <button type="button" className="psm-enter" onClick={onOpenTotal}>
            {t("monitoring.electrolyzerHistory")}
          </button>
          <button type="button" className="psm-enter" onClick={onBack}>
            {t("monitoring.backTrain")}
          </button>
        </div>
      </header>
      <div className="psm-flow">
        <span>{t("monitoring.flowRectifier")}</span>
        <i />
        <span>{name}</span>
        <i />
        <span>{t("monitoring.flowCells")}</span>
      </div>
      <div className="psm-racks">
        {RACKS.map((rack) => {
          let live = 0;
          let lastKnown = 0;
          for (let position = rack.start; position <= rack.end; position += 1) {
            const cell = cells.get(position);
            if (!cell) continue;
            if (cell.live === false) lastKnown += 1;
            else live += 1;
          }
          const rackLive = (block?.racks || []).find((item) => item.id === rack.id);
          return (
            <section key={rack.id} className="psm-rack">
              <header>
                <strong>{t(rack.id === "1" ? "monitoring.rack1" : "monitoring.rack2")}</strong>
                <span>
                  {rack.start}–{rack.end}
                  {" · "}
                  {live
                    ? t("monitoring.liveCount", { count: live })
                    : t("monitoring.lastReadingCount", { count: lastKnown })}
                  {rackLive?.power_kw != null ? ` · ${formatNumber(rackLive.power_kw, 0)} ${fa ? "کیلووات" : "Kilowatt"}` : ""}
                  {rackLive?.energy_kwh_24h != null && rackLive.energy_kwh_24h > 0
                    ? ` · ${formatNumber(rackLive.energy_kwh_24h, 0)} ${fa ? "کیلووات‌ساعت" : "Kilowatt-hour"}`
                    : ""}
                </span>
              </header>
              <div className="psm-cells">
                {Array.from({ length: rack.end - rack.start + 1 }, (_, index) => {
                  const position = rack.start + index;
                  const cell = cells.get(position);
                  const health = healthByPos.get(position);
                  const stale = Boolean(cell && cell.live === false);
                  const dim = Boolean(focus && cell && cell.severity !== focus);
                  const healthTitle = health
                    ? `${t("monitoring.healthScore")} ${health.health_score ?? "—"} · ${t(`monitoring.healthStatus.${health.status}`)}${health.reasons[0] ? ` · ${health.reasons[0]}` : ""}`
                    : undefined;
                  return (
                    <button
                      key={position}
                      type="button"
                      className={`psm-cell is-${cell?.severity || "empty"}${dim ? " is-dim" : ""}${stale ? " is-stale" : ""}${health ? ` has-health is-h-${health.status}` : ""}`}
                      title={
                        cell
                          ? `${name}-${String(position).padStart(3, "0")}  ${cell.voltage != null ? `${Number(cell.voltage).toFixed(3)} V` : ""}${stale ? ` · ${t("monitoring.lastReading")}` : ""}${healthTitle ? ` · ${healthTitle}` : ""}`
                          : `${name}-${String(position).padStart(3, "0")} · ${t("monitoring.openHistory")}`
                      }
                      onClick={() => onOpenCell({ electrolyzer: name, position: String(position) })}
                    >
                      <em>{position}</em>
                      <b>{cell?.voltage != null ? Number(cell.voltage).toFixed(2) : ""}</b>
                      {health ? (
                        <CellHealthMini score={health.health_score} status={health.status} title={healthTitle} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="psm-elo-stats psm-elo-stats-below">
        <span className="psm-elo-stat">
          <small>{last.stale ? t("monitoring.lastReading") : t("monitoring.liveCells")}</small>
          <b>{last.stale ? last.lastCount : (block?.cell_count ?? 0)}</b>
        </span>
        <span className="psm-elo-stat">
          <small>{t("monitoring.avgV")}</small>
          <b>{formatNumber(block?.avg_voltage ?? last.avg, 3)}</b>
        </span>
        <span className="psm-elo-stat">
          <small>{t("monitoring.maxV")}</small>
          <b>{formatNumber(block?.max_voltage ?? last.max, 3)}</b>
        </span>
        <span className="psm-elo-stat is-load">
          <small>{t("monitoring.loadKa")}</small>
          <b>{formatNumber(block?.current_ka, 2)}</b>
        </span>
        <span className="psm-elo-stat is-power">
          <small>{t("monitoring.powerKw")}</small>
          <b>{formatNumber(block?.power_kw, 0)}</b>
        </span>
        <span className="psm-elo-stat is-energy">
          <small>{t("monitoring.energyKwh24h")}</small>
          <b>{formatNumber(block?.energy_kwh_24h, 0)}</b>
        </span>
        <span className="psm-count is-danger">{block?.danger_count ?? 0}</span>
        <span className="psm-count is-warning">{block?.warning_count ?? 0}</span>
        <span className="psm-count is-ok">{block?.ok_count ?? 0}</span>
        {healthSummary ? (
          <span className="psm-elo-health-legend" title={t("monitoring.healthTitle")}>
            <span className="ch-count-pill is-ok" title={t("monitoring.healthOk")}>
              {healthSummary.ok}
            </span>
            <span className="ch-count-pill is-watch" title={t("monitoring.healthWatch")}>
              {healthSummary.watch}
            </span>
            <span className="ch-count-pill is-investigate" title={t("monitoring.healthInvestigate")}>
              {healthSummary.investigate}
            </span>
            <span className="ch-count-pill is-critical" title={t("monitoring.healthCritical")}>
              {healthSummary.critical}
            </span>
          </span>
        ) : null}
      </div>
      <div className="psm-train-export">
        <MonitoringExport scope="electrolyzer" electrolyzer={name} filenameBase={`monitoring-${name}`} />
      </div>
      <ElectrolyzerPropertiesPanel name={name} />
    </article>
  );
}
