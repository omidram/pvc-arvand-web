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
        className="absolute end-4 top-4 flex h-8 w-8 items-center justify-center border-2 border-[var(--win-face)] bg-[var(--win-face)] text-[var(--win-text)] [border-style:outset] hover:bg-[var(--win-face-hi)] active:[border-style:inset]"
      >
        {resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <div className="flex h-28 w-[min(100%,22rem)] shrink-0 items-center justify-center bg-transparent p-1">
        <Image
          src="/logo-arvand.png"
          alt="Arvand Petrochemical Company"
          width={360}
          height={120}
          className="h-full w-auto max-w-full object-contain"
          priority
          loading="eager"
        />
      </div>
      <div className="w-full max-w-md border-2 border-[var(--win-border-light)] [border-style:outset] bg-[var(--win-face)] shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--win-border-shadow)] bg-gradient-to-r from-[var(--win-navy)] to-[var(--win-navy-mid)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-snug text-white">{t("app.name")}</div>
            <div className="text-[10px] text-cyan-100">{t("app.subtitle")}</div>
          </div>
          <div className="flex h-12 w-28 shrink-0 items-center justify-center bg-transparent p-0">
            <Image
              src="/logo-arvand.png"
              alt="Arvand Petrochemical Company"
              width={120}
              height={48}
              className="h-full w-auto object-contain"
            />
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
            <div className="border-2 border-[var(--win-danger)] [border-style:inset] bg-red-50 px-2 py-1.5 text-xs text-[var(--win-danger)]">
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
                  "border-2 px-2 py-1 text-xs font-bold [border-style:outset]",
                  locale === loc
                    ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white [border-style:inset]"
                    : "bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)]"
                )}
              >
                {loc === "en" ? "EN" : "فارسی"}
              </button>
            ))}
          </div>
        </form>
      </div>

      <footer className="login-koku-footer max-w-md text-center">
        <div>{t("auth.loginCreditIt")}</div>
        <div>{t("auth.loginCreditVendor")}</div>
        <div className="login-koku-copy">{t("auth.loginCopyright")}</div>
      </footer>
    </div>
  );
}
