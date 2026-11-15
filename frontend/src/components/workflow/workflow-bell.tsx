"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, MailOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDateTime } from "@/lib/utils";
import { CARTABLE_MS, workflowApi, workflowHref, type WfNotice, type WfSummary } from "@/lib/workflow";

type Toast = { id: number; flow: string; recordId: number; title: string; text: string };

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 660;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => void ctx.close();
  } catch {
    /* sound is optional */
  }
}

function href(n: { flow: string; record_id: number }) {
  return workflowHref(n.flow, n.record_id);
}

/** Cartable button in the top bar: items waiting for my workflow groups, plus a pop-up when a new one lands. */
export function WorkflowBell({ classic }: { classic?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const meta = useQuery({ queryKey: ["wf", "meta"], queryFn: workflowApi.meta, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["wf", "summary"], queryFn: workflowApi.summary, refetchInterval: CARTABLE_MS, refetchOnWindowFocus: true });
  // The pop-up lists what is still waiting for me (the same items the badge counts), not finished history.
  const list = useQuery({ queryKey: ["wf", "cartable"], queryFn: workflowApi.cartable, enabled: open, refetchInterval: open ? CARTABLE_MS : false });
  const waitingRows = [...(list.data ?? [])]
    .sort((a, b) => (a.sla_left_minutes ?? Number.MAX_SAFE_INTEGER) - (b.sla_left_minutes ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 15);

  useEffect(() => {
    const items = summary.data?.items;
    if (!items) return;
    if (!primed.current) {
      items.forEach((n) => seen.current.add(n.id));
      primed.current = true;
      return;
    }
    const fresh = items.filter((n) => !seen.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seen.current.add(n.id));
    const added: Toast[] = fresh.slice(0, 3).map((n) => ({
      id: n.id,
      flow: n.flow,
      recordId: n.record_id,
      title: n.title || "",
      text: n.status ? t(`wf.status.${n.status}`) : "",
    }));
    setToasts((prev) => [...added, ...prev].slice(0, 4));
    beep();
    void qc.invalidateQueries({ queryKey: ["wf", "cartable"] });
    const timer = window.setTimeout(() => setToasts((prev) => prev.filter((x) => !added.some((a) => a.id === x.id))), 9000);
    return () => window.clearTimeout(timer);
  }, [summary.data, t, qc]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const waiting = summary.data?.cartable ?? 0;
  const unread = summary.data?.unread ?? 0;
  const late = summary.data?.late ?? 0;
  const member = (meta.data?.groups.length ?? 0) > 0;
  if (!member && !waiting && !unread) return null;

  async function openNotice(n: WfNotice) {
    setOpen(false);
    router.push(href(n));
    await workflowApi.markRead({ flow: n.flow, record_id: n.record_id }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["wf"] });
  }

  async function openRow(row: WfSummary) {
    setOpen(false);
    router.push(href({ flow: row.flow, record_id: row.id }));
    await workflowApi.markRead({ flow: row.flow, record_id: row.id }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["wf"] });
  }

  async function markAll() {
    await workflowApi.markRead({ all: true }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["wf"] });
  }

  return (
    <div className="tk-bell" ref={box}>
      <button
        type="button"
        className={cn(classic ? "tk-bell-btn is-classic" : "access-toolbar-btn tk-bell-btn", (waiting > 0 || unread > 0) && "has-unread")}
        title={late > 0 ? `${t("wf.bellTitle", { n: waiting })} — ${t("wf.sla.lateCount", { n: late })}` : t("wf.bellTitle", { n: waiting })}
        aria-label={t("wf.bellTitle", { n: waiting })}
        onClick={() => setOpen((v) => !v)}
      >
        <ClipboardList size={13} />
        {waiting > 0 ? <span className={cn("tk-bell-count wf-bell-count", late > 0 && "is-late")}>{waiting > 99 ? "99+" : waiting}</span> : null}
      </button>

      {open ? (
        <div className="tk-drop" role="dialog" aria-label={t("wf.cartableTitle")}>
          <div className="tk-drop-head">
            <strong>{t("wf.cartableTitle")}</strong>
            {late > 0 ? <span className="wf-late-chip">{t("wf.sla.lateCount", { n: late })}</span> : null}
            <button type="button" className="tk-drop-link" onClick={markAll} disabled={!unread}>
              <MailOpen size={13} /> {t("tickets.markAllRead")}
            </button>
          </div>
          <div className="tk-drop-list">
            {!waitingRows.length ? <p className="tk-drop-empty">{t("wf.noNotices")}</p> : null}
            {waitingRows.map((row) => (
              <button key={`${row.flow}-${row.id}`} type="button" className={cn("tk-drop-item", row.sla_state === "late" && "is-unread")} onClick={() => void openRow(row)}>
                <span className="tk-drop-top">
                  <strong>{row.title || row.code}</strong>
                  <span className="tk-drop-time">{row.sla_state === "late" ? t("wf.sla.state.late") : row.updated_at ? formatDateTime(row.updated_at) : ""}</span>
                </span>
                <span className="tk-drop-subject">
                  {t(`wf.flow.${row.flow}`)} — {row.status ? t(`wf.status.${row.status}`) : ""}
                </span>
                <span className="tk-drop-preview">{row.created_by}</span>
              </button>
            ))}
          </div>
          <Link href="/cartable" className="tk-drop-foot" onClick={() => setOpen(false)}>
            {t("wf.openCartable", { n: waiting })}
          </Link>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="mon-toast-stack tk-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <Link
              key={toast.id}
              href={href({ flow: toast.flow, record_id: toast.recordId })}
              className="mon-toast tk-toast"
              onClick={() => setToasts((p) => p.filter((x) => x.id !== toast.id))}
            >
              <ClipboardList size={18} className="shrink-0 text-amber-600" />
              <div>
                <div className="mon-toast-title">{t("wf.newInCartable")}</div>
                <div className="mon-toast-msg">
                  <strong>{toast.title}</strong>
                  {toast.text ? ` — ${toast.text}` : ""}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
