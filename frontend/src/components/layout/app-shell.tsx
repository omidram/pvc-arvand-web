"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { LoginScreen } from "@/components/auth/login-screen";
import { SessionControls } from "@/components/layout/session-controls";
import { AllFormsPane } from "@/components/layout/all-forms-pane";
import { ModernSidebar } from "@/components/layout/modern-sidebar";
import { AlertToaster } from "@/components/domain/alert-toaster";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useUiStyle } from "@/lib/ui-style/context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const { t } = useI18n();
  const { isModern } = useUiStyle();
  const isMainMenu = pathname === "/";
  const [formsOpen, setFormsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setFormsOpen(false);
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 1100) setFormsOpen(false);
      if (window.innerWidth > 900) setNavOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (isModern) {
    return (
      <div className="modern-shell flex h-screen w-full overflow-hidden">
        {navOpen ? <button type="button" className="app-drawer-backdrop" aria-label={t("common.mainMenu")} onClick={() => setNavOpen(false)} /> : null}
        <ModernSidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
        <main className="modern-main min-w-0 flex-1 overflow-y-auto">
          <div className="modern-content mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
            <button type="button" className="modern-nav-toggle" onClick={() => setNavOpen(true)}>
              {t("common.mainMenu")}
            </button>
            {children}
          </div>
        </main>
        <AlertToaster />
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen w-full flex-col overflow-hidden ${isMainMenu ? "access-eap" : "bg-[var(--win-face)]"}`}
    >
      <div
        className={`app-topbar relative z-[60] flex min-h-[32px] shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-1 ${
          isMainMenu ? "border-[#a0a0a0]" : "border-[var(--win-face-dark)]"
        }`}
      >
        <Link
          href="/"
          className={`access-menu-btn access-hub-menu-btn ${isMainMenu ? "is-default-focus" : ""}`}
        >
          {t("common.mainMenu")}
        </Link>
        <div className="app-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-1">
          <button type="button" className="app-forms-toggle access-toolbar-btn h-[22px] px-2 text-[11px]" onClick={() => setFormsOpen((open) => !open)}>
            {t("menus.allForms")}
          </button>
          <SessionControls classic={isMainMenu} />
          <button type="button" onClick={logout} className="access-toolbar-btn h-[22px] px-2 text-[11px]">
            {t("mainMenu.exit")}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        {formsOpen ? <button type="button" className="app-drawer-backdrop" aria-label={t("menus.allForms")} onClick={() => setFormsOpen(false)} /> : null}
        <div className={`access-forms-slot ${formsOpen ? "is-open" : ""}`}>
        <Suspense
          fallback={
            <aside className="access-forms-pane min-h-0 self-stretch" dir="ltr">
              <div className="access-forms-pane-header">
                <span>{t("menus.allForms")}</span>
              </div>
            </aside>
          }
        >
          <AllFormsPane />
        </Suspense>
        </div>
      </div>
      <AlertToaster />
    </div>
  );
}
