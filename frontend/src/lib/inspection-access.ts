export const INSPECTION_COLLAB_KEYS = ["inspections", "anodes", "cathodes", "membranes", "elements"] as const;

export function canSeeInspections(canView: (formKey: string) => boolean): boolean {
  return INSPECTION_COLLAB_KEYS.some((key) => canView(key));
}

export function canWorkInspections(canEdit: (formKey: string) => boolean): boolean {
  return INSPECTION_COLLAB_KEYS.some((key) => canEdit(key));
}

/** TAFKIK workshop form lives under Element Administration and covers both electrodes. */
export const SEGREGATION_KEYS = ["anodes", "cathodes", "elements"] as const;

export function canSeeSegregation(canView: (formKey: string) => boolean): boolean {
  return SEGREGATION_KEYS.some((key) => canView(key));
}

export function canWorkSegregation(canEdit: (formKey: string) => boolean): boolean {
  return SEGREGATION_KEYS.some((key) => canEdit(key));
}
