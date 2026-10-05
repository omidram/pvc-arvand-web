/** Cell-room layout shared with the monitoring schematic. */

export const TRAIN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"] as const;

export const RACKS = [
  { id: "1" as const, start: 1, end: 84 },
  { id: "2" as const, start: 85, end: 168 },
];

export type TrainId = "1" | "2";

const LETTER_SET = new Set<string>(TRAIN_LETTERS);

/** Canonical UI / plant form: letter then train digit — A1, B2, K2, … */
export function electrolyzerName(train: TrainId, letter: string): string {
  return `${letter.toUpperCase()}${train}`;
}

/** Full cell-room list (24): A1–M1 and A2–M2 (no I). */
export function allElectrolyzers(): string[] {
  return TRAIN_LETTERS.flatMap((letter) => [`${letter}1`, `${letter}2`]);
}

/** Normalize 1A / A1 / a1 → A1. Leaves non-cell-room names unchanged. */
export function formatElectrolyzer(name: string | null | undefined): string {
  const raw = (name || "").trim().toUpperCase();
  if (!raw) return "";
  const letterFirst = raw.match(/^([A-HJ-M])([12])$/);
  if (letterFirst) return `${letterFirst[1]}${letterFirst[2]}`;
  const digitFirst = raw.match(/^([12])([A-HJ-M])$/);
  if (digitFirst) return `${digitFirst[2]}${digitFirst[1]}`;
  return raw;
}

export function electrolyzerAliases(name: string | null | undefined): string[] {
  const display = formatElectrolyzer(name);
  if (!display) return [];
  const letter = display[0];
  const train = display.slice(1);
  if (LETTER_SET.has(letter) && (train === "1" || train === "2")) {
    return Array.from(new Set([display, `${train}${letter}`, (name || "").trim().toUpperCase()].filter(Boolean)));
  }
  return [display];
}

export function compareElectrolyzers(a: string, b: string): number {
  const left = formatElectrolyzer(a);
  const right = formatElectrolyzer(b);
  const la = left[0] || "";
  const lb = right[0] || "";
  if (la !== lb) return la.localeCompare(lb);
  return left.localeCompare(right, undefined, { numeric: true });
}

export function trainOf(electrolyzer: string): TrainId | null {
  const name = formatElectrolyzer(electrolyzer);
  if (name.endsWith("1")) return "1";
  if (name.endsWith("2")) return "2";
  return null;
}

export function positionNumber(position: string): number | null {
  const value = Number(position);
  return Number.isFinite(value) ? value : null;
}

export function rackOf(position: string): (typeof RACKS)[number] | null {
  const value = positionNumber(position);
  if (value == null) return null;
  return RACKS.find((rack) => value >= rack.start && value <= rack.end) ?? null;
}
