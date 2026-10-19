"use client";

import type { ElementStage } from "@/lib/types";
import type { LifePick } from "@/components/domain/assembly-lifecycle";
import { cn, formatNumber } from "@/lib/utils";

type T = (path: string) => string;

const COMPANIES = ["Ancan", "Denora", "Atiyeh Pardazan", "Sharif", "Saman Payesh", "……….."];

/** Boxes that filter the Assembly Data sheet. */
const PICK: Partial<Record<string, LifePick>> = {
  service: "in_service",
  decommission: "decommissioned",
  disassembly: "awaiting_disassembly",
  rateoff: "disassembled",
  newCode: "assembled",
  assign: "installed",
};

function Box({
  id,
  label,
  sub,
  count,
  picked,
  onPick,
  tone,
}: {
  id: string;
  label: string;
  sub?: string;
  count?: number;
  picked: LifePick | null;
  onPick?: (stage: LifePick | null) => void;
  tone?: "service" | "warehouse";
}) {
  const stage = PICK[id];
  const active = stage != null && picked === stage;
  const Tag = stage && onPick ? "button" : "div";
  return (
    <Tag
      type={Tag === "button" ? "button" : undefined}
      className={cn("ewc-box", tone === "service" && "is-service", tone === "warehouse" && "is-warehouse", active && "is-picked", stage && "is-pick")}
      onClick={stage && onPick ? () => onPick(active ? null : stage) : undefined}
    >
      {count != null ? <span className="ewc-n">{formatNumber(count, 0)}</span> : null}
      <span>{label}</span>
      {sub ? <span className="ewc-sub">{sub}</span> : null}
    </Tag>
  );
}

function Arrow({ dir = "right" }: { dir?: "right" | "left" | "down" }) {
  const mark = dir === "left" ? "←" : dir === "down" ? "↓" : "→";
  return <span className={cn("ewc-arrow", dir === "down" && "is-down")} aria-hidden>{mark}</span>;
}

function Companies() {
  return (
    <div className="ewc-companies">
      {COMPANIES.map((name) => (
        <span key={name}>{name}</span>
      ))}
    </div>
  );
}

/** The element life from the workflow chart: in service, cell shop, disassembly, recoating and warehouse. */
export function ElementWorkflowChart({
  t,
  picked,
  onPick,
  counts,
}: {
  t: T;
  picked: LifePick | null;
  onPick: (stage: LifePick | null) => void;
  counts?: Partial<Record<ElementStage | "assembled", number>>;
}) {
  const n = (key: ElementStage | "assembled") => (counts ? counts[key] ?? 0 : undefined);
  const box = (id: string, label: string, extra?: { sub?: string; count?: number; tone?: "service" | "warehouse" }) => (
    <Box id={id} label={label} sub={extra?.sub} count={extra?.count} picked={picked} onPick={onPick} tone={extra?.tone} />
  );

  return (
    <section className="ewc">
      <div className="ewc-head">
        <strong>{t("ewChart.title")}</strong>
        <span>{t("ewChart.help")}</span>
      </div>
      <div className="ewc-board" dir="ltr">
        <div className="ewc-row">
          {box("assign", t("ewChart.assign"), { count: n("installed") })}
          <Arrow dir="left" />
          {box("keep", t("ewChart.keep"))}
          <Arrow dir="left" />
          {box("healthy", t("ewChart.healthy"))}
          <span className="ewc-gap" />
          {box("coatGood", t("ewChart.coatGood"))}
          <Arrow />
          {box("newCode", t("ewChart.newCode"), { count: n("assembled") })}
        </div>

        <div className="ewc-row ewc-join">
          <Arrow dir="down" />
          <span />
          <Arrow dir="down" />
          <span />
          <span />
          <span />
          <span />
          <Arrow dir="down" />
        </div>

        <div className="ewc-row">
          {box("balance", t("ewChart.balance"))}
          <Arrow dir="left" />
          {box("service", t("ewChart.service"), { sub: t("ewChart.active"), count: n("in_service"), tone: "service" })}
          <Arrow />
          {box("decommission", t("ewChart.decommission"), { sub: t("ewChart.operator"), count: n("decommissioned") })}
          <Arrow />
          {box("disassembly", t("ewChart.disassembly"), { count: n("awaiting_disassembly") })}
          <Arrow />
          {box("split", t("ewChart.split"))}
        </div>

        <div className="ewc-row ewc-join">
          <span />
          <span />
          <span />
          <span />
          <Arrow dir="down" />
          <span />
          <span />
          <span />
          <Arrow dir="down" />
        </div>

        <div className="ewc-row ewc-split-row">
          {box("rateoff", t("ewChart.rateoff"), { count: n("disassembled") })}
          <div className="ewc-fork">
            {box("reuse", t("ewChart.reuse"))}
            {box("coat", t("ewChart.coat"))}
            {box("notReuse", t("ewChart.notReuse"))}
          </div>
        </div>

        <div className="ewc-problems">
          <div className="ewc-problem">
            {box("coating", t("ewChart.coating"))}
            <div className="ewc-pair">
              <div>
                {box("warrantyC", t("ewChart.warranty"))}
                <Companies />
              </div>
              <div>
                {box("plainC", t("ewChart.noWarranty"))}
                <Arrow dir="down" />
              </div>
            </div>
          </div>

          {box("warehouse", t("ewChart.warehouse"), { tone: "warehouse" })}

          <div className="ewc-problem">
            {box("mechanical", t("ewChart.mechanical"))}
            <div className="ewc-pair">
              <div>
                {box("plainM", t("ewChart.noWarranty"))}
                <Arrow dir="down" />
              </div>
              <div>
                {box("warrantyM", t("ewChart.warranty"))}
                <Companies />
              </div>
            </div>
          </div>
        </div>
        <p className="ewc-note">{t("ewChart.warehouseNote")}</p>
      </div>
    </section>
  );
}
