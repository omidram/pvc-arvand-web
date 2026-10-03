"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
];

const LAST_ACTIVITY_KEY = "pvc-arvand-last-activity";
const WARN_BEFORE_MS = 60_000;
const CHECK_EVERY_MS = 5_000;

function readLastActivity(): number {
  if (typeof window === "undefined") return Date.now();
  const raw = window.sessionStorage.getItem(LAST_ACTIVITY_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function writeLastActivity(ts: number) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
}

/** Watches user input and logs out after the idle timeout from plant settings. */
export function IdleSessionGuard() {
  const { user, logout, refresh } = useAuth();
  const { t } = useI18n();
  const [warnSeconds, setWarnSeconds] = useState<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const loggingOutRef = useRef(false);

  const idleMinutes = user?.session_idle_minutes ?? 30;
  const idleMs = idleMinutes > 0 ? idleMinutes * 60_000 : 0;

  const markActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    writeLastActivity(now);
    setWarnSeconds((prev) => (prev == null ? prev : null));
  }, []);

  const doIdleLogout = useCallback(() => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    try {
      window.sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      /* ignore */
    }
    logout();
  }, [logout]);

  // Reset activity clock on login / user change
  useEffect(() => {
    if (!user) {
      loggingOutRef.current = false;
      setWarnSeconds(null);
      return;
    }
    const now = Date.now();
    lastActivityRef.current = now;
    writeLastActivity(now);
  }, [user?.id]);

  // Activity listeners
  useEffect(() => {
    if (!user || idleMs <= 0) return;

    let throttleUntil = 0;
    function onActivity() {
      const now = Date.now();
      if (now < throttleUntil) return;
      throttleUntil = now + 1000;
      markActivity();
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [user, idleMs, markActivity]);

  // Idle checker
  useEffect(() => {
    if (!user || idleMs <= 0) {
      setWarnSeconds(null);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = idleMs - elapsed;
      if (remaining <= 0) {
        doIdleLogout();
        return;
      }
      if (remaining <= WARN_BEFORE_MS) {
        setWarnSeconds(Math.max(1, Math.ceil(remaining / 1000)));
      } else {
        setWarnSeconds(null);
      }
    };

    tick();
    const id = window.setInterval(tick, CHECK_EVERY_MS);
    return () => window.clearInterval(id);
  }, [user, idleMs, doIdleLogout]);

  // Refresh session config when tab regains focus (picks up settings changes)
  useEffect(() => {
    if (!user) return;
    function onFocus() {
      void refresh();
      const stored = readLastActivity();
      if (stored > lastActivityRef.current) lastActivityRef.current = stored;
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, refresh]);

  if (!user || idleMs <= 0 || warnSeconds == null) return null;

  return (
    <div className="idle-session-banner" role="alertdialog" aria-live="assertive">
      <div className="idle-session-banner-card">
        <p className="idle-session-banner-text">
          {t("session.idleWarning", { seconds: warnSeconds, minutes: idleMinutes })}
        </p>
        <button type="button" className="access-menu-btn" onClick={markActivity}>
          {t("session.staySignedIn")}
        </button>
      </div>
    </div>
  );
}
