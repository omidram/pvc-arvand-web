"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

const BLANK = "";

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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [lazyOptions, setLazyOptions] = useState<string[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const optionsList = options ?? lazyOptions ?? [];

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    if (getOptions && lazyOptions == null) {
      setLazyOptions(getOptions());
    }
    const rect = btnRef.current.getBoundingClientRect();
    const width = Math.min(280, Math.max(220, window.innerWidth - 16));
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    const top = Math.min(rect.bottom + 2, window.innerHeight - 120);
    setPos({ top, left, width });
  }, [open, getOptions, lazyOptions]);

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
      // Capture-phase scroll fires for the filter list too — ignore those so the menu stays open.
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onOutsideScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onOutsideScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

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
            style={{ top: pos.top, left: pos.left, width: pos.width }}
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
