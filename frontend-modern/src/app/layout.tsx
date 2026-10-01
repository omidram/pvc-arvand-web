import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "Arvand Electrolyzer Management Program",
  description: "Plant configuration, element administration, and data analysis for the Arvand electrolysis plant",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var raw = localStorage.getItem("pvc-arvand-theme-v2");
    var theme = raw ? JSON.parse(raw) : null;
    var preset = theme && theme.preset ? theme.preset : localStorage.getItem("pvc-arvand-theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var classic = {navy:"#0a246a",face:"#d4d0c8",panel:"#ece9e2",text:"#000000",muted:"#3f3f3f",input:"#ffffff",danger:"#a10000",border:"#808080"};
    var dark = {navy:"#2f5aa8",face:"#3a3a3a",panel:"#232323",text:"#eae8e3",muted:"#b7b4ac",input:"#262626",danger:"#ff6b60",border:"#1a1a1a"};
    var presets = {classic:classic,dark:dark};
    var colors = theme && theme.colors ? theme.colors : null;
    if (preset === "dark") colors = dark;
    else if (preset === "system") colors = systemDark ? dark : classic;
    else if (preset && presets[preset]) colors = presets[preset];
    else if (!colors) colors = classic;
    var face = colors.face || classic.face;
    var rgb = face.replace("#","");
    if (rgb.length === 3) rgb = rgb[0]+rgb[0]+rgb[1]+rgb[1]+rgb[2]+rgb[2];
    var r = parseInt(rgb.slice(0,2),16), g = parseInt(rgb.slice(2,4),16), b = parseInt(rgb.slice(4,6),16);
    var isDark = (r*299+g*587+b*114)/1000 < 145;
    var root = document.documentElement;
    root.setAttribute("data-theme", isDark ? "dark" : "light");
    if (theme) {
      if (colors.navy) root.style.setProperty("--win-navy", colors.navy);
      if (colors.face) root.style.setProperty("--win-face", colors.face);
      if (colors.panel) root.style.setProperty("--win-panel", colors.panel);
      if (colors.text) root.style.setProperty("--win-text", colors.text);
      if (colors.muted) root.style.setProperty("--win-muted", colors.muted);
      if (colors.input) root.style.setProperty("--win-input", colors.input);
      if (colors.danger) root.style.setProperty("--win-danger", colors.danger);
      if (colors.border) root.style.setProperty("--win-border-shadow", colors.border);
      if (theme.fontSize) root.style.setProperty("--app-font-size", theme.fontSize + "px");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full min-h-screen antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
