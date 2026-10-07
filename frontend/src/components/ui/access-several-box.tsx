"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CellSelect } from "@/components/ui/cell-picker";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { cn } from "@/lib/utils";

/** Parse Access-style several lists: "A1, B2 C1" → ["A1","B2","C1"]. */
export function parseSeveralList(csv: string): string[] {
  return csv
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type AccessSeveralBoxProps = {
  values: string[];
  onChange: (values: string[]) => void;
  options?: readonly string[];
  /** free = type/pick CSV; electrolyzer = combo rows; pair = electrolyzer+position */
  mode?: "free" | "electrolyzer" | "pair";
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * Access "Several …" picker (subfrmElektrolyseureUnCeSpc / GruppenUN / Elemente):
 * selectable from catalogue and/or free typing.
 */
export function AccessSeveralBox({
  values,
  onChange,
  options = [],
  mode = "free",
  placeholder = "A1, B2, …",
  disabled,
  className,
  "aria-label": ariaLabel,
}: AccessSeveralBoxProps) {
  const listId = useId().replace(/:/g, "");
  const [draft, setDraft] = useState("");
  const [text, setText] = useState(values.join(", "));
  const [editing, setEditing] = useState(false);
  const uniqueOptions = useMemo(() => Array.from(new Set(options.filter(Boolean))), [options]);

  useEffect(() => {
    if (!editing) setText(values.join(", "));
  }, [values, editing]);

  function commitText(raw: string) {
    setText(raw);
    onChange(parseSeveralList(raw));
    setEditing(false);
  }

  function addValue(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (values.includes(v)) {
      setDraft("");
      return;
    }
    const next = [...values, v];
    onChange(next);
    setDraft("");
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function updateAt(index: number, value: string) {
    onChange(values.map((v, i) => (i === index ? value : v)).filter((v, i, arr) => v || arr.length === 1));
  }

  if (mode === "electrolyzer") {
    const rows = values.length ? values : [""];
    return (
      <div className={cn("access-sunken mt-1 space-y-1 p-1", className)} aria-label={ariaLabel}>
        {rows.map((item, index) => (
          <div key={index} className="flex items-center gap-1">
            <ElectrolyzerCombo
              variant="access"
              className="min-w-0 flex-1"
              value={item}
              disabled={disabled}
              onChange={(v) => {
                if (!values.length) onChange(v ? [v] : []);
                else updateAt(index, v);
              }}
            />
            {values.length > 0 ? (
              <button type="button" className="access-menu-btn !min-w-0 px-1 text-[11px]" disabled={disabled} onClick={() => removeAt(index)}>
                ×
              </button>
            ) : null}
          </div>
        ))}
        <div className="flex gap-1">
          <button
            type="button"
            className="access-menu-btn !w-auto px-2 text-[11px]"
            disabled={disabled}
            onClick={() => onChange([...values.filter(Boolean), ""])}
          >
            +
          </button>
          <input
            className="access-inset-field min-w-0 flex-1 text-[11px]"
            placeholder={placeholder}
            disabled={disabled}
            value={draft}
            list={`${listId}-dl`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addValue(draft);
              }
            }}
          />
          <datalist id={`${listId}-dl`}>
            {uniqueOptions.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </div>
      </div>
    );
  }

  if (mode === "pair") {
    const rows = values.length ? values : [""];
    return (
      <div className={cn("access-sunken mt-1 space-y-1 p-1", className)} aria-label={ariaLabel}>
        {rows.map((item, index) => {
          const [el, pos = ""] = item.includes("|") ? item.split("|") : [item, ""];
          return (
            <div key={index} className="flex items-center gap-1">
              <ElectrolyzerCombo
                variant="access"
                className="min-w-0 flex-1"
                value={el}
                disabled={disabled}
                onChange={(v) => {
                  const next = `${v}|`;
                  if (!values.length) onChange(v ? [next] : []);
                  else updateAt(index, next);
                }}
              />
              <CellSelect
                electrolyzer={el}
                className="w-24 text-[11px]"
                disabled={disabled || !el}
                value={pos}
                onChange={(p) => {
                  if (p === pos) return;
                  const next = `${el}|${p}`;
                  if (!values.length) onChange(el || p ? [next] : []);
                  else updateAt(index, next);
                }}
              />
              {values.length > 0 ? (
                <button type="button" className="access-menu-btn !min-w-0 px-1 text-[11px]" disabled={disabled} onClick={() => removeAt(index)}>
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="access-menu-btn !w-auto px-2 text-[11px]"
          disabled={disabled}
          onClick={() => onChange([...values.filter(Boolean), "|"])}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className={cn("mt-1 space-y-1", className)} aria-label={ariaLabel}>
      <input
        className="access-inset-field w-full"
        list={`${listId}-dl`}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText((e.target as HTMLInputElement).value);
          }
        }}
      />
      <datalist id={`${listId}-dl`}>
        {uniqueOptions.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {values.map((v, i) => (
            <button
              key={`${v}-${i}`}
              type="button"
              className="access-sunken px-1 text-[10px]"
              disabled={disabled}
              onClick={() => removeAt(i)}
              title="Remove"
            >
              {v} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
