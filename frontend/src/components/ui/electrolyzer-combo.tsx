"use client";

import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { relationsApi } from "@/lib/endpoints";
import {
  compareElectrolyzers,
  formatElectrolyzer,
  allElectrolyzers,
  isValidElectrolyzerName,
} from "@/lib/plant-topology";
import type { FieldDef } from "@/components/ui/resource-form";
import { cn } from "@/lib/utils";

/** Plant electrolyzer designations (A1, B2, …) — topology baseline + Settings / Assembly. */
export function useElectrolyzerNames(extra?: readonly string[]) {
  const query = useQuery({
    queryKey: ["relations", "electrolyzers"],
    queryFn: () => relationsApi.lookup("electrolyzers"),
  });
  const extraKey = extra?.join("\u0000") ?? "";
  return useMemo(() => {
    const merged: string[] = [];
    // Always start from the full cell-room list so combos never collapse to one item
    // (HTML datalist also filters by typed value — use <select> in ElectrolyzerCombo).
    for (const raw of [...allElectrolyzers(), ...(query.data || []), ...(extra || [])]) {
      if (!isValidElectrolyzerName(raw)) continue;
      const name = formatElectrolyzer(raw);
      if (name) merged.push(name);
    }
    return Array.from(new Set(merged)).sort(compareElectrolyzers);
  }, [query.data, extraKey]);
}

export function electrolyzerFieldOptions(names: string[]) {
  return names.map((value) => ({ label: value, value }));
}

export function electrolyzerFieldDef(label: string, names: string[], extra?: Partial<FieldDef>): FieldDef {
  return {
    name: "electrolyzer",
    label,
    type: "select",
    options: electrolyzerFieldOptions(names),
    ...extra,
  };
}

type ElectrolyzerComboProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** Access hub inset field styling */
  variant?: "default" | "access";
  /** Extra names (e.g. from a live board response) merged into the list */
  extraOptions?: readonly string[];
  id?: string;
  "aria-label"?: string;
};

/**
 * Full electrolyzer dropdown (Access-style). Uses &lt;select&gt; so the browser
 * always shows every option — unlike &lt;datalist&gt; which filters to the current value
 * (e.g. only "A1" when A1 is selected).
 */
export function ElectrolyzerCombo({
  value,
  onChange,
  disabled,
  required,
  placeholder,
  className,
  variant = "default",
  extraOptions,
  id,
  "aria-label": ariaLabel,
}: ElectrolyzerComboProps) {
  const autoId = useId();
  const selectId = id || `electrolyzer-${autoId.replace(/:/g, "")}`;
  const names = useElectrolyzerNames(extraOptions);
  const display = formatElectrolyzer(value) || value;
  const options = useMemo(() => {
    if (display && !names.includes(display)) return [...names, display];
    return names;
  }, [names, display]);

  return (
    <select
      id={selectId}
      required={required}
      disabled={disabled}
      value={display || ""}
      aria-label={ariaLabel}
      className={cn(
        variant === "access" ? "access-inset-field" : "access-inset-field w-full",
        className
      )}
      onChange={(e) => onChange(formatElectrolyzer(e.target.value) || e.target.value)}
    >
      {!display ? <option value="">{placeholder || "—"}</option> : null}
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}
