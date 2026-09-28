"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  CircleDot,
  Layers,
  PowerOff,
  ClipboardCheck,
  Zap,
  FlaskConical,
  Search,
  MessageSquareText,
  Settings,
  BarChart3,
  FileBarChart,
  Users,
  LogOut,
  Info,
  Sun,
  Moon,
  Table2,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import { useAuth } from "@/lib/auth/context";
import { useTheme } from "@/lib/theme/context";

const NAV_GROUPS: {
  groupKey: string;
  items: { href: string; labelKey: string; icon: typeof LayoutDashboard; formKey: string; adminOnly?: boolean }[];
}[] = [
  {
    groupKey: "nav.groupOverview",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, formKey: "dashboard" },
      { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3, formKey: "statistics" },
      { href: "/reports", labelKey: "nav.reports", icon: FileBarChart, formKey: "reports" },
    ],
  },
  {
    groupKey: "nav.groupElements",
    items: [
      { href: "/elements", labelKey: "nav.elements", icon: Boxes, formKey: "elements" },
      { href: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck, formKey: "inspections" },
    ],
  },
  {
    groupKey: "nav.groupComponents",
    items: [
      { href: "/anodes", labelKey: "nav.anodes", icon: CircleDot, formKey: "anodes" },
      { href: "/cathodes", labelKey: "nav.cathodes", icon: CircleDot, formKey: "cathodes" },
      { href: "/membranes", labelKey: "nav.membranes", icon: Layers, formKey: "membranes" },
    ],
  },
  {
    groupKey: "nav.groupOperations",
    items: [
      { href: "/shutdowns", labelKey: "nav.shutdowns", icon: PowerOff, formKey: "shutdowns" },
      { href: "/voltage", labelKey: "nav.voltage", icon: Zap, formKey: "voltage" },
      { href: "/analyses", labelKey: "nav.analyses", icon: FlaskConical, formKey: "analyses" },
      { href: "/segregation", labelKey: "nav.segregation", icon: ClipboardCheck, formKey: "anodes" },
      { href: "/search", labelKey: "nav.search", icon: Search, formKey: "search" },
      { href: "/remarks", labelKey: "nav.remarks", icon: MessageSquareText, formKey: "remarks" },
    ],
  },
  {
    groupKey: "nav.groupSystem",
    items: [
      { href: "/settings", labelKey: "nav.settings", icon: Settings, formKey: "settings" },
      { href: "/users", labelKey: "nav.users", icon: Users, formKey: "users", adminOnly: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { user, isAdmin, canView, logout } = useAuth();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-e border-slate-200 bg-white">
      <div className="border-b border-white/10 bg-gradient-to-br from-slate-900 to-blue-800 px-4 py-4">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-16 w-full items-center justify-center overflow-hidden rounded-xl bg-white p-2 shadow-md">
            <Image src="/logo.png" alt="Arvand Petrochemical Company" width={210} height={70} className="h-full w-auto object-contain" priority />
          </div>
          <div className="min-w-0 text-center">
            <div className="truncate text-sm font-bold leading-tight text-white">{t("app.name")}</div>
            <div className="truncate text-[10px] text-cyan-100">{t("app.subtitle")}</div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b-2 border-[var(--win-face-dark)] bg-[var(--win-face-dark)] p-1.5">
        {(["en", "fa"] as Locale[]).map((loc) => (
          <button
            key={loc}
            onClick={() => setLocale(loc)}
            className={cn(
              "flex-1 border-2 px-2 py-1 text-xs font-bold rounded-lg",
              locale === loc
                ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                : "bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)]"
            )}
          >
            {loc === "en" ? "EN" : "فارسی"}
          </button>
        ))}
        <button
          onClick={toggleTheme}
          title={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
          aria-label={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
          className="flex shrink-0 items-center justify-center border-2 border-[var(--win-face)] bg-[var(--win-face)] px-2 text-[var(--win-text)] rounded-lg hover:bg-[var(--win-face-hi)]"
        >
          {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        <div className="space-y-1">
          <Link
            href="/tables"
            className={cn(
              "flex items-center gap-2 border-2 px-2.5 py-1.5 text-xs font-semibold",
              pathname === "/tables"
                ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                : "border-[var(--win-border-shadow)] bg-[var(--win-face-hi)] text-[var(--win-text)] rounded-lg hover:bg-[var(--win-face)]"
            )}
          >
            <Database size={15} className={pathname === "/tables" ? "text-white" : "text-[var(--win-navy)]"} />
            <span className="truncate">{t("nav.databaseTables")}</span>
          </Link>
          <Link
            href="/all-tables"
            className={cn(
              "flex items-center gap-2 border-2 px-2.5 py-1.5 text-xs font-semibold",
              pathname === "/all-tables"
                ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                : "border-transparent bg-transparent text-[var(--win-text)] [border-style:solid] hover:border-[var(--win-face)] hover:bg-[var(--win-face-hi)]"
            )}
          >
            <Table2 size={15} className={pathname === "/all-tables" ? "text-white" : "text-[var(--win-navy)]"} />
            <span className="truncate">{t("nav.allTables")}</span>
          </Link>
        </div>

        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false;
            if (item.adminOnly) return true;
            return canView(item.formKey);
          });
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.groupKey}>
              <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--win-muted)]">
                {t(group.groupKey)}
              </div>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2 border-2 px-2.5 py-1.5 text-xs font-semibold",
                        active
                          ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                          : "border-transparent bg-transparent text-[var(--win-text)] [border-style:solid] hover:border-[var(--win-face)] hover:bg-[var(--win-face-hi)]"
                      )}
                    >
                      <Icon size={15} className={active ? "text-white" : "text-[var(--win-navy)]"} />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {isAdmin && (
          <div>
            <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--win-muted)]">
              {t("nav.groupSystem")}
            </div>
            <div className="space-y-1">
              <Link
                href="/users"
                className={cn(
                  "flex items-center gap-2 border-2 px-2.5 py-1.5 text-xs font-semibold",
                  pathname === "/users"
                    ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
                    : "border-transparent bg-transparent text-[var(--win-text)] [border-style:solid] hover:border-[var(--win-face)] hover:bg-[var(--win-face-hi)]"
                )}
              >
                <Users size={15} className={pathname === "/users" ? "text-white" : "text-[var(--win-navy)]"} />
                <span className="truncate">{t("nav.users")}</span>
              </Link>
            </div>
          </div>
        )}
      </nav>

      {user && (
        <div className="border-t-2 border-[var(--win-face-dark)] p-2">
          <div className="mb-1.5 truncate px-1.5 text-[11px] font-semibold text-[var(--win-text)]">
            {t("auth.loggedInAs", { name: user.full_name || user.username })}
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 border-2 border-[var(--win-border-light)] bg-[var(--win-face)] px-2.5 py-1.5 text-xs font-semibold text-[var(--win-text)] rounded-lg hover:bg-[var(--win-face-hi)]"
          >
            <LogOut size={14} className="text-[var(--win-navy)]" />
            {t("common.logout")}
          </button>
        </div>
      )}
      <div className="border-t-2 border-[var(--win-face-dark)] p-2">
        <Link
          href="/about"
          className={cn(
            "flex items-center gap-2 border-2 px-2.5 py-1.5 text-xs font-semibold",
            pathname === "/about"
              ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white rounded-lg"
              : "border-transparent bg-transparent text-[var(--win-text)] [border-style:solid] hover:border-[var(--win-face)] hover:bg-[var(--win-face-hi)]"
          )}
        >
          <Info size={15} className={pathname === "/about" ? "text-white" : "text-[var(--win-navy)]"} />
          <span className="truncate">{t("nav.about")}</span>
        </Link>
      </div>
      <div className="border-t-2 border-[var(--win-face-dark)] px-3 py-2 text-[10px] text-[var(--win-muted)]">
        {t("app.footer")}
      </div>
    </aside>
  );
}
