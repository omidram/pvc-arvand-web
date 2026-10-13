import { getCalendar } from "@/lib/calendar/runtime";
import { gregorianToJalali, jalaliToGregorian, toIsoDate } from "@/lib/calendar/jalali";

function storedCalendar() {
  if (typeof window === "undefined") return getCalendar();
  try {
    return window.localStorage.getItem("pvc-arvand-calendar") === "gregorian" ? "gregorian" : "shamsi";
  } catch {
    return getCalendar();
  }
}

/** Today as local `YYYY-MM-DD`. */
export function todayIsoLocal(): string {
  const d = new Date();
  return toIsoDate({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
}

/** First day of the current month in the active calendar (Shamsi month start when Shamsi is selected). */
export function monthStartIso(): string {
  const d = new Date();
  if (storedCalendar() === "shamsi") {
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return toIsoDate(jalaliToGregorian(j.year, j.month, 1));
  }
  return toIsoDate({ year: d.getFullYear(), month: d.getMonth() + 1, day: 1 });
}

/** Default report period for every date range: first day of this month → today. */
export function defaultDateRange(): { from: string; to: string } {
  return { from: monthStartIso(), to: todayIsoLocal() };
}
