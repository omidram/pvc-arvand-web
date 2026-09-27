"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_THEME,
  NAMED_PRESETS,
  applyThemeToDocument,
  isDarkFace,
  loadStoredTheme,
  resolvePresetColors,
  saveStoredTheme,
  type StoredTheme,
  type ThemeColors,
  type ThemePresetId,
} from "./presets";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  preset: ThemePresetId;
  colors: ThemeColors;
  resolvedColors: ThemeColors;
  fontSize: number;
  resolvedTheme: "light" | "dark";
  mode: ThemeMode;
  setPreset: (preset: ThemePresetId) => void;
  setMode: (mode: ThemeMode) => void;
  setColor: (key: keyof ThemeColors, value: string) => void;
  setFontSize: (size: number) => void;
  reset: () => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<StoredTheme>(DEFAULT_THEME);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setStored(loadStoredTheme());
    setSystemDark(systemPrefersDark());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedColors = useMemo(
    () => resolvePresetColors(stored.preset, stored.colors, systemDark),
    [stored.preset, stored.colors, systemDark]
  );

  useEffect(() => {
    applyThemeToDocument(resolvedColors, stored.fontSize);
  }, [resolvedColors, stored.fontSize]);

  const update = useCallback((next: StoredTheme) => {
    setStored(next);
    saveStoredTheme(next);
  }, []);

  const setPreset = useCallback(
    (preset: ThemePresetId) => {
      const colors =
        preset === "custom"
          ? stored.colors
          : preset === "system"
            ? stored.colors
            : NAMED_PRESETS[preset];
      update({ ...stored, preset, colors });
    },
    [stored, update]
  );

  const setMode = useCallback(
    (mode: ThemeMode) => {
      setPreset(mode === "light" ? "classic" : mode);
    },
    [setPreset]
  );

  const setColor = useCallback(
    (key: keyof ThemeColors, value: string) => {
      update({ ...stored, preset: "custom", colors: { ...resolvedColors, [key]: value } });
    },
    [stored, resolvedColors, update]
  );

  const setFontSize = useCallback(
    (fontSize: number) => {
      update({ ...stored, fontSize: Math.min(18, Math.max(11, Math.round(fontSize))) });
    },
    [stored, update]
  );

  const reset = useCallback(() => {
    update(DEFAULT_THEME);
  }, [update]);

  const resolvedTheme: "light" | "dark" = isDarkFace(resolvedColors.face) ? "dark" : "light";

  const toggle = useCallback(() => {
    setPreset(resolvedTheme === "dark" ? "classic" : "dark");
  }, [resolvedTheme, setPreset]);

  const mode: ThemeMode = stored.preset === "system" ? "system" : stored.preset === "dark" ? "dark" : "light";

  const value = useMemo(
    () => ({
      preset: stored.preset,
      colors: stored.colors,
      resolvedColors,
      fontSize: stored.fontSize,
      resolvedTheme,
      mode,
      setPreset,
      setMode,
      setColor,
      setFontSize,
      reset,
      toggle,
    }),
    [stored, resolvedColors, resolvedTheme, mode, setPreset, setMode, setColor, setFontSize, reset, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
