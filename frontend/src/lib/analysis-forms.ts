/**
 * Field lists taken from the Access analysis forms (form / design view), one
 * spec per menu button. Parameter keys are the Access column names so rows
 * migrated from the MDB still open in the matching form.
 *
 * `range` values are the Access "Specification" / "Sollwerte" captions shown
 * under each unit on the original forms.
 */

export type AnalysisIdentity = "electrolyzer" | "position" | "group" | "train" | "date" | "time";

export type AnalysisField = {
  key: string;
  label: string;
  labelKey?: string;
  unit: string;
  /** Access Specification / Sollwerte text (e.g. "85 - 88", "<12"). */
  range?: string;
  aliases?: string[];
  side?: "left" | "right";
  /** Access prints "(100% basis)" beside this value. */
  basis?: boolean;
};

export type AnalysisFormSpec = {
  titleKey: string;
  layout: "stack" | "split";
  identity: AnalysisIdentity[];
  fields: AnalysisField[];
};

const IDENTITY: Record<string, AnalysisIdentity[]> = {
  total_plant: ["date", "time"],
  sub_plant: ["train", "date", "time"],
  electrolyzer: ["electrolyzer", "date", "time"],
  group: ["group", "date", "time"],
  element: ["electrolyzer", "position", "date", "time"],
};

function anolyteFields(plant: boolean): AnalysisField[] {
  const suffix = plant ? "" : " An";
  return [
    {
      key: `NaCl${suffix}`,
      label: "NaCl",
      unit: "g/l",
      range: "220 - 230",
      aliases: plant ? ["NaCl An"] : ["NaCl"],
    },
    {
      key: `NaClO3${suffix}`,
      label: "NaClO3",
      unit: "g/l",
      range: "<12",
      aliases: plant ? ["NaClO3 An"] : ["NaClO3"],
    },
    {
      key: `Na2SO4${suffix}`,
      label: "Na2SO4",
      unit: "g/l",
      range: "<10",
      aliases: plant ? ["Na2SO4 An"] : ["Na2SO4"],
    },
    {
      key: `NaOCl${suffix}`,
      label: "HOCl",
      unit: "g/l",
      aliases: plant ? ["NaOCl An", "HOCl", "HOCl An"] : ["NaOCl", "HOCl"],
    },
    { key: plant ? "HCl" : "HCl An", label: "HCl", unit: "g/l", aliases: plant ? ["HCl An"] : ["HCl"] },
    {
      key: plant ? "density at 20°" : "density at 20° An",
      label: "Density at 20°C",
      labelKey: "analyses.lbl.density",
      unit: "g/l",
      aliases: ["Density at 20° An", "density at 20°", "density_20C"],
    },
    {
      key: plant ? "temperature" : "temperature An",
      label: "t",
      unit: "°C",
      range: "85 - 88",
      aliases: plant ? ["temperature An"] : ["temperature"],
    },
    {
      key: plant ? "pH" : "pH An",
      label: "pH",
      unit: "/",
      range: "2,4 - 4,4",
      aliases: plant ? ["pH An"] : ["pH"],
    },
  ];
}

function catholyteFields(electrolyzer: boolean): AnalysisField[] {
  return [
    {
      key: "make-up water",
      label: electrolyzer ? "Demin water" : "make up water",
      labelKey: electrolyzer ? "analyses.lbl.deminWater" : "analyses.lbl.makeUpWater",
      unit: "m³/h",
      aliases: ["make_up_water", "make up water"],
    },
    { key: "temperature", label: "t", unit: "°C", range: "86 - 88" },
    { key: "NaOH", label: "NaOH", unit: "wt.%", range: "31 - 33" },
    { key: "NaCl", label: "NaCl", unit: "ppm w", range: "<100", basis: true },
    { key: "NaClO3", label: "NaClO3", unit: "ppm w", range: "<30" },
    { key: "Na2SO4", label: "Na2SO4", unit: "ppm w", range: "<80" },
    { key: "Fe", label: "Fe", unit: "ppm w", range: "<0,3", basis: true },
  ];
}

