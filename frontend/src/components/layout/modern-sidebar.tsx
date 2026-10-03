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
  Activity,
  Gauge,
  LineChart,
  FlaskRound,
  SplitSquareVertical,
  Bell,
  Warehouse,
  ScrollText,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/translations";
import { useAuth } from "@/lib/auth/context";
import { canSeeInspections, canSeeSegregation } from "@/lib/inspection-access";
import { useTheme } from "@/lib/theme/context";
import { monitoringApi } from "@/lib/endpoints";

const NAV_GROUPS: {
  groupKey: string;
  items: { href: string; labelKey: string; icon: typeof LayoutDashboard; formKey: string; adminOnly?: boolean }[];
}[] = [
  {
    groupKey: "nav.groupOverview",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, formKey: "dashboard" },
      { href: "/overview", labelKey: "nav.overview", icon: Activity, formKey: "dashboard" },
      { href: "/monitoring", labelKey: "nav.monitoring", icon: Bell, formKey: "monitoring" },
      { href: "/plant-charts", labelKey: "nav.plantCharts", icon: LineChart, formKey: "monitoring" },
      { href: "/statistics", labelKey: "nav.statistics", icon: BarChart3, formKey: "statistics" },
      { href: "/reports", labelKey: "nav.reports", icon: FileBarChart, formKey: "reports" },
    ],
  },
  {
    groupKey: "nav.groupElements",
    items: [
      { href: "/elements", labelKey: "nav.elements", icon: Boxes, formKey: "elements" },
      { href: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck, formKey: "inspections" },
      { href: "/segregation", labelKey: "nav.segregation", icon: SplitSquareVertical, formKey: "elements" },
    ],
  },
  {
    groupKey: "nav.groupComponents",
    items: [
      { href: "/anodes", labelKey: "nav.anodes", icon: CircleDot, formKey: "anodes" },
      { href: "/cathodes", labelKey: "nav.cathodes", icon: CircleDot, formKey: "cathodes" },
      { href: "/membranes", labelKey: "nav.membranes", icon: Layers, formKey: "membranes" },
      { href: "/storage", labelKey: "nav.storage", icon: Warehouse, formKey: "storage" },
    ],
  },
  {
    groupKey: "nav.groupOperations",
    items: [
      { href: "/voltage", labelKey: "nav.voltage", icon: Zap, formKey: "voltage" },
      { href: "/current-efficiency", labelKey: "nav.currentEfficiency", icon: Gauge, formKey: "voltage" },
      { href: "/power-consumption", labelKey: "nav.powerConsumption", icon: Activity, formKey: "statistics" },
      { href: "/un-ce", labelKey: "nav.unCe", icon: LineChart, formKey: "reports" },
      { href: "/test-run-results", labelKey: "nav.testRunResults", icon: FlaskRound, formKey: "voltage" },
      { href: "/analyses", labelKey: "nav.analyses", icon: FlaskConical, formKey: "analyses" },
      { href: "/shutdowns", labelKey: "nav.shutdowns", icon: PowerOff, formKey: "shutdowns" },
      { href: "/search", labelKey: "nav.search", icon: Search, formKey: "search" },
      { href: "/remarks", labelKey: "nav.remarks", icon: MessageSquareText, formKey: "remarks" },
    ],
  },
  {
    groupKey: "nav.groupSystem",
    items: [
      { href: "/settings", labelKey: "nav.settings", icon: Settings, formKey: "settings" },
      { href: "/users", labelKey: "nav.users", icon: Users, formKey: "users", adminOnly: true },
      { href: "/logs", labelKey: "nav.logs", icon: ScrollText, formKey: "logs", adminOnly: true },
    ],
  },
];

function navActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  active,
  icon: Icon,
  label,
  badge,
  onNavigate,
}: {
  href: string;
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  onNavigate?: () => void;
}) {
  return (
    <Link href={href} className={cn("ms-nav-link", active && "is-active")} onClick={onNavigate}>
      <Icon size={15} className="ms-nav-icon" />
      <span className="truncate">{label}</span>
      {badge && badge > 0 ? <span className="ms-badge">{badge > 99 ? "99+" : badge}</span> : null}
    </Link>
  );
}

export function ModernSidebar({ open = false, onNavigate }: { open?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  const { user, isAdmin, canView, logout } = useAuth();
  const { resolvedTheme, toggle: toggleTheme } = useTheme();
  const canMonitor = canView("monitoring") || canView("voltage");
  const alertSummary = useQuery({
    queryKey: ["monitoring", "summary"],
    queryFn: monitoringApi.summary,
    enabled: canMonitor,
    refetchInterval: 20_000,
  });
  const openAlerts = alertSummary.data?.open_total ?? 0;

  return (
    <aside className={cn("modern-sidebar", open && "is-open")}>
      <div className="ms-brand">
        <div className="ms-brand-row">
          <div className="min-w-0 flex-1 text-start">
            <div className="ms-brand-title">{t("app.name")}</div>
            <div className="ms-brand-sub">{t("app.subtitle")}</div>
          </div>
          <div className="ms-logo-well ms-logo-side">
            <Image
              src="/logo-arvand.png"
              alt="Arvand Petrochemical Company"
              width={210}
              height={70}
              className="h-full w-auto object-contain"
              priority
            />
          </div>
        </div>
      </div>

      <div className="ms-toolbar">
        {(["en", "fa"] as Locale[]).map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => setLocale(loc)}
            className={cn("ms-chip", locale === loc && "is-active")}
          >
            {loc === "en" ? "EN" : "فارسی"}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleTheme}
          title={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
          aria-label={t(resolvedTheme === "dark" ? "common.switchToLight" : "common.switchToDark")}
          className="ms-chip ms-chip-icon"
        >
          {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      <nav className="ms-nav">
        <div className="ms-nav-block">
          <NavLink href="/tables" active={navActive(pathname, "/tables")} icon={Database} label={t("nav.databaseTables")} onNavigate={onNavigate} />
          <NavLink href="/all-tables" active={navActive(pathname, "/all-tables")} icon={Table2} label={t("nav.allTables")} onNavigate={onNavigate} />
        </div>

        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) => {
            if (item.adminOnly && !isAdmin) return false;
            if (item.formKey === "monitoring") return canMonitor;
            if (item.href === "/inspections") return canSeeInspections(canView);
            if (item.href === "/segregation") return canSeeSegregation(canView);
            return canView(item.formKey);
          });
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.groupKey} className="ms-nav-block">
              <div className="ms-group-label">{t(group.groupKey)}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  active={navActive(pathname, item.href)}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  badge={item.href === "/monitoring" ? openAlerts : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {user ? (
        <div className="ms-footer-block">
          <div className="ms-user">{t("auth.loggedInAs", { name: user.full_name || user.username })}</div>
          <button type="button" onClick={logout} className="ms-logout">
            <LogOut size={14} />
            {t("common.logout")}
          </button>
        </div>
      ) : null}

      <div className="ms-footer-block">
        <NavLink href="/about" active={navActive(pathname, "/about")} icon={Info} label={t("nav.about")} onNavigate={onNavigate} />
        <div className="ms-footnote">{t("app.footer")}</div>
      </div>
    </aside>
  );
}
