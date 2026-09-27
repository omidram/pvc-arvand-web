"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth/context";
import { LoginScreen } from "@/components/auth/login-screen";
import { SessionControls } from "@/components/layout/session-controls";
import { AllFormsPane } from "@/components/layout/all-forms-pane";
import { ModernSidebar } from "@/components/layout/modern-sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useUiStyle } from "@/lib/ui-style/context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const { t } = useI18n();
  const { isModern } = useUiStyle();
  const isMainMenu = pathname === "/";

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
        <ModernSidebar />
        <main className="modern-main min-w-0 flex-1 overflow-y-auto">
          <div className="modern-content mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className={`flex h-screen w-full flex-col overflow-hidden ${isMainMenu ? "access-eap" : "bg-[var(--win-face)]"}`}
    >
      <div
        className={`flex h-[32px] shrink-0 items-center justify-between gap-2 border-b px-2 ${
          isMainMenu ? "border-[#a0a0a0]" : "border-[var(--win-face-dark)]"
        }`}
      >
        <Link
          href="/"
          className={`access-menu-btn access-hub-menu-btn ${isMainMenu ? "is-default-focus" : ""}`}
        >
          {t("common.mainMenu")}
        </Link>
        <div className="flex items-center gap-1">
          <SessionControls classic={isMainMenu} />
          <button type="button" onClick={logout} className="access-toolbar-btn h-[22px] px-2 text-[11px]">
            {t("mainMenu.exit")}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
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
  );
}
