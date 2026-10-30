/** Small client-side CSV download (UTF-8 with BOM so Excel shows Persian text correctly). */
import { formatDisplayedDate } from "@/lib/calendar/format";

export type CsvCell = string | number | boolean | null | undefined;

function excelDateText(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const shown = formatDisplayedDate(raw) || raw;
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(shown) || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return `="${shown.replace(/"/g, '""')}"`;
  }
  return shown;
}

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = excelDateText(value);
  return /[",\r\n;]/.test(text) || text.startsWith("=") ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(","));
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
