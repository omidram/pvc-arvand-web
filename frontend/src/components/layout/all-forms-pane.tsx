"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { getAccessFormShortcuts } from "@/lib/access-form-routes";
import { useI18n } from "@/lib/i18n/context";

function AccessFormIcon() {
  return (
    <span className="access-nav-form-icon" aria-hidden>
      <span className="access-nav-form-icon-bar" />
    </span>
  );
}

function isCurrentForm(href: string, pathname: string, query: string): boolean {
  const [path, search = ""] = href.split("?");
  if (path === "/") return false;
  if (path !== pathname) return false;
  if (!search) return true;
  return search.split("&").every((part) => query.includes(part));
}

export function AllFormsPane({ onCollapse }: { onCollapse?: () => void }) {
  const { t } = useI18n();
  const { canView } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [q, setQ] = useState("");
  const shortcuts = useMemo(() => getAccessFormShortcuts(), []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const allowedOnly = shortcuts.filter((item) => !item.formKey || canView(item.formKey));
    if (!term) return allowedOnly;
    return allowedOnly.filter(
      (item) => item.label.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)
    );
  }, [q, shortcuts, canView]);

  return (
    <aside className="access-forms-pane min-h-0 self-stretch" dir="ltr">
      <div className="access-forms-pane-header">
        <span>{t("menus.allForms")}</span>
        <span className="access-forms-pane-tools">
          <span className="access-forms-pane-count">{filtered.length}</span>
          {onCollapse ? (
            <button
              type="button"
              className="access-forms-collapse"
              onClick={onCollapse}
              title={t("menus.collapseForms")}
              aria-label={t("menus.collapseForms")}
            >
              ›
            </button>
          ) : null}
        </span>
      </div>
      <div className="access-forms-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("menus.searchForms")}
          aria-label={t("menus.searchForms")}
        />
      </div>
      <div className="access-forms-list">
        {filtered.map((item) => {
          const active = isCurrentForm(item.href, pathname, query);
          const className = `access-forms-item${item.kind === "subform" ? " is-subform" : ""}${active ? " is-active" : ""}`;
          return (
            <Link key={item.name} href={item.href} className={className} title={`${item.label} (${item.name})`}>
              <AccessFormIcon />
              <span className="access-forms-item-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
