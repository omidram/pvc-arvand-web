import { getCalendar } from "@/lib/calendar/runtime";
import {
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  JALALI_MONTHS_EN,
  JALALI_MONTHS_FA,
  toIsoDate,
} from "@/lib/calendar/jalali";

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

export type MonthOption = { key: string; label: string; from: string; to: string };

/** Recent months, newest first, as ISO from/to of the whole month. */
export function recentMonthOptions(shamsi: boolean, persianLabels: boolean, count = 24): MonthOption[] {
  const now = new Date();
  const options: MonthOption[] = [];
  if (shamsi) {
    const start = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    let year = start.year;
    let month = start.month;
    const names = persianLabels ? JALALI_MONTHS_FA : JALALI_MONTHS_EN;
    for (let i = 0; i < count; i += 1) {
      const last = jalaliMonthLength(year, month);
      options.push({
        key: `${year}-${month}`,
        label: `${names[month - 1]} ${year}`,
        from: toIsoDate(jalaliToGregorian(year, month, 1)),
        to: toIsoDate(jalaliToGregorian(year, month, last)),
      });
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
    }
    return options;
  }
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  for (let i = 0; i < count; i += 1) {
    const last = new Date(year, month, 0).getDate();
    const label = new Date(year, month - 1, 1).toLocaleString(persianLabels ? "fa-IR" : "en", {
      month: "long",
      year: "numeric",
    });
    options.push({
      key: `${year}-${month}`,
      label,
      from: toIsoDate({ year, month, day: 1 }),
      to: toIsoDate({ year, month, day: last }),
    });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return options;
}
