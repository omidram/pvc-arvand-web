"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, MailOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDateTime } from "@/lib/utils";
import { workflowApi, type WfNotice } from "@/lib/workflow";

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
  return `/storage?wf=${n.flow}:${n.record_id}`;
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
  const summary = useQuery({ queryKey: ["wf", "summary"], queryFn: workflowApi.summary, refetchInterval: 15_000, refetchOnWindowFocus: true });
  const list = useQuery({ queryKey: ["wf", "notifications"], queryFn: () => workflowApi.notifications(15), enabled: open });

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
  const member = (meta.data?.groups.length ?? 0) > 0;
  if (!member && !waiting && !unread) return null;

  async function openNotice(n: WfNotice) {
    setOpen(false);
    router.push(href(n));
    await workflowApi.markRead({ flow: n.flow, record_id: n.record_id }).catch(() => undefined);
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
        title={t("wf.bellTitle", { n: waiting })}
        aria-label={t("wf.bellTitle", { n: waiting })}
        onClick={() => setOpen((v) => !v)}
      >
        <ClipboardList size={13} />
        {waiting > 0 ? <span className="tk-bell-count wf-bell-count">{waiting > 99 ? "99+" : waiting}</span> : null}
      </button>

      {open ? (
        <div className="tk-drop" role="dialog" aria-label={t("wf.cartableTitle")}>
          <div className="tk-drop-head">
            <strong>{t("wf.cartableTitle")}</strong>
            <button type="button" className="tk-drop-link" onClick={markAll} disabled={!unread}>
              <MailOpen size={13} /> {t("tickets.markAllRead")}
            </button>
          </div>
          <div className="tk-drop-list">
            {!list.data?.length ? <p className="tk-drop-empty">{t("wf.noNotices")}</p> : null}
            {list.data?.map((n) => (
              <button key={n.id} type="button" className={cn("tk-drop-item", !n.read && "is-unread")} onClick={() => void openNotice(n)}>
                <span className="tk-drop-top">
                  <strong>{n.title}</strong>
                  <span className="tk-drop-time">{formatDateTime(n.created_at)}</span>
                </span>
                <span className="tk-drop-subject">
                  {t(`wf.flow.${n.flow}`)} — {n.status ? t(`wf.status.${n.status}`) : ""}
                </span>
                <span className="tk-drop-preview">{n.from_name}</span>
              </button>
            ))}
          </div>
          <Link href="/storage?section=cartable" className="tk-drop-foot" onClick={() => setOpen(false)}>
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
