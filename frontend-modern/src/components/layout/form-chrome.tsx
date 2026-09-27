"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { SessionControls } from "@/components/layout/session-controls";
import { cn } from "@/lib/utils";

const PAGE_TITLES: { prefix: string; key: string }[] = [
  { prefix: "/overview", key: "nav.overview" },
  { prefix: "/elements", key: "nav.elements" },
  { prefix: "/inspections", key: "nav.inspections" },
  { prefix: "/anodes", key: "nav.anodes" },
  { prefix: "/cathodes", key: "nav.cathodes" },
  { prefix: "/membranes", key: "nav.membranes" },
  { prefix: "/shutdowns", key: "nav.shutdowns" },
  { prefix: "/voltage", key: "nav.voltage" },
  { prefix: "/analyses", key: "nav.analyses" },
  { prefix: "/search", key: "nav.search" },
  { prefix: "/remarks", key: "nav.remarks" },
  { prefix: "/settings", key: "nav.settings" },
  { prefix: "/users", key: "nav.users" },
  { prefix: "/statistics", key: "nav.statistics" },
  { prefix: "/reports", key: "nav.reports" },
  { prefix: "/about", key: "nav.about" },
  { prefix: "/tables", key: "nav.databaseTables" },
  { prefix: "/all-tables", key: "nav.allTables" },
];

const EXTRA_FORMS: { href: string; labelKey: string; formKey?: string; adminOnly?: boolean }[] = [
  { href: "/overview", labelKey: "nav.overview", formKey: "dashboard" },
  { href: "/anodes", labelKey: "nav.anodes", formKey: "anodes" },
  { href: "/cathodes", labelKey: "nav.cathodes", formKey: "cathodes" },
  { href: "/membranes", labelKey: "nav.membranes", formKey: "membranes" },
  { href: "/inspections", labelKey: "nav.inspections", formKey: "inspections" },
  { href: "/tables", labelKey: "nav.databaseTables" },
  { href: "/all-tables", labelKey: "nav.allTables" },
  { href: "/users", labelKey: "nav.users", adminOnly: true },
];

function titleFor(pathname: string, t: (key: string) => string): string {
  const hit = PAGE_TITLES.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  return hit ? t(hit.key) : "";
}

export function FormChrome() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { canView, isAdmin, logout } = useAuth();
  const title = titleFor(pathname, t);

  const extras = EXTRA_FORMS.filter((item) => {
    if (item.adminOnly) return isAdmin;
    if (item.formKey) return canView(item.formKey);
    return true;
  });

  return (
    <header className="shrink-0 border-b-2 border-[var(--win-border-shadow)] bg-[var(--win-face)]">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1">
        <Link href="/" className="access-toolbar-btn font-bold">
          {t("common.mainMenu")}
        </Link>
        {title ? <div className="px-2 text-sm font-bold text-[var(--win-navy)]">{title}</div> : null}
        <div className="ms-auto flex items-center gap-1">
          <SessionControls />
          <button type="button" onClick={logout} className="access-toolbar-btn">
            {t("mainMenu.exit")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-t border-[var(--win-face-dark)] bg-[var(--win-face-dark)] px-2 py-1">
        {extras.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={cn("access-toolbar-btn", active && "is-active")}>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
