import { apiClient } from "./api-client";

/** Same constants and formulas as backend/app/cathodic_ce.py (Excel blank (4)). */
const AREA_M2 = 2.72;
const ELEMENTS = 163;
const FARADAY = 1.4923;

export type CathodicRow = {
  code: string;
  kind: "load" | "voltage" | "temp" | "conc";
  letter: string;
  label: string;
  description: string;
  tag: string;
};

export type CathodicDisplay = { tag: string; how_often: string; what: string };

export type CathodicSheet = {
  train: number;
  sheet_date: string;
  title: string;
  saved: boolean;
  hours: string[];
  yellow_hours: string[];
  rows: CathodicRow[];
  displays: CathodicDisplay[];
  production_tag: string;
  inputs: {
    date_label: string;
    total_load: string;
    initial_reading: number | null;
    final_reading: number | null;
    test_hours: number | null;
    readings: Record<string, Record<string, number>>;
    online: Record<string, number>;
    sign_insp_name: string;
    sign_insp_image: string;
    sign_insp_at: string;
    sign_proc_name: string;
    sign_proc_image: string;
    sign_proc_at: string;
  };
  computed: CathodicComputed;
};

export type CathodicComputed = {
  averages: Record<string, number | null>;
  on_count: number;
  missing: string[];
  j30: number | null;
  j31: number | null;
  j33: number | null;
  j34: number | null;
  j35: number | null;
  j37: number | null;
  q32: number | null;
  q33: number | null;
  q34: number | null;
  q35: number | null;
  q37: number | null;
  q39: number | null;
};

export type CathodicHistoryRow = {
  sheet_date: string;
  date_label: string;
  total_load: string;
  test_hours: number | null;
  production: number | null;
  current_density: number | null;
  avg_voltage: number | null;
  e_theoretical: number | null;
  e_measured: number | null;
  e_corrected: number | null;
  power_efficiency: number | null;
  ce: number | null;
  extrapolated: number | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function avg(hours: string[], values: Record<string, string> | undefined): number | null {
  const found: number[] = [];
  for (const hour of hours) {
    const n = num(values?.[hour]);
    if (n !== null) found.push(n);
  }
  if (!found.length) return null;
  return found.reduce((a, b) => a + b, 0) / found.length;
}

function div(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

/** Live sheet math. On/off follows the load row: a number means on, an empty row means off. */
export function calcCathodic(
  rows: CathodicRow[],
  hours: string[],
  cells: Record<string, Record<string, string>>,
  _online: Record<string, boolean>,
  initial: string,
  finalReading: string,
  testHours: string
): CathodicComputed {
  const averages: Record<string, number | null> = {};
  const loadCode = new Map(rows.filter((row) => row.kind === "load").map((row) => [row.letter, row.code]));
  for (const row of rows) {
    const gate = row.kind === "voltage" ? cells[loadCode.get(row.letter) || ""] : undefined;
    averages[row.code] = avg(
      hours.filter((hour) => gate === undefined || num(gate[hour]) !== null),
      cells[row.code]
    );
  }
  const onLetters = rows.filter((row) => row.kind === "load" && averages[row.code] !== null).map((row) => row.letter);
  const onCount = onLetters.length;
  const count = onCount || null;
  const missing = rows
    .filter((row) => row.kind === "voltage" && onLetters.includes(row.letter) && averages[row.code] === null)
    .map((row) => row.code);
  if (onLetters.length && averages.TEMP == null) missing.push("TEMP");
  const sumLoads = onLetters.length ? onLetters.reduce((sum, letter) => sum + (averages[`L${letter}`] as number), 0) : null;
  const voltsOk = onLetters.every((letter) => averages[`V${letter}`] != null);
  const sumVolts = onLetters.length && voltsOk ? onLetters.reduce((sum, letter) => sum + (averages[`V${letter}`] as number), 0) : null;
  const j30 = div(sumLoads, count === null ? null : AREA_M2 * count);
  const j33 = div(sumVolts, count);
  const j34 = div(j33, ELEMENTS);
  const j35 = div(sumLoads, count);
  const j28 = averages.TEMP ?? null;
  const j2 = num(initial);
  const j3 = num(finalReading);
  const j31 = num(testHours);
  const j37 = div(j2 === null || j3 === null ? null : (j3 - j2) * 24, j31);
  const q32 = j30 === null ? null : ((0.1265 * j30 + 2.4) * 1000) / (FARADAY * 0.95);
  const q33 = j33 === null || count === null || j35 === null || j37 === null ? null : div(j33 * count * j35 * 24, j37);
  const q34 = q33 === null || j28 === null || j30 === null ? null : q33 - ((90 - j28) * 7 * j30) / 3;
  const q35raw = div(q32, q34);
  const q35 = q35raw === null ? null : q35raw * 100;
  const q37 =
    j37 === null || j35 === null || count === null ? null : div(100 * j37 * 1000, j35 * 24 * FARADAY * ELEMENTS * count);
  const q39 = j37 === null || j30 === null || count === null ? null : div(j37 * 5.46 * 12, j30 * count);
  return {
    averages,
    on_count: onCount,
    missing,
    j30,
    j31,
    j33,
    j34,
    j35,
    j37,
    q32,
    q33,
    q34,
    q35,
    q37,
    q39,
  };
}

export function formatCe(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : 4;
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function download(url: string, fallback: string) {
  const { data, headers } = await apiClient.get(url, { responseType: "blob" });
  const match = /filename="?([^"]+)"?/i.exec(String(headers["content-disposition"] || ""));
  const name = match?.[1] || fallback;
  const blob = new Blob([data]);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const cathodicCeApi = {
  sheet: async (train: number, sheetDate: string): Promise<CathodicSheet> =>
    (await apiClient.get("/cathodic-ce/sheet", { params: { train, sheet_date: sheetDate } })).data,
  save: async (body: {
    train: number;
    sheet_date: string;
    date_label: string;
    total_load: string;
    initial_reading: number | null;
    final_reading: number | null;
    test_hours: number | null;
    readings: Record<string, Record<string, number>>;
    online: Record<string, number>;
    sign_insp_name: string;
    sign_insp_image: string;
    sign_insp_at: string;
    sign_proc_name: string;
    sign_proc_image: string;
    sign_proc_at: string;
  }): Promise<CathodicSheet> => (await apiClient.put("/cathodic-ce/sheet", body)).data,
  history: async (train: number): Promise<{ train: number; rows: CathodicHistoryRow[] }> =>
    (await apiClient.get("/cathodic-ce/history", { params: { train } })).data,
  downloadSheet: (train: number, sheetDate: string) =>
    download(`/cathodic-ce/sheet.xlsx?train=${train}&sheet_date=${sheetDate}`, `cathodic-ce-train${train}.xlsx`),
  downloadHistory: (train: number) =>
    download(`/cathodic-ce/history.xlsx?train=${train}`, `cathodic-ce-train${train}-history.xlsx`),
};
