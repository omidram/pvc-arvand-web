"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { settingsApi, statisticsApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { UhdeCellBars, UhdeLogoMark } from "@/components/layout/uhde-mark";
import { VoltageReportPanel } from "@/components/domain/voltage-report-panel";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { useCalendar } from "@/lib/calendar/context";
import { APP_VERSION } from "@/lib/app-version";

function MenuButton({
  href,
  onClick,
  label,
  allowed,
  defaultFocus,
  className,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  allowed: boolean;
  defaultFocus?: boolean;
  className?: string;
}) {
  if (!allowed) return null;
  const cls = `access-menu-btn ${defaultFocus ? "is-default-focus" : ""} ${className ?? ""}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  );
}

export function MainMenu() {
  const { canView, isAdmin, logout } = useAuth();
  const { t } = useI18n();
  useCalendar();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const canSeeVoltage = canView("voltage") || canView("dashboard") || canView("monitoring");
  // Always fetch when the user can see voltage-related UI (incl. Inspector role).
  const dashboardQuery = useQuery({
    queryKey: ["statistics", "dashboard", "main-menu-voltage"],
    queryFn: statisticsApi.dashboard,
    enabled: canSeeVoltage,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
  });
  const settings = settingsQuery.data;
  const voltage = dashboardQuery.data?.voltage;

  return (
    <div className="access-eap flex h-full min-h-0 flex-1 flex-col" dir="ltr">
      <div className="flex min-h-0 flex-1">
        <aside className="access-strip flex w-[102px] shrink-0 flex-col items-center px-1.5 pb-3 pt-2">
          <div className="mb-4 flex justify-center">
            <UhdeCellBars height={48} />
          </div>
          <div className="access-uhde-card space-y-0.5 text-center text-[11px] leading-tight text-black">
            <div>{t("mainMenu.uhde")}</div>
            <div>{t("mainMenu.uhdeDept")}</div>
            <div className="pt-2">{t("mainMenu.uhdeStreet")}</div>
            <div>{t("mainMenu.uhdeCity")}</div>
          </div>
          <div className="mt-auto flex justify-center pt-6">
            <div className="access-logo-well">
              <UhdeLogoMark size={48} />
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-4 pt-1">
          <div className="access-header-sunken mb-3 px-4 pb-3 pt-2">
            <div className="mb-2 flex items-center justify-between gap-4">
              <h1 className="min-w-0 flex-1 text-start text-[20px] font-bold leading-tight text-black">
                {t("mainMenu.programTitle")}
              </h1>
              <div className="flex h-[72px] w-[200px] shrink-0 items-center justify-end bg-transparent p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo-arvand.png"
                  alt="Arvand Petrochemical Company"
                  className="h-full max-h-[72px] w-auto max-w-full object-contain"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-black">
              <span>
                <span className="font-bold">{t("mainMenu.client")}:</span> {settings?.customer || "—"}
              </span>
              <span>
                <span className="font-bold">{t("mainMenu.typeOfPlant")}:</span> {settings?.plant_type || "—"}
              </span>
              <span>
                <span className="font-bold">{t("mainMenu.uan")}:</span> {settings?.uan || "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold">{t("mainMenu.version")}:</span>
                <span className="access-field-box">{APP_VERSION}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold">{t("mainMenu.date")}:</span>
                <span className="access-field-box">{formatDate(settings?.date)}</span>
              </span>
            </div>
          </div>

          <div className="mb-3">
            {canSeeVoltage ? (
              <VoltageReportPanel
                voltage={voltage}
                compact
                loading={dashboardQuery.isLoading}
                error={dashboardQuery.isError ? (dashboardQuery.error as Error).message : null}
              />
            ) : null}
          </div>

          <div className="access-main-grid">
            <MenuButton
              href="/elements"
              label={t("mainMenu.elementAdministration")}
              allowed={canView("elements")}
              defaultFocus
              className="col-start-1 row-start-1"
            />
            <MenuButton
              href="/arrangement"
              label={t("mainMenu.cellArrangement")}
              allowed={canView("settings") || canView("elements")}
              className="col-start-1 row-start-2"
            />
            <MenuButton href="/search" label={t("mainMenu.search")} allowed={canView("search")} className="col-start-1 row-start-3" />
            <MenuButton
              href="/storage"
              label={t("nav.storage")}
              allowed={canView("storage") || canView("anodes") || canView("cathodes") || canView("membranes")}
              className="col-start-1 row-start-4"
            />

            <MenuButton
              href="/monitoring"
              label={t("nav.monitoring")}
              allowed={canView("monitoring") || canView("voltage")}
              className="col-start-3 row-start-2"
            />
            <MenuButton
              href="/plant-charts"
              label={t("mainMenu.plantCharts")}
              allowed={canView("monitoring") || canView("voltage") || canView("statistics")}
              className="col-start-3 row-start-3"
            />
            <MenuButton
              href="/voltage"
              label={t("mainMenu.standardizedVoltage")}
              allowed={canView("voltage")}
              className="col-start-2 row-start-1"
            />
            <MenuButton
              href="/current-efficiency"
              label={t("mainMenu.currentEfficiency")}
              allowed={canView("voltage")}
              className="col-start-2 row-start-2"
            />
            <MenuButton
              href="/power-consumption"
              label={t("mainMenu.powerConsumption")}
              allowed={canView("statistics")}
              className="col-start-2 row-start-3"
            />
            <MenuButton href="/un-ce" label={t("mainMenu.unCe")} allowed={canView("reports")} className="col-start-2 row-start-4" />
            <MenuButton
              href="/test-run-results"
              label={t("mainMenu.testRunResults")}
              allowed={canView("voltage")}
              className="col-start-2 row-start-5"
            />

            <MenuButton href="/analyses" label={t("mainMenu.analysis")} allowed={canView("analyses")} className="col-start-3 row-start-1" />
            <MenuButton
              href="/statistics"
              label={t("mainMenu.statistics")}
              allowed={canView("statistics")}
              className="col-start-4 row-start-1"
            />
            <MenuButton href="/shutdowns" label={t("mainMenu.shutDown")} allowed={canView("shutdowns")} className="col-start-5 row-start-1" />

            <MenuButton href="/remarks" label={t("mainMenu.remarks")} allowed={canView("remarks")} className="col-start-7 row-start-1" />
            <MenuButton href="/about" label={t("mainMenu.aboutEap")} allowed className="col-start-7 row-start-2" />
            <MenuButton href="/settings" label={t("mainMenu.settings")} allowed={canView("settings")} className="col-start-7 row-start-3" />
            <MenuButton href="/users" label={t("nav.users")} allowed={isAdmin} className="col-start-7 row-start-4" />
            <MenuButton href="/logs" label={t("nav.logs")} allowed={isAdmin} className="col-start-7 row-start-5" />
            <MenuButton href="/activity" label={t("nav.activity")} allowed={canView("activity")} className="col-start-5 row-start-2" />
            <MenuButton onClick={logout} label={t("mainMenu.exit")} allowed className="col-start-7 row-start-6" />
          </div>
        </section>
      </div>
    </div>
  );
}
