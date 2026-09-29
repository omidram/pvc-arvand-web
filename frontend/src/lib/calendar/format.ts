import { formatJalaliYmd, gregorianToJalali, parseIsoDateParts, parseIsoTime } from "./jalali";
import { getCalendar, type CalendarKind } from "./runtime";

/** Show a stored Gregorian ISO date (or YYYY-MM) in the active calendar. Other text is left as-is. */
export function formatDisplayedDate(value: unknown, calendar: CalendarKind = getCalendar()): string {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const formatted = /T\d{2}:\d{2}/.test(text) || / \d{2}:\d{2}/.test(text)
      ? formatDateTimeWithCalendar(text, calendar)
      : formatDateWithCalendar(text, calendar);
    return formatted === "—" ? text : formatted;
  }
  const month = text.match(/^(\d{4})-(\d{2})$/);
  if (month && calendar === "shamsi") {
    const jalali = gregorianToJalali(Number(month[1]), Number(month[2]), 1);
    return `${jalali.year}/${String(jalali.month).padStart(2, "0")}`;
  }
  return text;
}

export function formatDateWithCalendar(
  value: string | null | undefined,
  calendar: CalendarKind = getCalendar(),
  locale: "en" | "fa" = "en"
): string {
  if (!value) return "—";
  const parts = parseIsoDateParts(value);
  if (!parts) {
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return formatDateWithCalendar(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        calendar,
        locale
      );
    } catch {
      return value;
    }
  }
  if (calendar === "shamsi") {
    const j = gregorianToJalali(parts.year, parts.month, parts.day);
    return formatJalaliYmd(j, locale === "fa", locale);
  }
  const d = new Date(parts.year, parts.month - 1, parts.day);
  return d.toLocaleDateString(locale === "fa" ? "fa-IR-u-ca-gregory" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function formatDateTimeWithCalendar(
  value: string | null | undefined,
  calendar: CalendarKind = getCalendar(),
  locale: "en" | "fa" = "en"
): string {
  if (!value) return "—";
  const datePart = formatDateWithCalendar(value, calendar, locale);
  if (datePart === "—" || datePart === value) return datePart;
  const time = parseIsoTime(value);
  if (time) return `${datePart} ${time}`;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return datePart;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (hh === "00" && mm === "00" && !String(value).includes("T") && !String(value).includes(" ")) return datePart;
    return `${datePart} ${hh}:${mm}`;
  } catch {
    return datePart;
  }
}
