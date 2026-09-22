"use client";

import { useMemo } from "react";

/** CZ-03 Uhde grid: rows A–M skipping I, columns 18→1. Defect codes: w / pm / vh / T */
const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"] as const;
const COLS = Array.from({ length: 18 }, (_, i) => 18 - i);
const CODES = ["", "w", "pm", "vh", "T"] as const;

const CODE_COLORS: Record<string, string> = {
  w: "#f5d76e",
  pm: "#f0ad4e",
  vh: "#e74c3c",
  T: "#9b59b6",
};

function cellKey(row: string, col: number) {
  return `${row}${col}`;
}

function nextCode(current: string): string {
  const idx = CODES.indexOf(current as (typeof CODES)[number]);
  const next = CODES[(idx + 1) % CODES.length];
  return next;
}

type Props = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  title?: string;
};

export function InspectionDefectGrid({ value, onChange, disabled, title }: Props) {
  const map = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value || {})) {
      if (v == null || v === "") continue;
      out[k] = String(v);
    }
    return out;
  }, [value]);

  function setCell(key: string) {
    if (disabled) return;
    const cur = map[key] || "";
    const n = nextCode(cur);
    const next = { ...map };
    if (!n) delete next[key];
    else next[key] = n;
    onChange(next);
  }

  const filled = Object.keys(map).length;

  return (
    <div className="space-y-1">
      {title ? <div className="text-[11px] font-bold">{title}</div> : null}
      <div className="overflow-x-auto">
        <table className="border-collapse text-[9px] leading-none">
          <thead>
            <tr>
              <th className="w-4 p-0.5 text-[var(--win-muted)]" />
              {COLS.map((c) => (
                <th key={c} className="w-[18px] p-0.5 text-center font-normal text-[var(--win-muted)]">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row}>
                <td className="p-0.5 text-center font-bold text-[var(--win-muted)]">{row}</td>
                {COLS.map((col) => {
                  const key = cellKey(row, col);
                  const code = map[key] || "";
                  return (
                    <td key={key} className="p-0">
                      <button
                        type="button"
                        title={`${key}${code ? `: ${code}` : ""} — click to cycle w / pm / vh / T`}
                        disabled={disabled}
                        onClick={() => setCell(key)}
                        className="flex h-[16px] w-[18px] items-center justify-center border border-[#a0a0a0] bg-white text-[8px] font-bold uppercase disabled:cursor-default"
                        style={code ? { background: CODE_COLORS[code] || "#dfe6e9" } : undefined}
                      >
                        {code}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--win-muted)]">
        <span>CZ-03 codes:</span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-[#808080]" style={{ background: CODE_COLORS.w }} /> w wrinkle
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-[#808080]" style={{ background: CODE_COLORS.pm }} /> pm pressure
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-[#808080]" style={{ background: CODE_COLORS.vh }} /> vh hole
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-[#808080]" style={{ background: CODE_COLORS.T }} /> T tear
        </span>
        <span className="ms-auto">{filled} marked</span>
      </div>
    </div>
  );
}
