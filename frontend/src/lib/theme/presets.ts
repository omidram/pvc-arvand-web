export type ThemePresetId =
  | "classic"
  | "dark"
  | "system"
  | "contrast"
  | "ocean"
  | "forest"
  | "wine"
  | "sand"
  | "custom";

export type ThemeColors = {
  navy: string;
  face: string;
  panel: string;
  text: string;
  muted: string;
  input: string;
  danger: string;
  border: string;
};

export type StoredTheme = {
  preset: ThemePresetId;
  fontSize: number;
  colors: ThemeColors;
};

export const THEME_STORAGE_KEY = "pvc-arvand-theme-v2";
export const THEME_STORAGE_KEY_LEGACY = "pvc-arvand-theme";

export const NAMED_PRESETS: Record<Exclude<ThemePresetId, "system" | "custom">, ThemeColors> = {
  classic: {
    navy: "#0a246a",
    face: "#d4d0c8",
    panel: "#ece9e2",
    text: "#000000",
    muted: "#3f3f3f",
    input: "#ffffff",
    danger: "#a10000",
    border: "#808080",
  },
  dark: {
    navy: "#2f5aa8",
    face: "#3a3a3a",
    panel: "#232323",
    text: "#eae8e3",
    muted: "#b7b4ac",
    input: "#262626",
    danger: "#ff6b60",
    border: "#1a1a1a",
  },
  contrast: {
    navy: "#000000",
    face: "#ffffff",
    panel: "#ffffff",
    text: "#000000",
    muted: "#222222",
    input: "#ffffff",
    danger: "#cc0000",
    border: "#000000",
  },
  ocean: {
    navy: "#0b4f6c",
    face: "#d5e4ec",
    panel: "#eaf3f7",
    text: "#0a2430",
    muted: "#35515e",
    input: "#ffffff",
    danger: "#9b2226",
    border: "#6f8b98",
  },
  forest: {
    navy: "#1b4332",
    face: "#d7e3d4",
    panel: "#e8f0e6",
    text: "#081c15",
    muted: "#3d5a4c",
    input: "#ffffff",
    danger: "#9b2226",
    border: "#6d8a76",
  },
  wine: {
    navy: "#6b1d3a",
    face: "#ead9d6",
    panel: "#f4ecea",
    text: "#2b0d16",
    muted: "#6a4450",
    input: "#ffffff",
    danger: "#9b1d32",
    border: "#9a7a80",
  },
  sand: {
    navy: "#7a4e1d",
    face: "#efe4c8",
    panel: "#f7f1de",
    text: "#2c1d08",
    muted: "#6b542e",
    input: "#fffdf6",
    danger: "#9b2226",
    border: "#b39a6a",
  },
};

export const DEFAULT_THEME: StoredTheme = {
  preset: "classic",
  fontSize: 13,
  colors: NAMED_PRESETS.classic,
};

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [parseInt(full.slice(0, 2), 16) || 0, parseInt(full.slice(2, 4), 16) || 0, parseInt(full.slice(4, 6), 16) || 0];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

export function mix(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function lighten(hex: string, amount: number) {
  return mix(hex, "#ffffff", amount);
}

export function darken(hex: string, amount: number) {
  return mix(hex, "#000000", amount);
}

export function isDarkFace(face: string) {
  const [r, g, b] = hexToRgb(face);
  return (r * 299 + g * 587 + b * 114) / 1000 < 145;
}

export function resolvePresetColors(preset: ThemePresetId, custom: ThemeColors, systemDark: boolean): ThemeColors {
  if (preset === "custom") return custom;
  if (preset === "system") return systemDark ? NAMED_PRESETS.dark : NAMED_PRESETS.classic;
  return NAMED_PRESETS[preset];
}

export function applyThemeToDocument(colors: ThemeColors, fontSize: number) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = isDarkFace(colors.face);
  const modernDark = root.getAttribute("data-ui") === "modern" && dark;
  const palette: ThemeColors = modernDark
    ? {
        navy: "#3b82f6",
        face: "#0f172a",
        panel: "#111827",
        text: "#f8fafc",
        muted: "#94a3b8",
        input: "#1e293b",
        danger: "#f87171",
        border: "#334155",
      }
    : colors;
  const appliedDark = isDarkFace(palette.face);
  root.style.setProperty("--win-navy", palette.navy);
  root.style.setProperty("--win-navy-dark", darken(palette.navy, 0.35));
  root.style.setProperty("--win-navy-mid", lighten(palette.navy, 0.22));
  root.style.setProperty("--win-face", palette.face);
  root.style.setProperty("--win-face-hi", lighten(palette.face, appliedDark ? 0.12 : 0.08));
  root.style.setProperty("--win-face-dark", darken(palette.face, 0.12));
  root.style.setProperty("--win-panel", palette.panel);
  root.style.setProperty("--win-text", palette.text);
  root.style.setProperty("--win-muted", palette.muted);
  root.style.setProperty("--win-input", palette.input);
  root.style.setProperty("--win-danger", palette.danger);
  root.style.setProperty("--win-border-shadow", palette.border);
  root.style.setProperty("--win-border-dark", darken(palette.border, 0.35));
  root.style.setProperty("--win-border-light", appliedDark ? lighten(palette.face, 0.28) : "#ffffff");
  root.style.setProperty("--win-row-alt", mix(palette.panel, palette.face, 0.4));
  root.style.setProperty("--win-logo-bg", "#ffffff");
  root.style.setProperty("--background", palette.face);
  root.style.setProperty("--foreground", palette.text);
  root.style.setProperty("--app-font-size", `${fontSize}px`);
  root.setAttribute("data-theme", appliedDark ? "dark" : "light");
}

export function loadStoredTheme(): StoredTheme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredTheme>;
      return {
        preset: parsed.preset && parsed.preset in { ...NAMED_PRESETS, system: 1, custom: 1 } ? parsed.preset : "classic",
        fontSize: typeof parsed.fontSize === "number" ? Math.min(18, Math.max(11, parsed.fontSize)) : 13,
        colors: { ...NAMED_PRESETS.classic, ...(parsed.colors || {}) },
      };
    }
    const legacy = window.localStorage.getItem(THEME_STORAGE_KEY_LEGACY);
    if (legacy === "dark" || legacy === "light" || legacy === "system") {
      const preset: ThemePresetId = legacy === "light" ? "classic" : legacy;
      return {
        preset,
        fontSize: 13,
        colors: preset === "dark" ? NAMED_PRESETS.dark : NAMED_PRESETS.classic,
      };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function saveStoredTheme(theme: StoredTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
}
