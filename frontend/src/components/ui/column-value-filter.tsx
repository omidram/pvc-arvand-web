"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const BLANK = "";
const SIZE_KEY = "pvc-dt-value-filter-size";
const MIN_W = 200;
const MIN_H = 160;

type Size = { w: number; h: number };

function readSize(): Size {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return { w: 260, h: 320 };
    const parsed = JSON.parse(raw) as Size;
    return {
      w: Math.max(MIN_W, Number(parsed.w) || 260),
      h: Math.max(MIN_H, Number(parsed.h) || 320),
    };
  } catch {
    return { w: 260, h: 320 };
  }
}

function writeSize(size: Size) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    /* ignore quota */
  }
}

function clampSize(size: Size): Size {
  const maxW = Math.max(MIN_W, window.innerWidth - 16);
  const maxH = Math.max(MIN_H, window.innerHeight - 16);
  return {
    w: Math.min(maxW, Math.max(MIN_W, size.w)),
    h: Math.min(maxH, Math.max(MIN_H, size.h)),
  };
}

/** Excel-like unique-value checkbox filter for one datasheet column. */
export function ColumnValueFilter({
  options,
  getOptions,
  selected,
  active,
  onChange,
}: {
  options?: string[];
  /** Lazy unique values — called once when the menu opens. */
  getOptions?: () => string[];
  /** null = all values allowed (no value filter). */
  selected: string[] | null;
  active?: boolean;
  onChange: (next: string[] | null) => void;
}) {
  const { t, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [lazyOptions, setLazyOptions] = useState<string[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [size, setSize] = useState<Size>({ w: 260, h: 320 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; w: number; h: number; rtl: boolean } | null>(null);

  const optionsList = options ?? lazyOptions ?? [];
  const rtl = dir === "rtl";

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    if (getOptions && lazyOptions == null) {
      setLazyOptions(getOptions());
    }
    const next = clampSize(readSize());
    setSize(next);
    const rect = btnRef.current.getBoundingClientRect();
    let left = rtl ? rect.right - next.w : rect.left;
    if (left + next.w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - next.w - 8);
    if (left < 8) left = 8;
    let top = rect.bottom + 2;
    if (top + next.h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - next.h - 8);
    setPos({ top, left });
  }, [open, getOptions, lazyOptions, rtl]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setLazyOptions(null);
      return;
    }
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onOutsideScroll(e: Event) {
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onOutsideScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onOutsideScroll, true);
    };
  }, [open]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const next = clampSize({
        w: drag.w + (drag.rtl ? -dx : dx),
        h: drag.h + dy,
      });
      setSize(next);
      setPos((current) => {
        if (!current) return current;
        let left = current.left;
        if (drag.rtl) left = current.left + (drag.w - next.w);
        if (left < 8) left = 8;
        if (left + next.w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - next.w - 8);
        let top = current.top;
        if (top + next.h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - next.h - 8);
        return { top, left };
      });
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      setSize((current) => {
        writeSize(current);
        return current;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const selectedSet = useMemo(() => (selected == null ? null : new Set(selected)), [selected]);
  const allSelected = selectedSet == null || (optionsList.length > 0 && optionsList.every((v) => selectedSet.has(v)));

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return optionsList;
    return optionsList.filter((value) => {
      const label = value === BLANK ? t("access.blankValue") : value;
      return label.toLowerCase().includes(needle);
    });
  }, [optionsList, q, t]);

  function toggleAll(on: boolean) {
    onChange(on ? null : []);
  }

  function toggleOne(value: string, on: boolean) {
    const base = selectedSet == null ? new Set(optionsList) : new Set(selectedSet);
    if (on) base.add(value);
    else base.delete(value);
    if (base.size === optionsList.length && optionsList.every((v) => base.has(v))) onChange(null);
    else onChange([...base]);
  }

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="dt-value-filter-menu"
            role="listbox"
            style={{ top: pos.top, left: pos.left, width: size.w, height: size.h }}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="dt-value-filter-tools">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("access.valueSearch")}
                className="dt-value-filter-search"
                autoFocus
              />
              <div className="dt-value-filter-actions">
                <button type="button" onClick={() => toggleAll(true)}>
                  {t("access.selectAllValues")}
                </button>
                <button type="button" onClick={() => toggleAll(false)}>
                  {t("access.deselectAllValues")}
                </button>
              </div>
            </div>
            <div className="dt-value-filter-list" onWheel={(e) => e.stopPropagation()}>
              {visible.length === 0 ? (
                <div className="dt-value-filter-empty">{t("common.noRecordsFound")}</div>
              ) : (
                visible.map((value) => {
                  const checked = selectedSet == null ? true : selectedSet.has(value);
                  const label = value === BLANK ? t("access.blankValue") : value;
                  return (
                    <label key={value || "__blank__"} className="dt-value-filter-item">
                      <input type="checkbox" checked={checked} onChange={(e) => toggleOne(value, e.target.checked)} />
                      <span title={label}>{label}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="dt-value-filter-foot">
              <button type="button" className="access-nav-btn" onClick={() => setOpen(false)}>
                {t("common.close")}
              </button>
            </div>
            <button
              type="button"
              className={`dt-value-filter-grip ${rtl ? "is-rtl" : ""}`}
              aria-label={t("access.resizeFilter")}
              title={t("access.resizeFilter")}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, rtl };
              }}
            />
          </div>,
          document.body
        )
      : null;

  return (
    <div className="dt-value-filter">
      <button
        ref={btnRef}
        type="button"
        className={`dt-value-filter-btn${active || (selected != null && !allSelected) ? " is-active" : ""}`}
        title={t("access.valueFilter")}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  );
}

export function uniqueColumnValues(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const value of values) set.add(value);
  return [...set].sort((a, b) => {
    if (a === BLANK) return -1;
    if (b === BLANK) return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });
}
