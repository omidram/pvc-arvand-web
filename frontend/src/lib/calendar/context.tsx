"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getCalendar as readRuntimeCalendar, setCalendarRuntime, type CalendarKind } from "./runtime";

export type { CalendarKind };
export { getCalendar } from "./runtime";

const STORAGE_KEY = "pvc-arvand-calendar";

function readStored(): CalendarKind {
  if (typeof window === "undefined") return "gregorian";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "shamsi" ? "shamsi" : "gregorian";
  } catch {
    return "gregorian";
  }
}

interface CalendarContextValue {
  calendar: CalendarKind;
  setCalendar: (kind: CalendarKind) => void;
  isShamsi: boolean;
}

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const [calendar, setCalendarState] = useState<CalendarKind>("gregorian");

  useEffect(() => {
    const stored = readStored();
    setCalendarRuntime(stored);
    setCalendarState(stored);
    document.documentElement.setAttribute("data-calendar", stored);
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
