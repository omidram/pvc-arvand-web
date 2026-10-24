"use client";

import type { ElementStage } from "@/lib/types";
import type { LifePick } from "@/components/domain/assembly-lifecycle";
import { cn, formatNumber } from "@/lib/utils";

type T = (path: string) => string;

type Tone = "green" | "red" | "amber" | "slate" | "blue" | "violet" | "teal";

export type PiecePick = "good" | "medium" | "rateOff" | "coating" | "mechanical";

function Step({
  id,
  label,
  role,
  count,
  tone,
  picked,
  onPick,
}: {
  id: LifePick;
  label: string;
  role?: string;
  count?: number;
  tone: Tone;
  picked: LifePick | null;
  onPick: (stage: LifePick | null) => void;
}) {
  const on = picked === id;
  return (
    <button type="button" className={cn("ewc-step", `is-${tone}`, on && "is-on")} onClick={() => onPick(on ? null : id)}>
      <strong>{count == null ? "…" : formatNumber(count, 0)}</strong>
      <span>{label}</span>
      {role ? <em>{role}</em> : null}
    </button>
  );
}

function Join() {
  return <span className="ewc-join" aria-hidden />;
}

/** Assembly Data operations only: the dates and decisions that change an element row. */
export function ElementWorkflowChart({
  t,
  picked,
  onPick,
  counts,
  waiting,
  pieces,
  piece,
  onPiece,
}: {
  t: T;
  picked: LifePick | null;
  onPick: (stage: LifePick | null) => void;
  counts?: Partial<Record<ElementStage | "assembled", number>>;
  waiting?: { anode: number; cathode: number } | null;
  pieces?: { good: number; medium: number; rateOff: number; coating: number; mechanical: number } | null;
  piece?: PiecePick | null;
  onPiece?: (piece: PiecePick | null) => void;
}) {
  const n = (key: ElementStage | "assembled") => {
    if (key === "awaiting_assembly" && waiting) return waiting.anode + waiting.cathode;
    return counts ? counts[key] ?? 0 : undefined;
  };
  const step = (id: LifePick, label: string, tone: Tone, role?: string) => (
    <Step id={id} label={label} role={role} count={n(id)} tone={tone} picked={picked} onPick={onPick} />
  );
  const pieceStep = (id: PiecePick, label: string, tone: Tone, count: number) => (
    <button
      type="button"
      className={cn("ewc-step", `is-${tone}`, piece === id && "is-on")}
      onClick={() => onPiece?.(piece === id ? null : id)}
    >
      <strong>{formatNumber(count, 0)}</strong>
      <span>{label}</span>
    </button>
  );

  return (
    <section className="ewc">
      <div className="ewc-head">
        <strong>{t("ewChart.title")}</strong>
        <span>{t("ewChart.help")}</span>
      </div>

      <div className="ewc-track">
        <h4>{t("ewChart.laneRun")}</h4>
        <div className="ewc-line">
          {step("in_service", t("ewChart.service"), "green", t("ewChart.roleCell"))}
          <Join />
          {step("decommissioned", t("ewChart.decommission"), "red", t("ewChart.roleOperator"))}
          <Join />
          <div className="ewc-fork">
            <div className="ewc-branch">
              <span className="ewc-branch-name">{t("ewChart.healthy")}</span>
              {step("installed", t("ewChart.assign"), "blue", t("ewChart.roleOperator"))}
            </div>
            <div className="ewc-branch">
              <span className="ewc-branch-name">{t("ewChart.broken")}</span>
              {step("awaiting_disassembly", t("ewChart.disassembly"), "amber", t("ewChart.roleC90"))}
              <Join />
              {step("disassembled", t("ewChart.rateoff"), "slate", t("ewChart.roleC90"))}
            </div>
          </div>
        </div>
      </div>

      <div className="ewc-track">
        <h4>{t("ewChart.laneBuild")}</h4>
        <div className="ewc-line">
          {step(
            "awaiting_assembly",
            t("ewChart.waitAsm"),
            "violet",
            waiting ? `${waiting.anode} A · ${waiting.cathode} K` : t("ewChart.roleShop"),
          )}
          <Join />
          {step("assembling", t("ewChart.assembling"), "blue", t("ewChart.roleShop"))}
          <Join />
          {step("awaiting_qc", t("ewChart.qc"), "amber", t("ewChart.roleShop"))}
          <Join />
          {step("ready", t("ewChart.ready"), "teal", t("ewChart.roleShop"))}
          <Join />
          {step("assembled", t("ewChart.newCode"), "violet", t("ewChart.roleShop"))}
          <Join />
          <span className="ewc-back">{t("ewChart.backToService")}</span>
        </div>
      </div>

      {pieces ? (
        <div className="ewc-track">
          <h4>{t("ewChart.lanePieces")}</h4>
          <div className="ewc-line">
            {pieceStep("good", t("ewChart.reusableGood"), "green", pieces.good)}
            {pieceStep("medium", t("ewChart.reusableMedium"), "teal", pieces.medium)}
            {pieceStep("rateOff", t("ewChart.pieceRateOff"), "slate", pieces.rateOff)}
            {pieceStep("coating", t("ewChart.pieceCoating"), "amber", pieces.coating)}
            {pieceStep("mechanical", t("ewChart.pieceMechanical"), "violet", pieces.mechanical)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
