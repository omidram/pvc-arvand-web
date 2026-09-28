"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { monitoringApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

type ToastItem = { id: string; title: string; message: string; severity: string };

export function AlertToaster() {
  const { canView } = useAuth();
  const { t } = useI18n();
  const allowed = canView("monitoring") || canView("voltage");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenRef = useRef<Set<number>>(new Set());
  const primedRef = useRef(false);

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
    const item: ToastItem = {
      id: `t-${Date.now()}`,
      title: t("monitoring.toastNew", { count: newcomers.length }),
      message: newcomers[0].title + (newcomers[0].message ? ` — ${newcomers[0].message}` : ""),
      severity: newcomers.some((a) => a.severity === "danger") ? "danger" : "warning",
    };
    setToasts((prev) => [item, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== item.id));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [alertsQuery.data, t]);

  if (!allowed || toasts.length === 0) return null;

  return (
    <div className="mon-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <Link
          key={toast.id}
          href="/monitoring?tab=alerts"
          className={`mon-toast ${toast.severity === "warning" ? "is-warning" : ""}`}
        >
          <BellRing size={18} className="shrink-0 text-red-600" />
          <div>
            <div className="mon-toast-title">{toast.title}</div>
            <div className="mon-toast-msg">{toast.message}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
