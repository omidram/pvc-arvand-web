"use client";

import { useState } from "react";
import { KeyRound, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import { useTheme } from "@/lib/theme/context";
import { ChangeOwnPasswordDialog } from "@/components/auth/change-password-dialog";

export function SessionControls({ classic }: { classic?: boolean }) {
  const { t, locale, setLocale } = useI18n();
  const { user } = useAuth();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();
  const [pwdOpen, setPwdOpen] = useState(false);
  const canChangeLocal = Boolean(user && (user.auth_source || "local") !== "ad");

  const btn = classic
    ? "h-[22px] border-2 border-white bg-white px-2 text-[11px] text-black [border-style:outset] hover:bg-[#ffffe8] active:[border-style:inset]"
    : "access-toolbar-btn";

  return (
    <div className="flex items-center gap-1">
      {(["en", "fa"] as Locale[]).map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          className={cn(btn, locale === loc && (classic ? "[border-style:inset] bg-[#e8e8e8]" : "is-active"))}
        >
          {loc === "en" ? "EN" : "FA"}
        </button>
      ))}
      <button
        type="button"
        onClick={toggleTheme}
        title={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
        aria-label={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
        className={btn}
      >
        {resolvedTheme === "dark" ? <Sun size={12} /> : <Moon size={12} />}
      </button>
      {user && (
        <span className={cn("app-topbar-user ms-1 max-w-[140px] truncate text-[11px]", classic ? "text-black" : "text-[var(--win-text)]")}>
          {user.full_name || user.username}
        </span>
      )}
      {canChangeLocal ? (
        <button
          type="button"
          className={btn}
          title={t("auth.changePassword")}
          aria-label={t("auth.changePassword")}
          onClick={() => setPwdOpen(true)}
        >
          <KeyRound size={12} />
        </button>
      ) : null}
      {pwdOpen ? <ChangeOwnPasswordDialog open onClose={() => setPwdOpen(false)} /> : null}
    </div>
  );
}
