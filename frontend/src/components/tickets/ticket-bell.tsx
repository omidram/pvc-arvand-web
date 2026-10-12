"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, MailOpen } from "lucide-react";
import { ticketsApi, type TicketNotice } from "@/lib/tickets";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDateTime } from "@/lib/utils";
import { RoleBadge } from "./ticket-parts";

type Toast = { id: string; ticketId: number; title: string; from: string; role: string; text: string };

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => void ctx.close();
  } catch {
    /* sound is optional */
  }
}

/** Bell in the top bar: unread count, a list of who wrote and in which role, and a pop-up when something new arrives. */
export function TicketBell({ classic }: { classic?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const unread = useQuery({ queryKey: ["tickets", "unread"], queryFn: ticketsApi.unread, refetchInterval: 10_000, refetchOnWindowFocus: true });
  const latest = useQuery({
    queryKey: ["tickets", "notifications", "unread-toast"],
    queryFn: () => ticketsApi.notifications({ only_unread: true, limit: 10 }),
    refetchInterval: 10_000,
  });
  const list = useQuery({
    queryKey: ["tickets", "notifications", "dropdown"],
    queryFn: () => ticketsApi.notifications({ limit: 12 }),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  const count = unread.data?.notifications ?? 0;

  // browser tab title shows how many messages are waiting
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }, [count]);

  // pop-up for messages that arrived since the last check
  useEffect(() => {
    const items = latest.data?.items;
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
      id: `n-${n.id}`,
      ticketId: n.ticket_id,
      title: n.subject || t("tickets.title"),
      from: n.from_name || "",
      role: n.from_role || "",
      text: n.kind === "status" ? t("tickets.notice.status") : n.kind === "added" ? t("tickets.notice.added") : n.preview || "",
    }));
    setToasts((prev) => [...added, ...prev].slice(0, 4));
    beep();
    const timer = window.setTimeout(() => setToasts((prev) => prev.filter((x) => !added.some((a) => a.id === x.id))), 9000);
    return () => window.clearTimeout(timer);
  }, [latest.data, t]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["tickets"] });
  }

  async function openNotice(n: TicketNotice) {
    setOpen(false);
    router.push(`/tickets?ticket=${n.ticket_id}`);
    await ticketsApi.markRead({ ticket_id: n.ticket_id }).catch(() => undefined);
    refresh();
  }

  async function markAll() {
    await ticketsApi.markRead({ all: true }).catch(() => undefined);
    refresh();
  }

  function noticeText(n: TicketNotice): string {
    if (n.kind === "status") return t("tickets.notice.status");
    if (n.kind === "added") return t("tickets.notice.added");
    return n.preview || "";
  }

  return (
    <div className="tk-bell" ref={box}>
      <button
        type="button"
        className={cn(classic ? "tk-bell-btn is-classic" : "access-toolbar-btn tk-bell-btn", count > 0 && "has-unread")}
        title={t("tickets.bellTitle", { count })}
        aria-label={t("tickets.bellTitle", { count })}
        onClick={() => setOpen((v) => !v)}
      >
        {count > 0 ? <BellRing size={13} /> : <Bell size={13} />}
        {count > 0 ? <span className="tk-bell-count">{count > 99 ? "99+" : count}</span> : null}
      </button>

      {open ? (
        <div className="tk-drop" role="dialog" aria-label={t("tickets.title")}>
          <div className="tk-drop-head">
            <strong>{t("tickets.title")}</strong>
            <button type="button" className="tk-drop-link" onClick={markAll} disabled={!count}>
              <MailOpen size={13} /> {t("tickets.markAllRead")}
            </button>
          </div>
          <div className="tk-drop-list">
            {!list.data?.items.length ? <p className="tk-drop-empty">{t("tickets.noNotices")}</p> : null}
            {list.data?.items.map((n) => (
              <button key={n.id} type="button" className={cn("tk-drop-item", !n.read && "is-unread")} onClick={() => void openNotice(n)}>
                <span className="tk-drop-top">
                  <strong>{n.from_name}</strong>
                  {n.from_role ? <RoleBadge role={n.from_role} /> : null}
                  <span className="tk-drop-time">{formatDateTime(n.created_at)}</span>
                </span>
                <span className="tk-drop-subject">{n.subject}</span>
                <span className="tk-drop-preview">{noticeText(n)}</span>
              </button>
            ))}
          </div>
          <Link href="/tickets" className="tk-drop-foot" onClick={() => setOpen(false)}>
            {t("tickets.openAll")}
          </Link>
        </div>
      ) : null}

      {toasts.length ? (
        <div className="mon-toast-stack tk-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <Link key={toast.id} href={`/tickets?ticket=${toast.ticketId}`} className="mon-toast tk-toast" onClick={() => setToasts((p) => p.filter((x) => x.id !== toast.id))}>
              <BellRing size={18} className="shrink-0 text-blue-600" />
              <div>
                <div className="mon-toast-title">
                  {t("tickets.newFrom", { name: toast.from })} {toast.role ? <RoleBadge role={toast.role} /> : null}
                </div>
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