function chlorineFields(plant: boolean, brUnit: string): AnalysisField[] {
  if (plant) {
    return [
      { key: "Cl2 + CO2", label: "Cl2 + CO2", unit: "Vol.%", range: ">98", aliases: ["Cl2 + CO2 Cl", "Cl2_CO2"] },
      { key: "Restgas", label: "Restgas", labelKey: "analyses.lbl.restgas", unit: "Vol.%", range: "<2", aliases: ["restgas Cl", "restgas"] },
      { key: "O2", label: "O2", unit: "Vol.%", range: "<1,5", aliases: ["O2 Cl"] },
      { key: "H2", label: "H2", unit: "Vol.%", range: "<0,1", aliases: ["H2 Cl"] },
      { key: "N2", label: "N2", unit: "Vol.%", range: "<0,15", aliases: ["N2 Cl"] },
      { key: "Br", label: "Br", unit: "Vol. ppm", aliases: ["Br Cl"] },
    ];
  }
  return [
    { key: "Cl2 + CO2 Cl", label: "Cl2 + CO2", unit: "Vol.%", range: ">98", aliases: ["Cl2 + CO2", "Cl2_CO2"] },
    { key: "restgas Cl", label: "Restgas", labelKey: "analyses.lbl.restgas", unit: "Vol.%", range: "<2", aliases: ["Restgas", "restgas"] },
    { key: "O2 Cl", label: "O2", unit: "Vol.%", range: "<1,5", aliases: ["O2"] },
    { key: "H2 Cl", label: "H2", unit: "Vol.%", range: "<0,1", aliases: ["H2"] },
    { key: "N2 Cl", label: "N2", unit: "Vol.%", range: "<0,15", aliases: ["N2"] },
    { key: "Br Cl", label: "Br", unit: brUnit, aliases: ["Br"] },
  ];
}

function brineFields(plant: boolean): AnalysisField[] {
  const salt = (name: string) => (plant ? name : `${name} Pb`);
  const saltAlias = (name: string) => (plant ? [`${name} Pb`] : [name]);
  const left: AnalysisField[] = [
    { key: "flow rate", label: "Flow Rate", labelKey: "analyses.lbl.flowRate", unit: "m³/h", aliases: ["flow_rate"], side: "left" },
    { key: "temperature", label: "t", unit: "°C", side: "left" },
    { key: "pH", label: "pH", unit: "-", side: "left" },
    {
      key: "density at 20 °C",
      label: "Density at 20°C",
      labelKey: "analyses.lbl.density",
      unit: "g/l",
      aliases: ["density_20C", "density at 20°", "density at 20° An"],
      side: "left",
    },
    { key: salt("NaCl"), label: "NaCl", unit: "g/l", range: "290 - 310", aliases: saltAlias("NaCl"), side: "left" },
    { key: salt("NaClO3"), label: "NaClO3", unit: "g/l", range: "<10", aliases: saltAlias("NaClO3"), side: "left" },
    { key: salt("Na2CO3"), label: "Na2CO3", unit: "g/l", range: "<0,4", aliases: saltAlias("Na2CO3"), side: "left" },
    { key: salt("NaOH"), label: "NaOH", unit: "g/l", range: "<0,1", aliases: saltAlias("NaOH"), side: "left" },
    { key: salt("Na2SO4"), label: "Na2SO4", unit: "g/l", range: "4 - 7", aliases: saltAlias("Na2SO4"), side: "left" },
    {
      key: salt("NaOCl"),
      label: "HOCl",
      unit: "g/l",
      aliases: [...saltAlias("NaOCl"), plant ? "HOCl" : "HOCl Pb", "HOCl"],
      side: "left",
    },
    { key: salt("HCl"), label: "HCl", unit: "g/l", aliases: saltAlias("HCl"), side: "left" },
  ];
  const right: AnalysisField[] = [
    { key: "Ca +Mg", label: "Ca+Mg", unit: "ppb w", range: "<20", aliases: ["Ca+Mg"], side: "right" },
    { key: "Ba", label: "Ba", unit: "ppb w", range: "<500", side: "right" },
    { key: "Sr", label: "Sr", unit: "ppb w", range: "<400", side: "right" },
    { key: "Ni", label: "Ni", unit: "ppb w", range: "<10", side: "right" },
    { key: "Fe", label: "Fe", unit: "ppb w", range: "<1000", side: "right" },
    { key: "Al", label: "Al", unit: "ppb w", range: "<100", side: "right" },
    { key: "SiO2", label: "SiO2", unit: "ppb w", range: "<5000", side: "right" },
    { key: "I", label: "I", unit: "ppb w", range: "<200", side: "right" },
    { key: "F", label: "F", unit: "ppb w", range: "<1300", side: "right" },
    { key: "Br", label: "Br", unit: "ppb w", range: "<50000", side: "right" },
    {
      key: "Organics",
      label: "Organics",
      labelKey: "analyses.lbl.organics",
      unit: "ppm w",
      range: "<7",
      aliases: ["organics"],
      side: "right",
    },
    { key: "H2O2", label: "H2O2", unit: "ppm w", side: "right" },
  ];
  return [...left, ...right];
}

