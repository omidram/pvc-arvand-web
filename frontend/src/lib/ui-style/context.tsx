"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applyThemeToDocument, loadStoredTheme, resolvePresetColors } from "@/lib/theme/presets";

export type UiStyle = "access" | "modern";

const STORAGE_KEY = "pvc-arvand-ui-style";

interface UiStyleContextValue {
  uiStyle: UiStyle;
  setUiStyle: (style: UiStyle) => void;
  isModern: boolean;
  isAccess: boolean;
}

const UiStyleContext = createContext<UiStyleContextValue | null>(null);

function readStored(): UiStyle {
  if (typeof window === "undefined") return "access";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "modern" ? "modern" : "access";
  } catch {
    return "access";
  }
}

function applyToDocument(style: UiStyle) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-ui", style);
  try {
    const stored = loadStoredTheme();
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    applyThemeToDocument(resolvePresetColors(stored.preset, stored.colors, systemDark), stored.fontSize);
  } catch {
    /* theme context will apply on mount */
  }
}

export function UiStyleProvider({ children }: { children: React.ReactNode }) {
  const [uiStyle, setUiStyleState] = useState<UiStyle>("access");

  useEffect(() => {
    const stored = readStored();
    setUiStyleState(stored);
    applyToDocument(stored);
  }, []);

  const setUiStyle = useCallback((style: UiStyle) => {
    setUiStyleState(style);
    applyToDocument(style);
    try {
      window.localStorage.setItem(STORAGE_KEY, style);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      uiStyle,
      setUiStyle,
      isModern: uiStyle === "modern",
      isAccess: uiStyle === "access",
    }),
    [uiStyle, setUiStyle]
  );

  return <UiStyleContext.Provider value={value}>{children}</UiStyleContext.Provider>;
}

export function useUiStyle(): UiStyleContextValue {
  const ctx = useContext(UiStyleContext);
  if (!ctx) throw new Error("useUiStyle must be used within a UiStyleProvider");
  return ctx;
}

export const UI_STYLE_STORAGE_KEY = STORAGE_KEY;
