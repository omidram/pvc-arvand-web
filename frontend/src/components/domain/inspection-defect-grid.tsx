"use client";

import { useMemo } from "react";

/** CZ-03 Uhde grid: rows A–M skipping I, columns 18→1. One empty cell frames every side. */
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

type Props = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  title?: string;
  /** Hide the colour key. The paper form shows that hint once. */
  legend?: boolean;
  /** Smaller cells for the printed CZ-03 sheet. */
  dense?: boolean;
};

export function InspectionDefectGrid({ value, onChange, disabled, title, legend = true, dense = false }: Props) {
  const map = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value || {})) {
      if (v == null || v === "") continue;
      out[k] = String(v);
    }
    return out;
  }, [value]);

  function writeCell(key: string, code: string) {
    if (disabled) return;
    const next = { ...map };
    if (!code) delete next[key];
    else next[key] = code;
    onChange(next);
  }

  const filled = Object.keys(map).length;
  const padCount = COLS.length + 2;
  const cell = dense
    ? "box-border h-[18px] w-full border border-[#111] bg-white p-0 text-center text-[9px] font-bold text-[#111]"
    : "box-border h-[18px] w-full border border-[#a0a0a0] bg-white p-0 text-center text-[9px] font-bold";
  const head = dense ? "p-0 text-center text-[9px] font-bold text-[#111]" : "p-0.5 text-center font-normal text-[var(--win-muted)]";

  function pad(key: string) {
    return <td key={key} className="p-0"><div className={`${cell} insp-pad`} /></td>;
  }

  return (
    <div className={legend ? "space-y-1" : undefined}>
      {title ? <div className="text-[11px] font-bold">{title}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[9px] leading-none">
          <tbody>
            <tr>{Array.from({ length: padCount + 1 }, (_, i) => pad(`top-${i}`))}</tr>
            <tr>
              {pad("head-l")}
              <th className={head} />
              {COLS.map((c) => (
                <th key={c} className={head}>
                  {c}
                </th>
              ))}
              {pad("head-r")}
            </tr>
            {ROWS.map((row) => (
              <tr key={row}>
                {pad(`${row}-l`)}
                <td className={head}>{row}</td>
                {COLS.map((col) => {
                  const key = cellKey(row, col);
                  const code = map[key] || "";
                  return (
                    <td key={key} className="p-0">
                      <select
                        aria-label={key}
                        title={`${key} — choose w, pm, vh or T. Delete clears the cell.`}
                        disabled={disabled}
                        value={CODES.includes(code as (typeof CODES)[number]) ? code : ""}
                        onChange={(e) => writeCell(key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Delete" || e.key === "Backspace") {
                            e.preventDefault();
                            writeCell(key, "");
                          }
                        }}
                        className={`${cell} insp-code`}
                        style={code ? { background: CODE_COLORS[code] || "#dfe6e9" } : undefined}
                      >
                        <option value=""> </option>
                        <option value="w">w</option>
                        <option value="pm">pm</option>
                        <option value="vh">vh</option>
                        <option value="T">T</option>
                      </select>
                    </td>
                  );
                })}
                {pad(`${row}-r`)}
              </tr>
            ))}
            <tr>{Array.from({ length: padCount + 1 }, (_, i) => pad(`bot-${i}`))}</tr>
          </tbody>
        </table>
      </div>
      {legend ? (
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
      ) : null}
    </div>
  );
}
