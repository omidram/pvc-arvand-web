"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { arrangementsApi, voltageReadingsApi } from "@/lib/endpoints";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Cell positions of one electrolyzer: arrangement ranges plus positions seen in voltage readings. */
export function useCellOptions(electrolyzer: string): string[] {
  const arrangements = useQuery({
    queryKey: ["arrangements"],
    queryFn: () => arrangementsApi.list(),
    staleTime: 5 * 60_000,
  });
  const readings = useQuery({
    queryKey: ["voltage-readings", "cell-positions", electrolyzer],
    queryFn: () => voltageReadingsApi.list({ electrolyzer, limit: 2000 }),
    enabled: Boolean(electrolyzer),
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    if (!electrolyzer) return [];
    const want = formatElectrolyzer(electrolyzer) || electrolyzer;
    const numeric = new Set<number>();
    const other = new Set<string>();
    for (const a of arrangements.data || []) {
      if ((formatElectrolyzer(a.name) || a.name) !== want) continue;
      const start = Number(a.start_position);
      const end = Number(a.end_position);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start < 1000) {
        for (let p = start; p <= end; p++) numeric.add(p);
      }
    }
    for (const r of readings.data || []) {
      const raw = String(r.position ?? "").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) numeric.add(n);
      else other.add(raw);
    }
    return [
      ...Array.from(numeric).sort((a, b) => a - b).map(String),
      ...Array.from(other).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ];
  }, [arrangements.data, readings.data, electrolyzer]);
}

/** Same cell when positions match as text or as numbers ("012" == "12"). */
export function samePosition(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = Number(x);
  const ny = Number(y);
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
}

export function CellSelect({
  electrolyzer,
  value,
  onChange,
  className,
  disabled,
}: {
  electrolyzer: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const options = useCellOptions(electrolyzer);

  useEffect(() => {
    if (options.length && !options.includes(value)) onChange(options[0]);
  }, [options, value, onChange]);

  return (
    <select
      className={cn("access-inset-field", className)}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t("menus.cellNo")}
    >
      {options.length === 0 ? <option value="">—</option> : null}
      {options.map((p) => (
        <option key={p} value={p}>
          {t("menus.cellNo")} {p}
        </option>
      ))}
    </select>
  );
}

/** Individual Element picker: the cell is the choice; the electrolyzer only says which one it belongs to. */
export function CellPicker({
  electrolyzer,
  position,
  onElectrolyzerChange,
  onPositionChange,
}: {
  electrolyzer: string;
  position: string;
  onElectrolyzerChange: (value: string) => void;
  onPositionChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-1 space-y-1">
      <CellSelect electrolyzer={electrolyzer} value={position} onChange={onPositionChange} className="w-full" />
      <div className="flex items-center gap-1 text-[11px]">
        <span className="shrink-0">{t("menus.inElectrolyzer")}</span>
        <ElectrolyzerCombo
          variant="access"
          className="w-full"
          value={electrolyzer}
          onChange={(next) => {
            onElectrolyzerChange(next);
            onPositionChange("");
          }}
        />
      </div>
    </div>
  );
}
