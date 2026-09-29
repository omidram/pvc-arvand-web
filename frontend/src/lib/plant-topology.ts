/** Cell-room layout shared with the monitoring schematic. */

export const TRAIN_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"] as const;

export const RACKS = [
  { id: "1" as const, start: 1, end: 84 },
  { id: "2" as const, start: 85, end: 168 },
];

export type TrainId = "1" | "2";

export function electrolyzerName(train: TrainId, letter: string): string {
  return `${letter}${train}`;
}

export function trainOf(electrolyzer: string): TrainId | null {
  const name = electrolyzer.trim().toUpperCase();
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
