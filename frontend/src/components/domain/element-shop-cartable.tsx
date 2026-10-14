"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, ScanLine } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { ElementStage, PipelineItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useI18n } from "@/lib/i18n/context";
import { todayIsoLocal } from "@/lib/date-range";
import { formatDate, formatNumber } from "@/lib/utils";
import { StageBadge, STAGE_TONE } from "./element-dashboard-ui";

const NEXT: Partial<Record<ElementStage, ElementStage>> = {
  decommissioned: "disassembled",
  awaiting_disassembly: "disassembled",
  disassembled: "awaiting_assembly",
  awaiting_assembly: "assembling",
  assembling: "awaiting_qc",
  awaiting_qc: "ready",
};

const TODO: ElementStage[] = ["awaiting_disassembly", "awaiting_assembly", "assembling", "awaiting_qc", "ready"];

const squeeze = (s: string) => s.replace(/[\s\-_/.]/g, "").toUpperCase();

/** Cell-shop cartable: pick or scan an element tag and confirm its next step in one click. */
export function ElementShopCartable({ editable, onPickStage }: { editable: boolean; onPickStage: (stage: string) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState("");
  const [found, setFound] = useState<PipelineItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayIsoLocal());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const shop = useQuery({
    queryKey: ["element-dashboard", "shop", "shop", ""],
    queryFn: () => elementDashboardApi.shop({ state: "shop", limit: 600 }),
  });
  const counts = shop.data?.counts;

  async function lookup(value: string) {
    const key = squeeze(value);
    setMessage(null);
    if (!key) {
      setFound(null);
      setNotFound(false);
      return;
    }
    let hit = shop.data?.items.find((i) => squeeze(i.element_nr) === key) ?? null;
    if (!hit) {
      const res = await elementDashboardApi.shop({ state: "all", element_nr: value.trim(), limit: 5 }).catch(() => null);
      hit = res?.items[0] ?? null;
    }
    setFound(hit);
    setNotFound(!hit);
  }

  const advance = useMutation({
    mutationFn: (item: PipelineItem) =>
      elementDashboardApi.advance({
        element_nr: item.element_nr,
        note: note.trim() || null,
        date: NEXT[item.state] === "disassembled" ? day : null,
      }),
    onSuccess: (res) => {
      setMessage({ ok: true, text: t("elDash.cartable.done", { nr: res.element_nr, stage: t(`elDash.stage.${res.stage}`) }) });
      setTag("");
      setFound(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
      inputRef.current?.focus();
    },
    onError: (err: Error & { response?: { data?: { detail?: string } } }) =>
      setMessage({ ok: false, text: err.response?.data?.detail || err.message }),
  });

  const next = found ? NEXT[found.state] : undefined;

  return (
    <section className="mon-panel ed-cartable">
      <div className="mon-panel-head">
        <h3 className="mon-panel-title">
          <ClipboardList className="me-1 inline h-4 w-4" />
          {t("elDash.cartable.title")}
        </h3>
      </div>
      <p className="mon-sub">{t("elDash.cartable.help")}</p>

      <div className="ed-flow">
        {TODO.map((stage) => (
          <button
            key={stage}
            type="button"
            className={`ed-flow-step ed-tone-${STAGE_TONE[stage]}${counts?.[stage] ? "" : " is-zero"}`}
            onClick={() => onPickStage(stage)}
          >
            <span className="ed-flow-value">{counts ? formatNumber(counts[stage], 0) : "…"}</span>
            <span className="ed-flow-label">{t(`elDash.stage.${stage}`)}</span>
          </button>
        ))}
      </div>

      {editable ? (
        <div className="ed-cartable-body">
          <label className="ed-cartable-scan">
            <ScanLine className="h-4 w-4 shrink-0" />
            <input
              ref={inputRef}
              list="ed-cartable-tags"
              value={tag}
              placeholder={t("elDash.cartable.tagHint")}
              onChange={(e) => {
                const value = e.target.value;
                setTag(value);
                setNotFound(false);
                const exact = shop.data?.items.find((i) => squeeze(i.element_nr) === squeeze(value));
                setFound(exact ?? null);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (found && next && squeeze(found.element_nr) === squeeze(tag)) advance.mutate(found);
                else void lookup(tag);
              }}
              onBlur={() => void lookup(tag)}
            />
            <datalist id="ed-cartable-tags">
              {shop.data?.items.map((i) => (
                <option key={i.key} value={i.element_nr}>
                  {t(`elDash.stage.${i.state}`)}
                </option>
              ))}
            </datalist>
          </label>

          {notFound ? <p className="ed-note is-danger">{t("elDash.cartable.notFound", { nr: tag.trim() })}</p> : null}

          {found ? (
            <div className="ed-cartable-card">
              <div className="ed-cartable-head">
                <strong className="text-base">{found.element_nr}</strong>
                <StageBadge stage={found.state} />
                {found.source === "auto" ? <span className="ed-mute text-[10px]">{t("elDash.cartable.auto")}</span> : null}
                <span className="ed-mute text-xs">
                  {t("elDash.cartable.since", { date: formatDate(found.since), days: found.days_in_state ?? "—" })}
                </span>
              </div>
              <div className="ed-cartable-facts">
                <span>{t("elDash.col.cell")}: {found.electrolyzer ? `${found.electrolyzer}-${found.position ?? ""}` : "—"}</span>
                <span>{t("elDash.col.anode")}: {found.anode_nr || "—"}</span>
                <span>{t("elDash.col.cathode")}: {found.cathode_nr || "—"}</span>
                <span>{t("elDash.col.membrane")}: {found.membrane_nr || "—"}</span>
              </div>
              {next ? (
                <div className="ed-cartable-actions">
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
                  <Button type="button" disabled={advance.isPending} onClick={() => advance.mutate(found)}>
                    <CheckCircle2 className="h-4 w-4" />
                    {t("elDash.cartable.confirm", { stage: t(`elDash.stage.${next}`) })}
                  </Button>
                </div>
              ) : (
                <p className="ed-note">{found.state === "ready" ? t("elDash.cartable.readyHint") : t("elDash.cartable.noStep")}</p>
              )}
              {next === "disassembled" ? <p className="mon-sub">{t("elDash.cartable.writesAssembly")}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p className={`ed-note ${message.ok ? "is-ok" : "is-danger"}`}>{message.text}</p> : null}
    </section>
  );
}
