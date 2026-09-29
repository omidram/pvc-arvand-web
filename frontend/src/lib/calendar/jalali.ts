/** Jalali (Shamsi) ↔ Gregorian conversion. Algorithm matches jalaali-js / backend plant_import. */

export type Ymd = { year: number; month: number; day: number };

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

export function gregorianToJalali(gy: number, gm: number, gd: number): Ymd {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { year: jy, month: jm, day: jd };
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): Ymd {
  let jyWork = jy;
  let gy: number;
  if (jyWork > 979) {
    gy = 1600;
    jyWork -= 979;
  } else {
    gy = 621;
  }
  let days =
    365 * jyWork +
    div(jyWork, 33) * 8 +
    div((jyWork % 33) + 3, 4) +
    78 +
    jd +
    (jm < 7 ? 31 * (jm - 1) : 186 + 30 * (jm - 7));
  gy += 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(days - 1, 36524);
    days = (days - 1) % 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal_a = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  while (gm <= 12 && gd > sal_a[gm]) {
    gd -= sal_a[gm];
    gm += 1;
  }
  return { year: gy, month: gm, day: gd };
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const g = jalaliToGregorian(jy, 12, 30);
  const back = gregorianToJalali(g.year, g.month, g.day);
  return back.year === jy && back.month === 12 && back.day === 30 ? 30 : 29;
}

export const JALALI_MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export const JALALI_MONTHS_EN = [
  "Farvardin",
  "Ordibehesht",
  "Khordad",
  "Tir",
  "Mordad",
  "Shahrivar",
  "Mehr",
  "Aban",
  "Azar",
  "Dey",
  "Bahman",
  "Esfand",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseIsoDateParts(value: string | null | undefined): Ymd | null {
  if (!value) return null;
  const m = String(value).trim().match(ISO_DATE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function parseIsoTime(value: string | null | undefined): string {
  if (!value) return "";
  const m = String(value).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

export function toIsoDate(parts: Ymd): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatJalaliYmd(parts: Ymd, withMonthName = false, locale: "en" | "fa" = "fa"): string {
  const y = String(parts.year).padStart(4, "0");
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  if (!withMonthName) return `${y}/${m}/${d}`;
  const months = locale === "fa" ? JALALI_MONTHS_FA : JALALI_MONTHS_EN;
  return `${d} ${months[parts.month - 1]} ${y}`;
}

export function gregorianIsoToJalali(iso: string): Ymd | null {
  const g = parseIsoDateParts(iso);
  if (!g) return null;
  return gregorianToJalali(g.year, g.month, g.day);
}
