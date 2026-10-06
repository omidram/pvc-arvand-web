"use client";

import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { relationsApi } from "@/lib/endpoints";
import { cn } from "@/lib/utils";

/**
 * Access frmTabelleLeistungstests Part of Plant combo:
 * Teilanlagenbezeichnung UNION Gesamtanlagenbezeichnung (current language).
 */
export function usePlantPartOptions(extra?: readonly string[]) {
  const query = useQuery({
    queryKey: ["relations", "plant-parts"],
    queryFn: () => relationsApi.lookup("plant-parts"),
  });
  const extraKey = extra?.join("\u0000") ?? "";

  return useMemo(() => {
    const names: string[] = [];
    for (const raw of [...(query.data || []), ...(extra || [])]) {
      const label = (raw || "").trim();
      if (label) names.push(label);
    }
    return Array.from(new Set(names));
  }, [query.data, extraKey]);
}

type PlantPartComboProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  variant?: "default" | "access";
  extraOptions?: readonly string[];
  id?: string;
  "aria-label"?: string;
};

/** Part of Plant dropdown (Access Anlagenteil / Teilanlage). */
export function PlantPartCombo({
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
}: PlantPartComboProps) {
  const autoId = useId();
  const selectId = id || `plant-part-${autoId.replace(/:/g, "")}`;
  const names = usePlantPartOptions(extraOptions);
  const display = (value || "").trim();
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
      className={cn(variant === "access" ? "access-inset-field" : "access-inset-field w-full", className)}
      onChange={(e) => onChange(e.target.value)}
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
