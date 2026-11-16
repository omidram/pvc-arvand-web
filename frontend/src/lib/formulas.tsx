"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import { useAuth } from "./auth/context";
import { SEC_DEFAULTS, type SecFactors } from "./sec-formula";

export type FormulaParam = {
  name: string;
  value: number;
  default: number;
  label_en: string;
  label_fa: string;
  unit: string;
  min: number | null;
  max: number | null;
};

export type FormulaRow = {
  key: string;
  title_en: string;
  title_fa: string;
  where_en: string;
  where_fa: string;
  calculates_en: string;
  calculates_fa: string;
  expression: string;
  params: FormulaParam[];
};

type FormulaMap = Record<string, Record<string, number>>;

const FormulaContext = createContext<FormulaMap>({});

export const formulasApi = {
  list: async (): Promise<FormulaRow[]> => (await apiClient.get("/formulas")).data,
  update: async (key: string, params: Record<string, number>): Promise<FormulaRow> =>
    (await apiClient.put(`/formulas/${key}`, { params })).data,
  reset: async (key: string): Promise<FormulaRow> => (await apiClient.post(`/formulas/${key}/reset`)).data,
};

/** A calculation number from Settings → Formulas, or the built-in fallback until that loads. */
export function useFormula(key: string, name: string, fallback: number): number {
  const value = useContext(FormulaContext)[key]?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function useCathodicFactors(): Record<string, number> {
  return {
    area_m2: useFormula("cathodic_ce", "area_m2", 2.72),
    elements: useFormula("cathodic_ce", "elements", 163),
    faraday: useFormula("cathodic_ce", "faraday", 1.4923),
    theory_slope: useFormula("cathodic_ce", "theory_slope", 0.1265),
    theory_intercept: useFormula("cathodic_ce", "theory_intercept", 2.4),
    theory_scale: useFormula("cathodic_ce", "theory_scale", 1000),
    theory_ce: useFormula("cathodic_ce", "theory_ce", 0.95),
    temp_ref: useFormula("cathodic_ce", "temp_ref", 90),
    temp_num: useFormula("cathodic_ce", "temp_num", 7),
    temp_den: useFormula("cathodic_ce", "temp_den", 3),
    prod_factor: useFormula("cathodic_ce", "prod_factor", 5.46),
    prod_hours: useFormula("cathodic_ce", "prod_hours", 12),
    day_hours: useFormula("cathodic_ce", "day_hours", 24),
  };
}

export function useSecFactors(): SecFactors {
  return {
    k: useFormula("sec", "k", SEC_DEFAULTS.k),
    v0: useFormula("sec", "v0", SEC_DEFAULTS.v0),
    slope: useFormula("sec", "slope", SEC_DEFAULTS.slope),
    cells: useFormula("sec", "cells", SEC_DEFAULTS.cells),
    ratedKa: useFormula("sec", "rated_ka", SEC_DEFAULTS.ratedKa),
    okPct: useFormula("sec", "ok_pct", SEC_DEFAULTS.okPct),
    warnPct: useFormula("sec", "warn_pct", SEC_DEFAULTS.warnPct),
  };
}

export function FormulaRuntime({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["formulas"],
    queryFn: formulasApi.list,
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const map: FormulaMap = {};
  for (const row of query.data || []) {
    map[row.key] = {};
    for (const param of row.params) map[row.key][param.name] = param.value;
  }
  return <FormulaContext.Provider value={map}>{children}</FormulaContext.Provider>;
}
