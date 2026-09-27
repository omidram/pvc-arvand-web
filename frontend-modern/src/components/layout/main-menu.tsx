"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { SessionControls } from "@/components/layout/session-controls";
import { UhdeRings } from "@/components/layout/uhde-mark";

function accessDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}-\d{2}-\d{2}/.test(value)) {
    return `${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
  }
  return value;
}

function MenuButton({
  href,
  onClick,
  label,
  allowed,
  autoFocus,
  className,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
  allowed: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const cls = `access-menu-btn ${className ?? ""}`;
  if (!allowed) {
    return (
      <button type="button" disabled className={cls} aria-disabled="true" title={label}>
        {label}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className={cls} autoFocus={autoFocus}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} autoFocus={autoFocus}>
      {label}
    </button>
  );
}

export function MainMenu() {
  const { t } = useI18n();
  const { canView, logout } = useAuth();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const settings = settingsQuery.data;

  return (
    <div className="access-eap flex min-h-full flex-1 flex-col" dir="ltr">
      <div className="flex items-center justify-end gap-2 px-2 py-1">
        <SessionControls classic />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="access-strip flex w-[92px] shrink-0 flex-col items-center px-1 pb-3 pt-2">
          <div className="mb-5 flex h-11 justify-center gap-[3px]">
            <span className="h-full w-[7px] bg-[#1a3a9a]" />
            <span className="h-full w-[7px] bg-white" />
            <span className="h-full w-[7px] bg-[#c41212]" />
          </div>
          <div className="space-y-1 text-center text-[11px] leading-tight text-black">
            <div>{t("mainMenu.uhde")}</div>
            <div>{t("mainMenu.uhdeDept")}</div>
            <div className="pt-2">{t("mainMenu.uhdeStreet")}</div>
            <div>{t("mainMenu.uhdeCity")}</div>
          </div>
          <div className="mt-auto flex justify-center pt-6">
            <div className="access-logo-well">
              <UhdeRings size={44} />
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col px-3 pb-4 pt-1">
          <div className="access-header-sunken mb-5 px-4 pb-3 pt-2">
            <h1 className="mb-3 text-center text-[22px] font-bold leading-tight text-black">{t("mainMenu.programTitle")}</h1>
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
                <span className="access-field-box">{settings?.version || "—"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold">{t("mainMenu.date")}:</span>
                <span className="access-field-box">{accessDate(settings?.date) || "—"}</span>
              </span>
            </div>
          </div>

          <div
            className="grid min-h-[260px] flex-1 grid-cols-[154px_154px_128px_128px_128px_minmax(24px,1fr)_140px] grid-rows-[repeat(5,28px)] content-start gap-x-3 gap-y-[11px]"
            style={{ minWidth: 820 }}
          >
            <MenuButton
              href="/elements"
              label={t("mainMenu.elementAdministration")}
              allowed={canView("elements")}
              autoFocus
              className="col-start-1 row-start-1"
            />
            <MenuButton
              href="/settings?tab=arrangements"
              label={t("mainMenu.cellArrangement")}
              allowed={canView("settings")}
              className="col-start-1 row-start-2"
            />
            <MenuButton href="/search" label={t("mainMenu.search")} allowed={canView("search")} className="col-start-1 row-start-3" />

            <MenuButton
              href="/voltage"
              label={t("mainMenu.standardizedVoltage")}
              allowed={canView("voltage")}
              className="col-start-2 row-start-1"
            />
            <MenuButton
              href="/voltage?tab=current-efficiency"
              label={t("mainMenu.currentEfficiency")}
              allowed={canView("voltage")}
              className="col-start-2 row-start-2"
            />
            <MenuButton
              href="/statistics"
              label={t("mainMenu.powerConsumption")}
              allowed={canView("statistics")}
              className="col-start-2 row-start-3"
            />
            <MenuButton href="/reports" label={t("mainMenu.unCe")} allowed={canView("reports")} className="col-start-2 row-start-4" />
            <MenuButton
              href="/voltage?tab=readings"
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
            <MenuButton onClick={logout} label={t("mainMenu.exit")} allowed className="col-start-7 row-start-5" />
          </div>
        </section>
      </div>
    </div>
  );
}
