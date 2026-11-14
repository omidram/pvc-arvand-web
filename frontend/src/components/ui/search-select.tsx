"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; group?: string };

const LIMIT = 40;

function fold(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

/** Type-to-filter list. A native select only jumps to the first letter, which is useless once stock is large. */
export function SearchSelect({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  compact,
  className,
  name,
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  name?: string;
}) {
  const { t } = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const picked = options.find((opt) => opt.value === value);
  const display = picked?.label || value;
  const { visible, hidden } = useMemo(() => {
    const needle = fold(query.trim());
    const matched = needle
      ? options.filter((opt) => fold(`${opt.label} ${opt.value} ${opt.group ?? ""}`).includes(needle))
      : options;
    return { visible: matched.slice(0, LIMIT), hidden: Math.max(0, matched.length - LIMIT) };
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const maxHeight = Math.max(120, Math.min(280, Math.max(below, above)));
      const openUp = below < 160 && above > below;
      const width = Math.min(Math.max(r.width, 240), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setBox({
        top: openUp ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4,
        left,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const node = event.target as Node;
      if (rootRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open, visible]);

  function pick(opt: SearchOption) {
    onChange(opt.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHi((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHi((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const opt = visible[hi];
      if (opt) pick(opt);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  let lastGroup = "";
  const menu =
    open && box && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            className="search-select-menu"
            style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {visible.length ? (
              visible.map((opt, index) => {
                const head = opt.group && opt.group !== lastGroup ? opt.group : "";
                if (opt.group) lastGroup = opt.group;
                return (
                  <Fragment key={`${opt.group ?? ""}-${opt.value}-${index}`}>
                    {head ? <div className="search-select-group">{head}</div> : null}
                    <button
                      type="button"
                      role="option"
                      data-i={index}
                      aria-selected={opt.value === value}
                      className={cn("search-select-opt", index === hi && "is-hi", opt.value === value && "is-picked")}
                      onMouseEnter={() => setHi(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pick(opt);
                      }}
                    >
                      {opt.label}
                    </button>
                  </Fragment>
                );
              })
            ) : (
              <div className="search-select-empty">{t("searchSelect.empty")}</div>
            )}
            {hidden > 0 ? <div className="search-select-more">{t("searchSelect.more", { n: hidden })}</div> : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={cn("search-select", compact && "is-compact", className)}>
      <input
        ref={inputRef}
        name={name}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        placeholder={placeholder || t("searchSelect.placeholder")}
        value={open ? query : display}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
          setQuery("");
          const index = options.findIndex((opt) => opt.value === value);
          setHi(index >= 0 && index < LIMIT ? index : 0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
      />
      {value && !disabled ? (
        <button
          type="button"
          className="search-select-clear"
          aria-label={t("searchSelect.clear")}
          onMouseDown={(event) => {
            event.preventDefault();
            onChange("");
            setQuery("");
            setOpen(true);
            setHi(0);
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      ) : null}
      {menu}
    </div>
  );
}
