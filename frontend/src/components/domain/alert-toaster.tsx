"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { monitoringApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

const SHOW_MS = 8000;

type ToastItem = { count: number; message: string; severity: string };

export function AlertToaster() {
  const { canView } = useAuth();
  const { t } = useI18n();
  const allowed = canView("monitoring") || canView("voltage");
  const [toast, setToast] = useState<ToastItem | null>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const primedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useQuery({
    queryKey: ["monitoring", "summary"],
    queryFn: monitoringApi.summary,
    enabled: allowed,
    refetchInterval: 15_000,
  });

  const alertsQuery = useQuery({
    queryKey: ["monitoring", "alerts", "open-toast"],
    queryFn: () => monitoringApi.listAlerts({ status: "open", limit: 20 }),
    enabled: allowed,
    refetchInterval: 15_000,
  });

  const dismiss = () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  };

  useEffect(() => {
    const alerts = alertsQuery.data;
    if (!alerts) return;
    if (!primedRef.current) {
      alerts.forEach((a) => seenRef.current.add(a.id));
      primedRef.current = true;
      return;
    }
    const newcomers = alerts.filter((a) => !seenRef.current.has(a.id));
    if (!newcomers.length) return;
    newcomers.forEach((a) => seenRef.current.add(a.id));
    const first = newcomers[0];
    // one notification at a time: later alerts are added to the one on screen
    setToast((prev) => ({
      count: (prev?.count ?? 0) + newcomers.length,
      message: first.title + (first.message ? ` — ${first.message}` : ""),
      severity: prev?.severity === "danger" || newcomers.some((a) => a.severity === "danger") ? "danger" : "warning",
    }));
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setToast(null);
    }, SHOW_MS);
  }, [alertsQuery.data]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  if (!allowed || !toast) return null;

  return (
    <div className="mon-toast-stack" aria-live="polite">
      <div className={`mon-toast ${toast.severity === "warning" ? "is-warning" : ""}`}>
        <BellRing size={18} className="shrink-0 text-red-600" />
        <Link href="/monitoring?tab=alerts" className="min-w-0 flex-1" onClick={dismiss}>
          <div className="mon-toast-title">{t("monitoring.toastNew", { count: toast.count })}</div>
          <div className="mon-toast-msg">{toast.message}</div>
        </Link>
        <button type="button" className="mon-toast-close" onClick={dismiss} aria-label={t("common.close")}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
