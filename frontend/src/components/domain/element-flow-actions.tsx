"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CheckCircle2, Hammer } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { PipelineItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { todayIsoLocal } from "@/lib/date-range";

type ApiErr = Error & { response?: { data?: { detail?: string } } };

export function isHealthyKept(item: PipelineItem) {
  return item.base_state === "decommissioned" && item.state === "ready";
}

export function isShutdownDecision(item: PipelineItem) {
  return item.base_state === "decommissioned" && item.state === "decommissioned";
}

function errText(err: ApiErr) {
  return err.response?.data?.detail || err.message;
}

/** Keep in shop / send to disassembly / assign a new position — Element Workflow after Decommission Date. */
export function DecommissionActions({
  item,
  editable,
  note,
  onNote,
  onMessage,
  onDone,
}: {
  item: PipelineItem;
  editable: boolean;
  note: string;
  onNote: (v: string) => void;
  onMessage: (m: { ok: boolean; text: string }) => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const operator = canEdit("wf_operation");
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (choice: "keep" | "disassemble") => elementDashboardApi.decide({ element_nr: item.element_nr, choice, note: note.trim() || null }),
    onSuccess: (res, choice) => {
      onMessage({
        ok: true,
        text: choice === "keep" ? t("elDash.cartable.keepDone", { nr: res.element_nr }) : t("elDash.cartable.done", { nr: res.element_nr, stage: t(`elDash.stage.${res.stage}`) }),
      });
      onNote("");
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["wf"] });
      onDone?.();
    },
    onError: (err: ApiErr) => onMessage({ ok: false, text: errText(err) }),
  });

  if (!editable || !operator) return null;

  if (isShutdownDecision(item)) {
    const reason = note.trim() || (item.decommission_reason || "").trim();
    return (
      <div className="ew-actions">
        <p className="ew-role">{t("asmFlow.roles.operation")}</p>
        <p className="ew-actions-lead">{t("asmFlow.next.decommissioned")}</p>
        <label className="ed-filters">
          <span className="text-xs font-bold">{t("asmFlow.failureReason")}</span>
          <input value={note} onChange={(e) => onNote(e.target.value)} placeholder={item.decommission_reason || t("asmFlow.failureReasonHint")} />
        </label>
        <div className="ew-action-btns">
          <Button type="button" size="sm" variant="danger" disabled={decide.isPending || !reason} onClick={() => decide.mutate("disassemble")}>
            <Hammer className="h-4 w-4" />
            {t("elDash.cartable.disassemble")}
          </Button>
        </div>
        <RelocateForm item={item} note={note} onNote={onNote} onMessage={onMessage} onDone={onDone} />
      </div>
    );
  }

  if (isHealthyKept(item)) {
    return (
      <div className="ew-actions">
        <p className="ew-role">{t("asmFlow.roles.operation")}</p>
        <p className="ew-actions-lead">{t("elDash.cartable.readyKeepHint")}</p>
        <RelocateForm item={item} note={note} onNote={onNote} onMessage={onMessage} onDone={onDone} />
      </div>
    );
  }

  return null;
}

export function RelocateForm({
  item,
  note,
  onNote,
  onMessage,
  onDone,
}: {
  item: PipelineItem;
  note: string;
  onNote: (v: string) => void;
  onMessage: (m: { ok: boolean; text: string }) => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [electrolyzer, setElectrolyzer] = useState("");
  const [position, setPosition] = useState("");
  const [day, setDay] = useState(todayIsoLocal());
  const [open, setOpen] = useState(false);

  const relocate = useMutation({
    mutationFn: () =>
      elementDashboardApi.relocate({
        element_nr: item.element_nr,
        electrolyzer,
        position,
        date: day || null,
        note: note.trim() || null,
      }),
    onSuccess: (res) => {
      onMessage({ ok: true, text: t("elDash.cartable.relocateDone", { nr: res.element_nr, cell: `${res.electrolyzer}-${res.position}` }) });
      onNote("");
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["wf"] });
      void qc.invalidateQueries({ queryKey: ["elements"] });
      onDone?.();
    },
    onError: (err: ApiErr) => onMessage({ ok: false, text: errText(err) }),
  });

  return (
    <div className="ew-relocate">
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
        <ArrowRightLeft className="h-4 w-4" />
        {t("elDash.cartable.relocate")}
      </Button>
      {open ? (
        <div className="ew-relocate-form">
          <p className="mon-sub">{t("elDash.cartable.relocateHint")}</p>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.col.electrolyzer")}</span>
            <ElectrolyzerCombo value={electrolyzer} onChange={setElectrolyzer} required />
          </label>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.cartable.position")}</span>
            <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="001–168" inputMode="numeric" />
          </label>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.cartable.date")}</span>
            <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.note")}</span>
            <input value={note} onChange={(e) => onNote(e.target.value)} placeholder={t("elDash.noteHint")} />
          </label>
          <Button type="button" size="sm" disabled={relocate.isPending || !electrolyzer || !position} onClick={() => relocate.mutate()}>
            <CheckCircle2 className="h-4 w-4" />
            {t("elDash.cartable.relocate")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
