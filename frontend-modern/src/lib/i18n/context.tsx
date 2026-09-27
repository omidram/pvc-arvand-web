"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translations, type Locale } from "./translations";

const STORAGE_KEY = "pvc-arvand-locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dir: "ltr" | "rtl";
  t: (path: string, vars?: Record<string, string | number | null | undefined>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(str: string, vars?: Record<string, string | number | null | undefined>): string {
  if (!vars) return str;
  return Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{${key}}`, value == null ? "" : String(value)), str);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved === "en" || saved === "fa") {
      // One-time hydration of the persisted preference; localStorage is only
      // available after mount, so this can't be derived during initial render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(saved);
    }
  }, []);

  const dir: "ltr" | "rtl" = locale === "fa" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number | null | undefined>) => {
      const fromLocale = getByPath(translations[locale], path);
      const fromEn = getByPath(translations.en, path);
      const str = typeof fromLocale === "string" ? fromLocale : typeof fromEn === "string" ? fromEn : path;
      return interpolate(str, vars);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, dir, t }), [locale, setLocale, dir, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
