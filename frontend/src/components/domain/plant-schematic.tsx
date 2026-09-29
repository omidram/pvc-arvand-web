"use client";

import { useMemo } from "react";
import type { MonitoringCellStatus, MonitoringElectrolyzerBlock } from "@/lib/types";
import { RACKS, TRAIN_LETTERS, electrolyzerName, trainOf, type TrainId } from "@/lib/plant-topology";
import { useI18n } from "@/lib/i18n/context";
import { formatNumber } from "@/lib/utils";
import { MonitoringExport } from "@/components/domain/export-buttons";

type Focus = "danger" | "warning" | "ok" | null;
type View =
  | { level: "plant" }
  | { level: "train"; train: TrainId }
  | { level: "electrolyzer"; train: TrainId; name: string };

function healthOf(block?: MonitoringElectrolyzerBlock): "ok" | "warning" | "danger" | "offline" {
  if (!block?.cell_count) return "offline";
  if (block.danger_count > 0) return "danger";
  if (block.warning_count > 0) return "warning";
  return "ok";
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
            return <i key={rack.start + index} className={`psm-tick is-${cell?.severity || "empty"}${dim ? " is-dim" : ""}`} />;
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
  const { t } = useI18n();
  const health = healthOf(block);
  const letter = name.slice(0, -1);
  const train = name.slice(-1);
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
      <div className="psm-face-meta">
        {block?.cell_count ? (
          <>
            <span>{formatNumber(block.avg_voltage, 3)} V</span>
            <span className="is-danger">{block.danger_count}</span>
            <span className="is-warning">{block.warning_count}</span>
          </>
        ) : (
          <span>{t("monitoring.offline")}</span>
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
  onOpenCell: (cell: MonitoringCellStatus) => void;
  onOpenTotal: (electrolyzer: string) => void;
}) {
  const { t } = useI18n();
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
      online: present.filter((block) => block.cell_count > 0).length,
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
                <p className="psm-train-sub">
                  {t("monitoring.trainSummary", {
                    online: stats.online,
                    cells: stats.cells,
                    danger: stats.danger,
                    warning: stats.warning,
                  })}
                </p>
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
  onOpenCell: (cell: MonitoringCellStatus) => void;
  onOpenTotal: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const cells = cellMap(block);
  const train = trainOf(name);
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
        <div className="psm-elo-stats">
          <span>
            {t("monitoring.liveCells")} <strong>{block?.cell_count ?? 0}</strong>
          </span>
          <span>
            {t("monitoring.avgV")} <strong>{formatNumber(block?.avg_voltage, 3)}</strong>
          </span>
          <span>
            {t("monitoring.maxV")} <strong>{formatNumber(block?.max_voltage, 3)}</strong>
          </span>
          <span className="psm-count is-danger">{block?.danger_count ?? 0}</span>
          <span className="psm-count is-warning">{block?.warning_count ?? 0}</span>
          <span className="psm-count is-ok">{block?.ok_count ?? 0}</span>
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
      <div className="psm-train-export">
        <MonitoringExport scope="electrolyzer" electrolyzer={name} filenameBase={`monitoring-${name}`} />
      </div>
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
          for (let position = rack.start; position <= rack.end; position += 1) {
            if (cells.get(position)) live += 1;
          }
          return (
            <section key={rack.id} className="psm-rack">
              <header>
                <strong>{t(rack.id === "1" ? "monitoring.rack1" : "monitoring.rack2")}</strong>
                <span>
                  {rack.start}–{rack.end}
                  {" · "}
                  {t("monitoring.liveCount", { count: live })}
                </span>
              </header>
              <div className="psm-cells">
                {Array.from({ length: rack.end - rack.start + 1 }, (_, index) => {
                  const position = rack.start + index;
                  const cell = cells.get(position);
                  const dim = Boolean(focus && cell && cell.severity !== focus);
                  return (
                    <button
                      key={position}
                      type="button"
                      className={`psm-cell is-${cell?.severity || "empty"}${dim ? " is-dim" : ""}`}
                      disabled={!cell}
                      title={
                        cell
                          ? `${name}-${String(position).padStart(3, "0")}  ${cell.voltage != null ? `${Number(cell.voltage).toFixed(3)} V` : ""}`
                          : String(position)
                      }
                      onClick={() => cell && onOpenCell(cell)}
                    >
                      <em>{position}</em>
                      <b>{cell?.voltage != null ? Number(cell.voltage).toFixed(2) : ""}</b>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </article>
  );
}
