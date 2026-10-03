"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getCalendar as readRuntimeCalendar, setCalendarRuntime, type CalendarKind } from "./runtime";

export type { CalendarKind };
export { getCalendar } from "./runtime";

const STORAGE_KEY = "pvc-arvand-calendar";

function readStored(): CalendarKind {
  if (typeof window === "undefined") return "shamsi";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "gregorian") return "gregorian";
    return "shamsi";
  } catch {
    return "shamsi";
  }
}

interface CalendarContextValue {
  calendar: CalendarKind;
  setCalendar: (kind: CalendarKind) => void;
  isShamsi: boolean;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const [calendar, setCalendarState] = useState<CalendarKind>("shamsi");

  useEffect(() => {
    const stored = readStored();
    setCalendarRuntime(stored);
    setCalendarState(stored);
    document.documentElement.setAttribute("data-calendar", stored);
    try {
      if (window.localStorage.getItem(STORAGE_KEY) == null) {
        window.localStorage.setItem(STORAGE_KEY, "shamsi");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setCalendar = useCallback((kind: CalendarKind) => {
    setCalendarRuntime(kind);
    setCalendarState(kind);
    try {
      window.localStorage.setItem(STORAGE_KEY, kind);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute("data-calendar", kind);
  }, []);

  const value = useMemo(
    () => ({
      calendar,
      setCalendar,
      isShamsi: calendar === "shamsi",
    }),
    [calendar, setCalendar]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarContextValue {
  const ctx = useContext(CalendarContext);
  if (!ctx) {
    return {
      calendar: readRuntimeCalendar(),
      setCalendar: () => {},
      isShamsi: readRuntimeCalendar() === "shamsi",
    };
  }
  return ctx;
}

export const CALENDAR_STORAGE_KEY = STORAGE_KEY;
