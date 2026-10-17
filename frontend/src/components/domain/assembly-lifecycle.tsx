"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { Element, ElementStage, PipelineItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useI18n } from "@/lib/i18n/context";
import { todayIsoLocal } from "@/lib/date-range";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { STAGE_TONE } from "./element-dashboard-ui";
import { DecommissionActions, isHealthyKept, isShutdownDecision } from "./element-flow-actions";
import { ElementCellRequest } from "./cell-request";
import { useAuth } from "@/lib/auth/context";
import Link from "next/link";

/** A running element. Disassembly ends it (rate off); it is not assembled again under the same number. */
export const SERVICE_LIFE: ElementStage[] = ["in_service", "decommissioned", "awaiting_disassembly", "disassembled"];

/** A new element, built from inspected parts. This track does not continue a dismantled element. */
export const BUILD_LIFE: ElementStage[] = ["awaiting_assembly", "assembling", "awaiting_qc", "ready", "installed"];

export const LIFE_CYCLE: ElementStage[] = [...SERVICE_LIFE, ...BUILD_LIFE];

const NEXT: Partial<Record<ElementStage, ElementStage>> = {
  awaiting_disassembly: "disassembled",
  awaiting_assembly: "assembling",
  assembling: "awaiting_qc",
  awaiting_qc: "ready",
};

function trackOf(stage: ElementStage): ElementStage[] {
  return BUILD_LIFE.includes(stage) ? BUILD_LIFE : SERVICE_LIFE;
}

type LifeDateKey = "assembly_date" | "commissioning_date" | "decommissioning_date" | "disassembly_date";
const DATE_OF: Partial<Record<ElementStage, LifeDateKey>> = {
  installed: "assembly_date",
  in_service: "commissioning_date",
  decommissioned: "decommissioning_date",
  disassembled: "disassembly_date",
};

const squeeze = (s: string) => s.replace(/[\s\-_/.]/g, "").toUpperCase();

type OpenRecord = (elementNr: string, rowId: number | null) => void;

export type LifePick = ElementStage | "assembled";

function useCounts() {
  return useQuery({
    queryKey: ["element-dashboard", "shop", "counts"],
    queryFn: () => elementDashboardApi.shop({ state: "shop", limit: 1 }),
    staleTime: 30_000,
  });
}

/** "Where are the elements?" for Assembly Data. Picking a step filters the sheet underneath. */
export function AssemblyLifecycleStrip({ picked, onPick }: { picked: LifePick | null; onPick: (stage: LifePick | null) => void }) {
  const { t } = useI18n();
  const counts = useCounts().data?.counts;

  return (
    <section className="asm-flow">
      <div className="asm-flow-head">
        <strong>{t("elDash.pipelineTitle")}</strong>
        <span className="asm-flow-help">{t("asmFlow.help")}</span>
      </div>
      <div className="asm-flow-line">
        {SERVICE_LIFE.map((stage, i) => (
          <Fragment key={stage}>
            {i > 0 ? <ArrowRight className="asm-flow-arrow" aria-hidden /> : null}
            <button
              type="button"
              title={t(`asmFlow.what.${stage}`)}
              className={cn("asm-flow-step", `ed-tone-${STAGE_TONE[stage]}`, picked === stage && "is-picked", counts && !counts[stage] && "is-zero")}
              onClick={() => onPick(picked === stage ? null : stage)}
            >
              <span className="asm-flow-n">{counts ? formatNumber(counts[stage], 0) : "…"}</span>
              <span className="asm-flow-label">{t(`elDash.stage.${stage}`)}</span>
            </button>
          </Fragment>
        ))}
      </div>
      <p className="asm-flow-help">{t("asmFlow.buildTitle")}</p>
      <div className="asm-flow-line">
        <button
          type="button"
          title={t("asmFlow.what.assembled")}
          className={cn("asm-flow-step", "ed-tone-ready", picked === "assembled" && "is-picked", counts && !counts.assembled && "is-zero")}
          onClick={() => onPick(picked === "assembled" ? null : "assembled")}
        >
          <span className="asm-flow-n">{counts ? formatNumber(counts.assembled ?? 0, 0) : "…"}</span>
          <span className="asm-flow-label">{t("elDash.flow.assembled")}</span>
        </button>
      </div>
    </section>
  );
}

