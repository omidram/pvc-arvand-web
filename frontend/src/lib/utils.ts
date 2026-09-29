import { clsx, type ClassValue } from "clsx";
import { formatDateTimeWithCalendar, formatDateWithCalendar, formatDisplayedDate as formatDisplayedDateWithCalendar } from "@/lib/calendar/format";
import { getCalendar } from "@/lib/calendar/runtime";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(value: string | null | undefined): string {
  return formatDateWithCalendar(value, getCalendar());
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeWithCalendar(value, getCalendar());
}

export function formatDisplayedDate(value: unknown): string {
  return formatDisplayedDateWithCalendar(value, getCalendar());
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
