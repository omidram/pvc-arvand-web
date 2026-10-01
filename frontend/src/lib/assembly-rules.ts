/** Assembly Data cell position: Uhde BM racks 001–168. */

export const CELL_POSITION_MIN = 1;
export const CELL_POSITION_MAX = 168;

export function normalizeCellPosition(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{1,3}$/.test(text)) {
    throw new Error("range");
  }
  const number = Number(text);
  if (number < CELL_POSITION_MIN || number > CELL_POSITION_MAX) {
    throw new Error("range");
  }
  return String(number).padStart(3, "0");
}

export function assemblyPositionError(
  value: unknown,
  t: (path: string) => string,
): string | null {
  try {
    normalizeCellPosition(value);
    return null;
  } catch {
    return t("elements.positionRange");
  }
}
