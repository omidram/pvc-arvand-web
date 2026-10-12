import { apiClient } from "./api-client";

/** Result of the Access-exact Un / CE / SPC engine (`backend/app/un_ce_engine.py`). */
export type UnCeColumn = { key: string; header: string; align?: "left" | "right" | "center" };

export type UnCeSettingsSnapshot = {
  iref: number;
  tkorr: number;
  ckorr: number;
  area_m2: number;
  umin: number;
  anodic_correction: number;
  clo_analysis: number;
  acidified: boolean;
  temp_correction_element: number;
};

export type UnCeResult = {
  columns: UnCeColumn[];
  rows: Record<string, unknown>[];
  chart: { x: string; series: string; value: number }[];
  value_key: string;
  value_label: string;
  note: string;
  truncated: boolean;
  total: number;
  settings: UnCeSettingsSnapshot;
};

export type UnCeSettings = UnCeSettingsSnapshot & {
  iref_options: { iref: number; tkorr: number | null; ckorr: number | null }[];
  area_options: number[];
};

export type UnCeSettingsInput = {
  iref: number;
  area_m2: number;
  umin: number;
  anodic_correction: number;
  clo_analysis: number;
  temp_correction_element: number;
  acidified: boolean;
};

export type UnCeScope = "plant" | "train" | "electrolyzer" | "group" | "element";
export type UnCeCalc = "individual" | "several" | "all";

export type UnCeQuery = {
  scope: UnCeScope;
  calc: UnCeCalc;
  dateFrom?: string;
  dateTill?: string;
  electrolyzers?: string[];
  trains?: string[];
  groups?: string[];
  /** `A1:12` pairs. */
  elements?: string[];
};

function baseParams(q: UnCeQuery): Record<string, string | undefined> {
  return {
    scope: q.scope,
    calc: q.calc,
    date_from: q.dateFrom || undefined,
    date_till: q.dateTill || undefined,
    electrolyzers: q.electrolyzers?.length ? q.electrolyzers.join(",") : undefined,
    trains: q.trains?.length ? q.trains.join(",") : undefined,
    groups: q.groups?.length ? q.groups.join(",") : undefined,
    elements: q.elements?.length ? q.elements.join(",") : undefined,
  };
}

export type UnCeOptions = { electrolyzers: string[]; groups: string[]; trains: string[] };

export const unCeApi = {
  options: async (): Promise<UnCeOptions> => (await apiClient.get("/un-ce/options")).data,
  settings: async (): Promise<UnCeSettings> => (await apiClient.get("/un-ce/settings")).data,
  saveSettings: async (payload: UnCeSettingsInput): Promise<UnCeSettings> =>
    (await apiClient.put("/un-ce/settings", payload)).data,
  un: async (q: UnCeQuery, table: "1" | "2", limit = 5000): Promise<UnCeResult> =>
    (await apiClient.get("/un-ce/un", { params: { ...baseParams(q), table, limit } })).data,
  ce: async (q: UnCeQuery, basis: "anodic" | "naoh"): Promise<UnCeResult> =>
    (await apiClient.get("/un-ce/ce", { params: { ...baseParams(q), basis } })).data,
  spc: async (
    q: Pick<UnCeQuery, "scope" | "calc" | "dateFrom" | "dateTill" | "electrolyzers">,
    unTable: "1" | "2",
    ceBasis: "anodic" | "naoh"
  ): Promise<UnCeResult> =>
    (
      await apiClient.get("/un-ce/spc", {
        params: {
          scope: q.scope,
          calc: q.calc,
          date_from: q.dateFrom || undefined,
          date_till: q.dateTill || undefined,
          electrolyzers: q.electrolyzers?.length ? q.electrolyzers.join(",") : undefined,
          un_table: unTable,
          ce_basis: ceBasis,
        },
      })
    ).data,
};

/** Convert `A1|12` pair strings of the "several elements" box to the API's `A1:12`. */
export function pairsToElements(values: string[]): string[] {
  return values
    .filter((v) => v && v !== "|")
    .map((v) => v.replace("|", ":"))
    .filter((v) => v.includes(":") && !v.endsWith(":"));
}
