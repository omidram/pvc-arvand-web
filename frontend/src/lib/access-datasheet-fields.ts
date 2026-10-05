import type { FieldDef } from "@/components/ui/resource-form";
import { humanizeKey } from "@/lib/utils";

/** Build AccessWorkspace `fields` from API column names (datasheet = form fields). */
export function fieldDefsFromKeys(
  keys: readonly string[],
  label: (key: string) => string,
  hints: Partial<Record<string, FieldDef["type"]>> = {}
): FieldDef[] {
  return keys.map((name) => {
    const type = hints[name];
    return type ? { name, label: label(name), type } : { name, label: label(name) };
  });
}

export function labelFieldOrHumanize(t: (path: string) => string, name: string, prefix = "fields"): string {
  const key = `${prefix}.${name}`;
  const value = t(key);
  return value !== key ? value : humanizeKey(name);
}

/** Scalar header fields on the Uhde assembly inspection form (excludes checklist JSON). */
export const ASSEMBLY_INSPECTION_DATASHEET_SCALAR = [
  "assembly_date",
  "element_nr",
  "anode_nr",
  "cathode_nr",
  "membrane_nr",
  "membrane_type",
  "electrolyzer",
  "position",
  "group_nr",
  "spacer_thickness_anode",
  "spacer_thickness_cathode",
  "electrode_distance",
  "remarks",
  "sign_maint_name",
  "sign_maint_at",
  "sign_insp_name",
  "sign_insp_at",
  "sign_proc_name",
  "sign_proc_at",
] as const;

export function assemblyInspectionDatasheetFields(t: (path: string) => string): FieldDef[] {
  return fieldDefsFromKeys(ASSEMBLY_INSPECTION_DATASHEET_SCALAR, (name) => labelFieldOrHumanize(t, name), {
    assembly_date: "date",
    remarks: "textarea",
    sign_maint_at: "datetime-local",
    sign_insp_at: "datetime-local",
    sign_proc_at: "datetime-local",
  });
}
