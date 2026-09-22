"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { UhdeCellBars, UhdeLogoMark } from "@/components/layout/uhde-mark";
import { translations } from "@/lib/i18n/translations";

const m = translations.en.mainMenu;

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
  const cls = `access-menu-btn ${defaultFocus ? "is-default-focus" : ""} ${className ?? ""}`;
  if (!allowed) {
    return (
      <button type="button" disabled className={cls} aria-disabled="true" title={label}>
        {label}
      </button>
    );
  }
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
  const { canView, logout } = useAuth();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const settings = settingsQuery.data;

  return (
    <div className="access-eap flex h-full min-h-0 flex-1 flex-col" dir="ltr">
      <div className="flex min-h-0 flex-1">
        <aside className="access-strip flex w-[102px] shrink-0 flex-col items-center px-1.5 pb-3 pt-2">
          <div className="mb-4 flex justify-center">
            <UhdeCellBars height={48} />
          </div>
          <div className="access-uhde-card space-y-0.5 text-center text-[11px] leading-tight text-black">
            <div>{m.uhde}</div>
            <div>{m.uhdeDept}</div>
            <div className="pt-2">{m.uhdeStreet}</div>
            <div>{m.uhdeCity}</div>
          </div>
          <div className="mt-auto flex justify-center pt-6">
            <div className="access-logo-well">
              <UhdeLogoMark size={48} />
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col px-3 pb-4 pt-1">
          <div className="access-header-sunken mb-5 px-4 pb-3 pt-2">
            <h1 className="mb-3 text-center text-[22px] font-bold leading-tight text-black">{m.programTitle}</h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-black">
              <span>
                <span className="font-bold">{m.client}:</span> {settings?.customer || "—"}
              </span>
              <span>
                <span className="font-bold">{m.typeOfPlant}:</span> {settings?.plant_type || "—"}
              </span>
              <span>
                <span className="font-bold">{m.uan}:</span> {settings?.uan || "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold">{m.version}:</span>
                <span className="access-field-box">{settings?.version || "—"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="font-bold">{m.date}:</span>
                <span className="access-field-box">{accessDate(settings?.date) || "—"}</span>
              </span>
            </div>
          </div>

          <div
            className="grid min-h-[260px] flex-1 content-start overflow-x-auto"
            style={{
              display: "grid",
              minWidth: 820,
              gridTemplateColumns: "154px 154px 128px 128px 128px minmax(24px, 1fr) 140px",
              gridTemplateRows: "repeat(5, 28px)",
              columnGap: 12,
              rowGap: 11,
            }}
          >
            <MenuButton
              href="/elements"
              label={m.elementAdministration}
              allowed={canView("elements")}
              defaultFocus
              className="col-start-1 row-start-1"
            />
            <MenuButton
              href="/settings?tab=arrangements"
              label={m.cellArrangement}
              allowed={canView("settings")}
              className="col-start-1 row-start-2"
            />
            <MenuButton href="/search" label={m.search} allowed={canView("search")} className="col-start-1 row-start-3" />

            <MenuButton
              href="/voltage"
              label={m.standardizedVoltage}
              allowed={canView("voltage")}
              className="col-start-2 row-start-1"
            />
            <MenuButton
              href="/current-efficiency"
              label={m.currentEfficiency}
              allowed={canView("voltage")}
              className="col-start-2 row-start-2"
            />
            <MenuButton
              href="/power-consumption"
              label={m.powerConsumption}
              allowed={canView("statistics")}
              className="col-start-2 row-start-3"
            />
            <MenuButton href="/un-ce" label={m.unCe} allowed={canView("reports")} className="col-start-2 row-start-4" />
            <MenuButton
              href="/test-run-results"
              label={m.testRunResults}
              allowed={canView("voltage")}
              className="col-start-2 row-start-5"
            />

            <MenuButton href="/analyses" label={m.analysis} allowed={canView("analyses")} className="col-start-3 row-start-1" />
            <MenuButton
              href="/statistics"
              label={m.statistics}
              allowed={canView("statistics")}
              className="col-start-4 row-start-1"
            />
            <MenuButton href="/shutdowns" label={m.shutDown} allowed={canView("shutdowns")} className="col-start-5 row-start-1" />

            <MenuButton href="/remarks" label={m.remarks} allowed={canView("remarks")} className="col-start-7 row-start-1" />
            <MenuButton href="/about" label={m.aboutEap} allowed className="col-start-7 row-start-2" />
            <MenuButton href="/settings" label={m.settings} allowed={canView("settings")} className="col-start-7 row-start-3" />
            <MenuButton onClick={logout} label={m.exit} allowed className="col-start-7 row-start-5" />
          </div>
        </section>
      </div>
    </div>
  );
}
