"use client";

import Link from "next/link";
import { HelpButton } from "@/components/ui/help-button";
import { useI18n } from "@/lib/i18n/context";
import { AccessHub } from "@/components/layout/access-hub";

export function AccessFormWindow({
  caption,
  helpKey,
  commands,
  nav,
  children,
  classic = true,
  titleBlue,
  backHref,
  backLabel,
}: {
  caption: string;
  helpKey?: string;
  commands?: React.ReactNode;
  nav?: React.ReactNode;
  children: React.ReactNode;
  classic?: boolean;
  titleBlue?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  const { t } = useI18n();
  if (classic) {
    return (
      <AccessHub
        title={caption}
        titleBlue={titleBlue}
        backHref={backHref}
        backLabel={backLabel}
        extraButtons={
          <>
            {helpKey ? <HelpButton helpKey={helpKey} /> : null}
            {commands}
          </>
        }
      >
        {nav ? <div className="access-form-nav access-form-nav-top">{nav}</div> : null}
        {children}
      </AccessHub>
    );
  }
  return (
    <div className="access-form-window">
      <div className="access-form-caption">
        <Link href="/" className="access-toolbar-btn h-[18px] px-2 text-[10px] text-black">
          {t("common.mainMenu")}
        </Link>
        <span className="truncate">{caption}</span>
        {helpKey ? <HelpButton helpKey={helpKey} /> : null}
        <span className="ms-auto flex items-center gap-1">{commands}</span>
      </div>
      {nav ? <div className="access-form-nav access-form-nav-top">{nav}</div> : null}
      <div className="access-form-body">{children}</div>
    </div>
  );
}

export function AccessSubform({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="access-subform mt-3">
      <div className="access-subform-caption">{caption}</div>
      <div className="p-1">{children}</div>
    </div>
  );
}

export function AccessNav({
  index,
  total,
  isNew,
  canEdit,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onNew,
  onSave,
  onDelete,
  onFind,
  findValue,
  saving,
  view,
  onView,
  hideFind,
}: {
  index: number;
  total: number;
  isNew?: boolean;
  canEdit?: boolean;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  onNew?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onFind: (value: string) => void;
  findValue: string;
  saving?: boolean;
  view: "form" | "datasheet";
  onView: (view: "form" | "datasheet") => void;
  hideFind?: boolean;
}) {
  const { t } = useI18n();
  const pos = isNew ? "*" : total === 0 ? "0" : String(index + 1);
  return (
    <>
      <button type="button" className="access-nav-btn" onClick={onFirst} disabled={index <= 0} title={t("access.first")}>
        «
      </button>
      <button type="button" className="access-nav-btn" onClick={onPrev} disabled={index <= 0} title={t("access.previous")}>
        ‹
      </button>
      <span className="px-1">
        {t("access.record")} {pos} {t("access.of")} {total}
      </span>
      <button type="button" className="access-nav-btn" onClick={onNext} disabled={index >= total - 1} title={t("access.next")}>
        ›
      </button>
      <button type="button" className="access-nav-btn" onClick={onLast} disabled={index >= total - 1} title={t("access.last")}>
        »
      </button>
      {canEdit && onNew ? (
        <button type="button" className="access-nav-btn" onClick={onNew}>
          {t("access.newRecord")}
        </button>
      ) : null}
      {canEdit && onSave ? (
        <button type="button" className="access-nav-btn" onClick={onSave} disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      ) : null}
      {canEdit && onDelete && !isNew ? (
        <button type="button" className="access-nav-btn text-[var(--win-danger)]" onClick={onDelete}>
          {t("common.delete")}
        </button>
      ) : null}
      {hideFind ? null : (
      <input
        className="ms-2 h-[22px] w-40 border-2 border-[var(--win-border-shadow)] bg-[var(--win-input)] px-1 text-[11px] [border-style:inset]"
        placeholder={t("access.find")}
        value={findValue}
        onChange={(e) => onFind(e.target.value)}
      />
      )}
      <span className="ms-auto flex gap-1">
        <button type="button" className={`access-nav-btn ${view === "form" ? "is-active" : ""}`} onClick={() => onView("form")}>
          {t("access.formView")}
        </button>
        <button
          type="button"
          className={`access-nav-btn ${view === "datasheet" ? "is-active" : ""}`}
          onClick={() => onView("datasheet")}
        >
          {t("access.datasheetView")}
        </button>
      </span>
    </>
  );
}