function DismantledParts({ row }: { row: Element }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["element-dashboard", "parts-now", row.id, row.anode_nr, row.cathode_nr, row.membrane_nr],
    queryFn: () =>
      elementDashboardApi.partsNow({
        anode_nr: row.anode_nr,
        cathode_nr: row.cathode_nr,
        membrane_nr: row.membrane_nr,
        element_id: row.id,
      }),
    enabled: Boolean(row.disassembly_date),
  });
  if (!row.disassembly_date) return null;
  const parts = query.data?.parts || [];

  function whereOf(part: (typeof parts)[number]) {
    if (part.place === "element") {
      const cell = [part.electrolyzer, part.position].filter(Boolean).join("-");
      return [part.element_nr, cell].filter(Boolean).join(" · ") || t("asmFlow.notMounted");
    }
    if (part.company) return part.company;
    return t("asmFlow.notMounted");
  }

  function statusOf(part: (typeof parts)[number]) {
    const known = t(`asmFlow.partStatus.${part.status}`);
    if (known !== `asmFlow.partStatus.${part.status}`) return known;
    const stage = t(`wf.status.${part.status}`);
    if (stage !== `wf.status.${part.status}`) return stage;
    return part.note || part.status;
  }

  return (
    <div className="asm-parts">
      <p className="ew-role">{t("asmFlow.roles.inspection")}</p>
      <p>{t("asmFlow.rateoff")}</p>
      <strong className="asm-parts-title">{t("asmFlow.partsTitle")}</strong>
      {query.isLoading ? <p className="asm-mute">…</p> : null}
      {!query.isLoading && !parts.length ? <p className="asm-mute">{t("asmFlow.empty")}</p> : null}
      {parts.length ? (
        <table className="asm-parts-table">
          <thead>
            <tr>
              <th>{t("asmFlow.part")}</th>
              <th>{t("wh.col.serial")}</th>
              <th>{t("asmFlow.where")}</th>
              <th>{t("asmFlow.partStatusTitle")}</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <tr key={`${part.kind}-${part.serial}`}>
                <td>{t(`elDash.col.${part.kind}`)}</td>
                <td>
                  <Link className="asm-link" href={`/${part.kind}s?${part.kind}_nr=${encodeURIComponent(part.serial)}`}>
                    {part.serial}
                  </Link>
                </td>
                <td>{whereOf(part)}</td>
                <td>
                  {statusOf(part)}
                  {part.place === "inspection" && part.note ? ` — ${part.note}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/** The open Assembly Data record: where this element is in its life and the one next step. */
export function ElementLifecycleCard({ row, editable, onOpen }: { row: Element; editable: boolean; onOpen: OpenRecord }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const c90 = canEdit("wf_c90");
  const cellshop = canEdit("wf_cellshop");
  const qc = useQueryClient();
  const nr = String(row.element_nr ?? "").trim();
  const [open, setOpen] = useState(true);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayIsoLocal());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const query = useQuery({
    queryKey: ["element-dashboard", "shop", "one", squeeze(nr)],
    queryFn: async () => {
      const res = await elementDashboardApi.shop({ state: "all", element_nr: nr, limit: 5 });
      return res.items[0] ?? null;
    },
    enabled: Boolean(nr),
  });
  const item = query.data;

  const advance = useMutation({
    mutationFn: (it: PipelineItem) =>
      elementDashboardApi.advance({ element_nr: it.element_nr, note: note.trim() || null, date: NEXT[it.state] === "disassembled" ? day : null }),
    onSuccess: (res) => {
      setMessage({ ok: true, text: t("elDash.cartable.done", { nr: res.element_nr, stage: t(`elDash.stage.${res.stage}`) }) });
      setNote("");
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
      if (res.stage === "disassembled") void qc.invalidateQueries({ queryKey: ["elements"] });
    },
    onError: (err: Error & { response?: { data?: { detail?: string } } }) => setMessage({ ok: false, text: err.response?.data?.detail || err.message }),
  });

  if (!nr) return null;
  if (query.isLoading) return <div className="asm-card asm-mute">…</div>;
  if (!item) return null;

  const older = item.row_id != null && row.id != null && Number(item.row_id) !== Number(row.id);
  const fresh = Boolean(item.assembly_date) && ["assembling", "awaiting_qc", "ready", "installed"].includes(item.state);
  const steps = fresh ? [] : trackOf(item.state);
  const at = steps.indexOf(item.state);
  const next = NEXT[item.state];
  const nextRole = next === "disassembled" ? c90 : cellshop;

  return (
    <section className="asm-card">
      <button type="button" className="asm-card-head" onClick={() => setOpen((v) => !v)}>
        <strong>{t("asmFlow.cardTitle", { nr: item.element_nr })}</strong>
        <span className={cn("ed-badge", `ed-tone-${STAGE_TONE[item.state]}`)}>{t(`elDash.stage.${item.state}`)}</span>
        {item.since ? <span className="asm-mute">{t("elDash.cartable.since", { date: formatDate(item.since), days: item.days_in_state ?? "—" })}</span> : null}
        {open ? <ChevronUp className="ms-auto h-4 w-4" /> : <ChevronDown className="ms-auto h-4 w-4" />}
      </button>

      {open ? (
        <>
          {older ? (
            <p className="asm-note">
              {t("asmFlow.older")}{" "}
              <button type="button" className="asm-link" onClick={() => onOpen(item.element_nr, item.row_id)}>
                {t("asmFlow.openLatest")}
              </button>
            </p>
          ) : null}

          <ol className="asm-steps">
            {fresh ? (
              <li className="asm-step is-now ed-tone-ready">
                <span className="asm-dot">1</span>
                <span className="asm-step-label">{t("elDash.flow.assembled")}</span>
                {item.assembly_date ? <span className="asm-step-date">{formatDate(String(item.assembly_date))}</span> : null}
              </li>
            ) : null}
            {steps.map((stage, i) => {
              const dateKey = DATE_OF[stage];
              const recorded = older
                ? (dateKey ? row[dateKey] : null)
                : i > at
                  ? null
                  : item.stage_dates?.[stage] || (dateKey ? item[dateKey] : null) || (i === at ? item.since : null);
              const when = recorded ? String(recorded).trim() || null : null;
              return (
                <li key={stage} className={cn("asm-step", i < at && "is-done", i === at && `is-now ed-tone-${STAGE_TONE[stage]}`)}>
                  <span className="asm-dot">{i < at ? "✓" : i + 1}</span>
                  <span className="asm-step-label">{t(`elDash.stage.${stage}`)}</span>
                  {when ? <span className="asm-step-date">{formatDate(when)}</span> : null}
                </li>
              );
            })}
          </ol>

          <div className="asm-next">
            <span className="asm-next-title">{t("asmFlow.nextTitle")}</span>
            <span>{t(`asmFlow.next.${item.state}`)}</span>
          </div>

          {!older ? <ElementCellRequest item={item} /> : null}

          {!older && (isShutdownDecision(item) || isHealthyKept(item)) ? (
            <DecommissionActions item={item} editable={canEdit("wf_operation")} note={note} onNote={setNote} onMessage={setMessage} />
          ) : null}

          {(item.state === "disassembled" || row.disassembly_date) ? (
            <DismantledParts row={row} />
          ) : null}

          {editable && next && nextRole && !older ? (
            <div className="asm-actions">
              {next === "disassembled" ? (
                <label className="ed-filters">
                  <span className="text-xs font-bold">{t("elDash.cartable.disassemblyDate")}</span>
                  <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
                </label>
              ) : null}
              <label className="ed-filters">
                <span className="text-xs font-bold">{t("elDash.note")}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("elDash.noteHint")} />
              </label>
              {next === "disassembled" ? <p className="ew-role">{t("asmFlow.roles.c90")}</p> : null}
              <Button type="button" size="sm" disabled={advance.isPending} onClick={() => advance.mutate(item)}>
                <CheckCircle2 className="h-4 w-4" />
                {t("elDash.cartable.confirm", { stage: t(`elDash.stage.${next}`) })}
              </Button>
            </div>
          ) : null}
          {message ? <p className={cn("asm-note", message.ok ? "is-ok" : "is-danger")}>{message.text}</p> : null}
        </>
      ) : null}
    </section>
  );
}
