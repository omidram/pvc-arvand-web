"use client";

import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import {
  JALALI_MONTHS_EN,
  JALALI_MONTHS_FA,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  parseIsoDateParts,
  parseIsoTime,
  toIsoDate,
  type Ymd,
} from "@/lib/calendar/jalali";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "date" | "datetime-local";
};

const WEEK_EN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function emitChange(onChange: DateInputProps["onChange"], name: string | undefined, value: string) {
  if (!onChange) return;
  onChange({
    target: { value, name },
    currentTarget: { value, name },
  } as ChangeEvent<HTMLInputElement>);
}

function displayDate(iso: string, shamsi: boolean): string {
  const g = parseIsoDateParts(iso);
  if (!g) return "";
  if (!shamsi) return `${g.month}/${g.day}/${g.year}`;
  const j = gregorianToJalali(g.year, g.month, g.day);
  return `${j.year}/${pad(j.month)}/${pad(j.day)}`;
}

function parseTyped(text: string, shamsi: boolean): string | null {
  const raw = text.trim();
  if (!raw) return "";
  const ymd = raw.match(/^(\d{4})[/.\\-](\d{1,2})[/.\\-](\d{1,2})$/);
  const mdy = raw.match(/^(\d{1,2})[/.\\-](\d{1,2})[/.\\-](\d{4})$/);
  try {
    if (shamsi && ymd) {
      const g = jalaliToGregorian(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
      return toIsoDate(g);
    }
    if (!shamsi && ymd) return toIsoDate({ year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) });
    if (!shamsi && mdy) return toIsoDate({ year: Number(mdy[3]), month: Number(mdy[1]), day: Number(mdy[2]) });
    if (shamsi && mdy) {
      const g = jalaliToGregorian(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
      return toIsoDate(g);
    }
  } catch {
    return null;
  }
  return null;
}

function shiftMonth(cursor: Ymd, shamsi: boolean, delta: number): Ymd {
  if (shamsi) {
    let month = cursor.month + delta;
    let year = cursor.year;
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    return { year, month, day: 1 };
  }
  const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: 1 };
}

export function DateInput({
  type = "date",
  value,
  onChange,
  className,
  disabled,
  required,
  name,
  id,
  autoComplete = "off",
}: DateInputProps) {
  const { locale } = useI18n();
  const { isShamsi } = useCalendar();
  const iso = typeof value === "string" ? value : "";
  const time = type === "datetime-local" && iso ? parseIsoTime(iso) || "00:00" : "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => displayDate(iso, isShamsi));
  const [cursor, setCursor] = useState<Ymd>({ year: 1400, month: 1, day: 1 });
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setText(displayDate(iso, isShamsi));
  }, [iso, isShamsi]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function commit(nextIso: string, nextTime = time) {
    const valueOut = type === "datetime-local" && nextIso ? `${nextIso}T${nextTime || "00:00"}` : nextIso;
    emitChange(onChange, name, valueOut);
    setText(displayDate(nextIso, isShamsi));
  }

  function openPopup() {
    if (disabled) return;
    const g = parseIsoDateParts(iso) ?? (() => {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
    })();
    const view = isShamsi ? gregorianToJalali(g.year, g.month, g.day) : g;
    setCursor({ year: view.year, month: view.month, day: 1 });
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const top = rect.bottom + 4 + 280 > window.innerHeight ? Math.max(8, rect.top - 284) : rect.bottom + 4;
      const left = Math.min(rect.left, window.innerWidth - 260);
      setPos({ top, left });
    }
    setOpen(true);
  }

  const months = locale === "fa" ? JALALI_MONTHS_FA : isShamsi ? JALALI_MONTHS_EN : [];
  const gregorianMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabel = isShamsi ? months[cursor.month - 1] : gregorianMonths[cursor.month - 1];
  const week = locale === "fa" ? ["ی", "د", "س", "چ", "پ", "ج", "ش"] : WEEK_EN;
  const selected = parseIsoDateParts(iso);
  const selectedView = selected ? (isShamsi ? gregorianToJalali(selected.year, selected.month, selected.day) : selected) : null;

  const firstG = isShamsi ? jalaliToGregorian(cursor.year, cursor.month, 1) : { year: cursor.year, month: cursor.month, day: 1 };
  const firstWeekday = new Date(firstG.year, firstG.month - 1, firstG.day).getDay();
  const lead = isShamsi ? (firstWeekday + 1) % 7 : firstWeekday;
  const days = isShamsi ? jalaliMonthLength(cursor.year, cursor.month) : new Date(cursor.year, cursor.month, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  function pick(day: number) {
    const isoDate = isShamsi ? toIsoDate(jalaliToGregorian(cursor.year, cursor.month, day)) : toIsoDate({ year: cursor.year, month: cursor.month, day });
    commit(isoDate);
    setOpen(false);
  }

  return (
    <span ref={rootRef} className="relative inline-flex items-center gap-1" dir="ltr">
      <input
        id={id}
        name={name}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        data-lpignore="true"
        data-1p-ignore="true"
        data-form-type="other"
        className={cn("access-inset-field w-[108px]", className)}
        value={text}
        placeholder={isShamsi ? "1405/01/01" : "M/D/YYYY"}
        onChange={(e) => setText(e.target.value)}
        onFocus={openPopup}
        onBlur={() => {
          const parsed = parseTyped(text, isShamsi);
          if (parsed === null) {
            setText(displayDate(iso, isShamsi));
            return;
          }
          commit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        className="access-toolbar-btn h-[22px] w-[22px] px-0 text-[10px]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openPopup())}
        aria-label={isShamsi ? "Shamsi calendar" : "Gregorian calendar"}
      >
        ▾
      </button>
      {type === "datetime-local" ? (
        <input
          type="time"
          disabled={disabled || !iso}
          className="access-inset-field w-[92px]"
          value={time}
          onChange={(e) => {
            const dateIso = parseIsoDateParts(iso) ? iso.slice(0, 10) : "";
            if (dateIso) commit(dateIso, e.target.value);
          }}
        />
      ) : null}
      {open ? (
        <div
          className="fixed z-[80] w-[248px] border-2 border-[var(--win-border-shadow)] bg-[var(--win-face)] p-2 text-[12px] text-[var(--win-text)] shadow-md"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button type="button" className="access-toolbar-btn h-[22px] px-2" onClick={() => setCursor((c) => shiftMonth(c, isShamsi, -1))}>
              ‹
            </button>
            <div className="font-bold">
              {monthLabel} {cursor.year}
            </div>
            <button type="button" className="access-toolbar-btn h-[22px] px-2" onClick={() => setCursor((c) => shiftMonth(c, isShamsi, 1))}>
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {(isShamsi ? (locale === "fa" ? ["ش", "ی", "د", "س", "چ", "پ", "ج"] : ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"]) : week).map((d) => (
              <div key={d} className="py-0.5 text-[10px] font-bold text-[var(--win-muted)]">
                {d}
              </div>
            ))}
            {cells.map((day, index) =>
              day == null ? (
                <span key={`e-${index}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  className={cn(
                    "h-7 rounded-sm hover:bg-[var(--win-navy)] hover:text-white",
                    selectedView && selectedView.year === cursor.year && selectedView.month === cursor.month && selectedView.day === day
                      ? "bg-[var(--win-navy)] text-white"
                      : "bg-[var(--win-input)]"
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(day)}
                >
                  {day}
                </button>
              )
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}
