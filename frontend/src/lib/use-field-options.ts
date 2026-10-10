"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fieldOptionsApi } from "@/lib/endpoints";
import type { FieldDef } from "@/components/ui/resource-form";

export type ComboOption = { label: string; value: string };

/** Union of several value lists, case-insensitive de-duplicated, first spelling wins. */
export function mergeOptions(...lists: (readonly (string | null | undefined)[] | undefined)[]): ComboOption[] {
  const seen = new Set<string>();
  const out: ComboOption[] = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: value, value });
    }
  }
  return out;
}

/**
 * Dropdown values of a table's combo fields: values defined in Settings → Field lists plus
 * every value already used by a record. `opts("manufacturer")` feeds a `type: "combo"` field.
 */
export function useFieldOptions(table: string) {
  const query = useQuery({
    queryKey: ["field-options", "values", table],
    queryFn: () => fieldOptionsApi.values(table),
    staleTime: 60_000,
  });
  const opts = useCallback(
    (field: string, ...extra: (readonly (string | null | undefined)[] | undefined)[]): ComboOption[] =>
      mergeOptions(query.data?.[field], ...extra),
    [query.data]
  );
  return { opts, isLoading: query.isLoading };
}

/** Turn the named plain-text fields into combos fed by `opts`. */
export function withCombos(
  fields: FieldDef[],
  opts: (field: string) => ComboOption[],
  names: readonly string[]
): FieldDef[] {
  const wanted = new Set(names);
  return fields.map((f) => (wanted.has(f.name) ? { ...f, type: "combo" as const, options: opts(f.name) } : f));
}