const HCL_FLOW: AnalysisField[] = [
  { key: "flow rate", label: "Flow Rate", labelKey: "analyses.lbl.flowRate", unit: "l/h", aliases: ["flow_rate"] },
  { key: "HCl", label: "HCl", unit: "% w" },
];

const HCL_ELECTROLYZER: AnalysisField[] = [
  ...HCL_FLOW,
  { key: "Dichte", label: "Density at 20°C", labelKey: "analyses.lbl.density", unit: "g/l", aliases: ["density", "density_20C"] },
];

const CAUSTIC: AnalysisField[] = [
  { key: "flow rate", label: "flow rate", labelKey: "analyses.lbl.flowRate", unit: "m³/h", aliases: ["flow_rate"] },
  { key: "NaOH", label: "NaOH", unit: "wt. %" },
  { key: "Fe", label: "Fe", unit: "ppm w", basis: true },
  { key: "temperature", label: "t", unit: "°C" },
];

const DEMIN: AnalysisField[] = [
  {
    key: "el  conductivity",
    label: "Conductivity",
    labelKey: "analyses.lbl.conductivity",
    unit: "µS/cm",
    aliases: ["conductivity", "el conductivity"],
  },
  { key: "Fe", label: "Fe", unit: "ppm w" },
  { key: "SiO2", label: "SiO2", unit: "ppm w" },
  { key: "Cl minus", label: "Chlorid", labelKey: "analyses.lbl.chlorid", unit: "ppm w", aliases: ["Cl"] },
  { key: "Oxygen dissolved", label: "Oxygen dissolved", labelKey: "analyses.lbl.oxygen", unit: "ppm w", aliases: ["O2_dissolved"] },
  { key: "Organics", label: "Organics", labelKey: "analyses.lbl.organics", unit: "ppm w", aliases: ["organics"] },
];

const HYDROGEN: AnalysisField[] = [
  { key: "H2", label: "H2", unit: "vol. %" },
  { key: "O2", label: "O2", unit: "ppm v" },
];

function spec(titleKey: string, scope: string, fields: AnalysisField[], layout: "stack" | "split" = "stack"): AnalysisFormSpec {
  return { titleKey, layout, identity: IDENTITY[scope], fields };
}

const SCOPES = ["total_plant", "sub_plant", "electrolyzer", "group", "element"] as const;

function buildForms(): Record<string, AnalysisFormSpec> {
  const forms: Record<string, AnalysisFormSpec> = {};
  for (const scope of SCOPES) {
    const plant = scope === "total_plant";
    forms[`anolyte:${scope}`] = spec(`analyses.formTitle.anolyte.${scope}`, scope, anolyteFields(plant));
    forms[`catholyte:${scope}`] = spec(
      `analyses.formTitle.catholyte.${scope}`,
      scope,
      catholyteFields(scope === "electrolyzer")
    );
    forms[`pure_brine:${scope}`] = spec(
      `analyses.formTitle.pure_brine.${scope}`,
      scope,
      brineFields(plant),
      "split"
    );
    forms[`chlorine_gas:${scope}`] = spec(
      `analyses.formTitle.chlorine_gas.${scope}`,
      scope,
      chlorineFields(plant, scope === "electrolyzer" ? "Vol.%" : "Vol. ppm")
    );
  }
  forms["hydrogen:total_plant"] = spec("analyses.formTitle.hydrogen.total_plant", "total_plant", HYDROGEN);
  forms["demin_water:total_plant"] = spec("analyses.formTitle.demin_water.total_plant", "total_plant", DEMIN);
  forms["caustic_feed:total_plant"] = spec("analyses.formTitle.caustic_feed.total_plant", "total_plant", CAUSTIC);
  forms["caustic_feed:sub_plant"] = spec("analyses.formTitle.caustic_feed.sub_plant", "sub_plant", CAUSTIC);
  forms["hcl:total_plant"] = spec("analyses.formTitle.hcl.total_plant", "total_plant", HCL_FLOW);
  forms["hcl:sub_plant"] = spec("analyses.formTitle.hcl.sub_plant", "sub_plant", HCL_FLOW);
  forms["hcl:electrolyzer"] = spec("analyses.formTitle.hcl.electrolyzer", "electrolyzer", HCL_ELECTROLYZER);
  return forms;
}

