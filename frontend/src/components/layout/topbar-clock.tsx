"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useCalendar } from "@/lib/calendar/context";
import { formatDateWithCalendar } from "@/lib/calendar/format";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Live date + time shown in the top bar of every page (follows the Shamsi / Gregorian setting). */
export function TopbarClock({ className, classic }: { className?: string; classic?: boolean }) {
  const { calendar } = useCalendar();
  const { locale } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  if (!now) return <span className={cn("topbar-clock", className)} aria-hidden />;

  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const date = formatDateWithCalendar(iso, calendar, locale === "fa" ? "fa" : "en");
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return (
    <span
      className={cn("topbar-clock", classic && "is-classic", className)}
      dir="ltr"
      title={`${date} ${time}`}
      suppressHydrationWarning
    >
      <Clock size={12} aria-hidden />
      <span className="topbar-clock-date">{date}</span>
      <span className="topbar-clock-time">{time}</span>
    </span>
  );
}
