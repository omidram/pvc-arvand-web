"use client";

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
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

/** One life of an element, in the order it really happens; after "disassembled" it starts again. */
export const LIFE_CYCLE: ElementStage[] = [
  "awaiting_assembly",
  "assembling",
  "awaiting_qc",
  "ready",
  "installed",
  "in_service",
  "decommissioned",
  "awaiting_disassembly",
  "disassembled",
];

const NEXT: Partial<Record<ElementStage, ElementStage>> = {
  awaiting_disassembly: "disassembled",
  disassembled: "awaiting_assembly",
  awaiting_assembly: "assembling",
  assembling: "awaiting_qc",
  awaiting_qc: "ready",
};

type LifeDateKey = "assembly_date" | "commissioning_date" | "decommissioning_date" | "disassembly_date";
const DATE_OF: Partial<Record<ElementStage, LifeDateKey>> = {
  installed: "assembly_date",
  in_service: "commissioning_date",
  decommissioned: "decommissioning_date",
  disassembled: "disassembly_date",
};

const squeeze = (s: string) => s.replace(/[\s\-_/.]/g, "").toUpperCase();

type OpenRecord = (elementNr: string, rowId: number | null) => void;

function useCounts() {
  return useQuery({
    queryKey: ["element-dashboard", "shop", "counts"],
    queryFn: () => elementDashboardApi.shop({ state: "shop", limit: 1 }),
    staleTime: 30_000,
  });
}

/** "Where are the elements?" for Assembly Data: the life cycle with a count per step; a step lists its elements. */
export function AssemblyLifecycleStrip({ onOpen }: { onOpen: OpenRecord }) {
  const { t } = useI18n();
  const counts = useCounts().data?.counts;
  const [picked, setPicked] = useState<ElementStage | null>(null);
  const list = useQuery({
    queryKey: ["element-dashboard", "shop", picked, ""],
    queryFn: () => elementDashboardApi.shop({ state: picked!, limit: 300 }),
    enabled: Boolean(picked),
  });

  return (
    <section className="asm-flow">
      <div className="asm-flow-head">
        <strong>{t("elDash.pipelineTitle")}</strong>
        <span className="asm-flow-help">{t("asmFlow.help")}</span>
      </div>
      <div className="asm-flow-line">
        {LIFE_CYCLE.map((stage, i) => (
          <Fragment key={stage}>
            {i > 0 ? <ArrowRight className="asm-flow-arrow" aria-hidden /> : null}
            <button
              type="button"
              title={t(`asmFlow.what.${stage}`)}
              className={cn("asm-flow-step", `ed-tone-${STAGE_TONE[stage]}`, picked === stage && "is-picked", counts && !counts[stage] && "is-zero")}
              onClick={() => setPicked(picked === stage ? null : stage)}
            >
              <span className="asm-flow-n">{counts ? formatNumber(counts[stage], 0) : "…"}</span>
              <span className="asm-flow-label">{t(`elDash.stage.${stage}`)}</span>
            </button>
          </Fragment>
        ))}
        <RotateCcw className="asm-flow-arrow" aria-label={t("asmFlow.loop")} />
      </div>

      {picked ? (
        <div className="asm-flow-list">
          <div className="asm-flow-list-head">
            <span>
              <strong>{t(`elDash.stage.${picked}`)}</strong> — {t(`asmFlow.what.${picked}`)}
            </span>
            <button type="button" className="asm-link" onClick={() => setPicked(null)}>
              <ChevronUp className="inline h-3.5 w-3.5" /> {t("asmFlow.close")}
            </button>
          </div>
          {list.isLoading ? (
            <p className="asm-mute">…</p>
          ) : !list.data?.items.length ? (
            <p className="asm-mute">{t("asmFlow.empty")}</p>
          ) : (
            <div className="asm-chips">
              {list.data.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="asm-chip"
                  title={item.electrolyzer ? `${item.electrolyzer}-${item.position ?? ""}` : undefined}
                  onClick={() => onOpen(item.element_nr, item.row_id)}
                >
                  {item.element_nr}
                  {item.days_in_state != null ? <small>{t("asmFlow.days", { n: item.days_in_state })}</small> : null}
                </button>
              ))}
              {list.data.truncated ? <span className="asm-mute">{t("asmFlow.more")}</span> : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The open Assembly Data record: where this element is in its life and the one next step. */
export function ElementLifecycleCard({ row, editable, onOpen }: { row: Element; editable: boolean; onOpen: OpenRecord }) {
  const { t } = useI18n();
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
  const at = LIFE_CYCLE.indexOf(item.state);
  const next = NEXT[item.state];

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
            {LIFE_CYCLE.map((stage, i) => {
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

          {editable && !older && (isShutdownDecision(item) || isHealthyKept(item) || item.state === "awaiting_disassembly") ? (
            <DecommissionActions item={item} editable={editable} note={note} onNote={setNote} onMessage={setMessage} />
          ) : null}

          {editable && next && !older ? (
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