const FORMS = buildForms();

export function normalizeAnalysisScope(scope: string): string {
  return scope === "plant" ? "total_plant" : scope;
}

export function analysisForm(type: string, scope: string): AnalysisFormSpec | null {
  return FORMS[`${type}:${normalizeAnalysisScope(scope)}`] ?? null;
}

function formatParam(value: number | string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round((value + Number.EPSILON) * 1e6) / 1e6;
    return String(rounded);
  }
  return String(value);
}

/** Access stores a time-only value as 1899-12-30 plus the clock time. */
export function cleanAnalysisTime(value: string | null | undefined): string {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  const clock = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (!clock) return text;
  // Access sentinel date, ISO datetime, or any full date+time blob → keep clock only.
  if (
    text.startsWith("1899") ||
    text.includes("1899-12-30") ||
    text.includes("T") ||
    /^\d{4}-\d{2}-\d{2}/.test(text)
  ) {
    const parts = clock[1].split(":");
    const hh = parts[0].padStart(2, "0");
    const mm = parts[1] ?? "00";
    const ss = parts[2] ?? "00";
    return `${hh}:${mm}:${ss}`;
  }
  return text;
}

export function readParam(
  parameters: Record<string, number | string> | null | undefined,
  field: AnalysisField
): string {
  const bag = parameters || {};
  for (const key of [field.key, ...(field.aliases || [])]) {
    const value = bag[key];
    if (value !== undefined && value !== null && String(value) !== "") return formatParam(value);
  }
  return "";
}

export function parseParam(raw: string): number | string | null {
  const text = raw.trim();
  if (!text) return null;
  const normalized = text.replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  return text;
}

export function buildParameters(
  existing: Record<string, number | string> | null | undefined,
  form: AnalysisFormSpec,
  draft: Record<string, string>
): Record<string, number | string> {
  const parameters: Record<string, number | string> = { ...(existing || {}) };
  for (const field of form.fields) {
    const parsed = parseParam(draft[field.key] ?? "");
    if (parsed === null) delete parameters[field.key];
    else parameters[field.key] = parsed;
    for (const alias of field.aliases || []) {
      if (alias !== field.key) delete parameters[alias];
    }
  }
  return parameters;
}

/**
 * Access An Reinsole Befehl115 — Calculate HCl, NaOH and Na2CO3 Concentrations.
 *
 * HCl_g_l = (VHCl * rhoHCl * cHCl / 3647
 *          - 1000 * Vbrine * (NaOH/40 + 2*Na2CO3/105.99))
 *          * 36.47 / (Vbrine * 1000 + VHCl)
 *
 * Then NaOH and Na2CO3 are set to 0 (fully neutralized by the calculated HCl).
 */
export function calculateBrineHclConcentration(input: {
  vHclLh: number;
  cHclWtPct: number;
  rhoHclGl: number;
  brineFlowM3h: number;
  naohGl: number;
  na2co3Gl: number;
}): number {
  const { vHclLh, cHclWtPct, rhoHclGl, brineFlowM3h, naohGl, na2co3Gl } = input;
  const denom = brineFlowM3h * 1000 + vHclLh;
  if (!Number.isFinite(denom) || denom === 0) return NaN;
  return (
    ((vHclLh * rhoHclGl * cHclWtPct) / 3647 -
      1000 * brineFlowM3h * (naohGl / 40 + (2 * na2co3Gl) / 105.99)) *
    36.47 /
    denom
  );
}

export function brineFieldKey(form: AnalysisFormSpec, base: "NaOH" | "Na2CO3" | "HCl" | "flow rate"): string {
  const hit = form.fields.find((field) => field.key === base || field.key === `${base} Pb` || field.aliases?.includes(base));
  if (hit) return hit.key;
  if (base === "flow rate") return "flow rate";
  return form.fields.some((field) => field.key.endsWith(" Pb")) ? `${base} Pb` : base;
}

export function readDraftNumber(draft: Record<string, string>, key: string): number | null {
  const parsed = parseParam(draft[key] ?? "");
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}
