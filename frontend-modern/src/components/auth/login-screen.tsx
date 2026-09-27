"use client";

import { useState } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Sun, Moon } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { useTheme } from "@/lib/theme/context";
import { authApi } from "@/lib/endpoints";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";

export function LoginScreen() {
  const { login } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const directoryQuery = useQuery({
    queryKey: ["auth-directory"],
    queryFn: authApi.directory,
    staleTime: 30_000,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.invalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center gap-5 bg-[var(--win-face-dark)] p-4">
      <button
        onClick={toggleTheme}
        title={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
        aria-label={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
        className="absolute end-4 top-4 flex h-8 w-8 items-center justify-center border-2 border-[var(--win-face)] bg-[var(--win-face)] text-[var(--win-text)] rounded-lg hover:bg-[var(--win-face-hi)]"
      >
        {resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <div className="flex h-24 w-72 shrink-0 items-center justify-center overflow-hidden border-2 border-[var(--win-border-light)] rounded-lg bg-[var(--win-logo-bg)] p-3 shadow-lg">
        <Image src="/logo.png" alt="Arvand Petrochemical Company" width={288} height={96} className="h-full w-full object-contain" priority />
      </div>
      <div className="w-full max-w-sm border-2 border-[var(--win-border-light)] rounded-lg bg-[var(--win-face)] shadow-lg">
        <div className="flex items-center gap-3 border-b-2 border-[var(--win-border-shadow)] bg-gradient-to-r from-[var(--win-navy)] to-[var(--win-navy-mid)] px-4 py-3">
          <div className="flex h-11 w-32 shrink-0 items-center justify-center overflow-hidden border-2 border-white/40 rounded-lg bg-[var(--win-logo-bg)] p-1">
            <Image src="/logo.png" alt="Arvand Petrochemical Company" width={128} height={44} className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight text-white">{t("app.name")}</div>
            <div className="truncate text-[10px] text-cyan-100">{t("app.subtitle")}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <h1 className="text-sm font-bold text-[var(--win-text)]">{t("auth.loginTitle")}</h1>
          {directoryQuery.data?.enabled && (
            <p className="text-xs text-[var(--win-muted)]">
              {directoryQuery.data.domain
                ? t("auth.adHint", { domain: directoryQuery.data.domain })
                : t("auth.adHintGeneric")}
            </p>
          )}

          <div>
            <Label>{t("auth.username")}</Label>
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <Label>{t("auth.password")}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && (
            <div className="border-2 border-[var(--win-danger)] rounded-lg bg-red-50 px-2 py-1.5 text-xs text-[var(--win-danger)]">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full justify-center" disabled={submitting}>
            {submitting ? t("auth.signingIn") : t("auth.signIn")}
          </Button>

          <div className="flex justify-center gap-1 pt-2">
            {(["en", "fa"] as Locale[]).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocale(loc)}
                className={cn(
                  "border-2 px-2 py-1 text-xs font-bold rounded-lg",
                  locale === loc
                    ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                    : "bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)]"
                )}
              >
                {loc === "en" ? "EN" : "فارسی"}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
