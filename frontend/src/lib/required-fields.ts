import type { FieldDef } from "@/components/ui/resource-form";

/**
 * Key data a record must carry before it can be created (the red * in the forms). Must stay in step with
 * ELEMENT_REQUIRED in backend/app/routers/elements.py and ANODE_REQUIRED / CATHODE_REQUIRED in components.py.
 */
export const ELEMENT_REQUIRED = [
  "electrolyzer",
  "position",
  "group_nr",
  "anode_nr",
  "cathode_nr",
  "membrane_nr",
  "assembly_date",
] as const;
export const ANODE_REQUIRED = ["anode_nr", "manufacturer", "coating", "received_date"] as const;
export const CATHODE_REQUIRED = ["cathode_nr", "manufacturer", "coating", "received_date"] as const;

/** Mark the named fields as required (red *). */
export function withRequired(fields: FieldDef[], names: readonly string[]): FieldDef[] {
  const wanted = new Set(names);
  return fields.map((f) => (wanted.has(f.name) ? { ...f, required: true } : f));
}

/** Error text for a new record that lacks required values; null when complete. */
export function requiredError(
  values: Record<string, unknown>,
  fields: FieldDef[],
  names: readonly string[],
  t: (path: string, vars?: Record<string, string | number | null | undefined>) => string
): string | null {
  const missing = names.filter((name) => {
    const v = values[name];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
  if (!missing.length) return null;
  const labels = missing.map((name) => fields.find((f) => f.name === name)?.label || name);
  return t("common.requiredMissing", { list: labels.join(", ") });
}
