"use client";

import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { elementsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export function padCellPosition(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.trim();
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 1 || n > 168) return raw.trim();
  return String(n).padStart(3, "0");
}

export function useCellOccupancy(electrolyzer: string, excludeId?: number | null) {
  return useQuery({
    queryKey: ["elements", "free-positions", electrolyzer, excludeId ?? 0],
    queryFn: () => elementsApi.freePositions(electrolyzer, excludeId),
    enabled: Boolean(electrolyzer.trim()),
    staleTime: 15_000,
  });
}

type PositionComboProps = {
  electrolyzer: string;
  value: string;
  onChange: (value: string) => void;
  excludeId?: number | null;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  variant?: "default" | "access";
  id?: string;
  onBlur?: (value: string) => void;
};

/** Empty 001–168 cells for the chosen electrolyzer; the value can still be typed by hand. */
export function PositionCombo({
  electrolyzer,
  value,
  onChange,
  excludeId,
  disabled,
  required,
  className,
  variant = "default",
  id,
  onBlur,
}: PositionComboProps) {
  const { t } = useI18n();
  const autoId = useId();
  const listId = `pos-empty-${autoId.replace(/:/g, "")}`;
  const inputId = id || listId;
  const occ = useCellOccupancy(electrolyzer, excludeId);
  const padded = padCellPosition(value);
  const occupant = useMemo(() => {
    if (!padded || !occ.data) return null;
    return occ.data.occupied.find((row) => row.position === padded) ?? null;
  }, [occ.data, padded]);

  return (
    <div className="pos-combo">
      <input
        id={inputId}
        list={listId}
        value={value}
        required={required}
        disabled={disabled || !electrolyzer.trim()}
        inputMode="numeric"
        placeholder={t("elements.positionPlaceholder")}
        className={cn(variant === "access" ? "access-inset-field h-[22px] py-0 text-[11px] w-full" : "access-inset-field w-full", occupant && "is-occupied", className)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const next = padCellPosition(value);
          if (next !== value) onChange(next);
          onBlur?.(next);
        }}
        autoComplete="off"
      />
      <datalist id={listId}>
        {(occ.data?.empty ?? []).map((pos) => (
          <option key={pos} value={pos} />
        ))}
      </datalist>
      {electrolyzer.trim() && occ.data ? (
        <small className="pos-combo-hint">{t("elements.positionEmptyHint", { n: occ.data.empty.length })}</small>
      ) : (
        <small className="pos-combo-hint">{t("elements.positionPickElectrolyzer")}</small>
      )}
      {occupant ? (
        <small className="pos-combo-err">
          {t("elements.positionOccupied", { cell: `${electrolyzer}-${occupant.position}`, nr: occupant.element_nr || occupant.id })}
        </small>
      ) : null}
    </div>
  );
}
