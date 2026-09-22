"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { getAccessFormShortcuts } from "@/lib/access-form-routes";

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

export function AllFormsPane() {
  const { canView } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [q, setQ] = useState("");
  const shortcuts = useMemo(() => getAccessFormShortcuts(), []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return shortcuts;
    return shortcuts.filter((item) => item.name.toLowerCase().includes(term));
  }, [q, shortcuts]);

  return (
    <aside className="access-forms-pane min-h-0 self-stretch" dir="ltr">
      <div className="access-forms-pane-header">
        <span>All Forms</span>
        <span className="access-forms-pane-count">{filtered.length}</span>
      </div>
      <div className="access-forms-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search forms…"
          aria-label="Search forms"
        />
      </div>
      <div className="access-forms-list">
        {filtered.map((item) => {
          const allowed = !item.formKey || canView(item.formKey);
          const active = isCurrentForm(item.href, pathname, query);
          const className = `access-forms-item${item.kind === "subform" ? " is-subform" : ""}${allowed ? "" : " is-disabled"}${active ? " is-active" : ""}`;
          if (!allowed) {
            return (
              <span key={item.name} className={className} title={item.name}>
                <AccessFormIcon />
                <span className="access-forms-item-label">{item.name}</span>
              </span>
            );
          }
          return (
            <Link key={item.name} href={item.href} className={className} title={item.name}>
              <AccessFormIcon />
              <span className="access-forms-item-label">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
