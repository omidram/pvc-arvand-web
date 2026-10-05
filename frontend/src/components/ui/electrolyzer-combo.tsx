"use client";

import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { relationsApi } from "@/lib/endpoints";
import { compareElectrolyzers, formatElectrolyzer } from "@/lib/plant-topology";
import type { FieldDef } from "@/components/ui/resource-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Plant electrolyzer designations (A1, B2, …) from Settings / Assembly data. */
export function useElectrolyzerNames(extra?: readonly string[]) {
  const query = useQuery({
    queryKey: ["relations", "electrolyzers"],
    queryFn: () => relationsApi.lookup("electrolyzers"),
  });
  const extraKey = extra?.join("\u0000") ?? "";
  return useMemo(() => {
    const merged: string[] = [];
    for (const raw of [...(query.data || []), ...(extra || [])]) {
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
    type: "combo",
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
  const listId = id || `electrolyzer-list-${autoId.replace(/:/g, "")}`;
  const names = useElectrolyzerNames(extraOptions);
  const display = formatElectrolyzer(value) || value;

  function commit(raw: string) {
    const next = formatElectrolyzer(raw) || raw;
    onChange(next);
  }

  const shared = {
    list: listId,
    required,
    disabled,
    value: display,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => commit(e.target.value),
    autoComplete: "off" as const,
    "data-lpignore": "true",
    "data-1p-ignore": "true",
    "data-form-type": "other",
    "aria-label": ariaLabel,
  };

  return (
    <>
      {variant === "access" ? (
        <input
          {...shared}
          className={cn("access-inset-field", className)}
          placeholder={placeholder}
        />
      ) : (
        <Input {...shared} className={className} placeholder={placeholder} />
      )}
      <datalist id={listId}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
        {display && !names.includes(display) ? <option value={display} /> : null}
      </datalist>
    </>
  );
}
