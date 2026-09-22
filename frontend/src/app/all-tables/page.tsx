"use client";

import { AccessFormWindow } from "@/components/layout/access-form";
import { Tabs } from "@/components/ui/tabs";
import { GenericTableSection } from "@/components/domain/generic-table-section";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ALL_TABLES_REGISTRY, type TableRegistryEntry } from "@/lib/all-tables-registry";

function canSeeEntry(entry: TableRegistryEntry, canView: (formKey: string) => boolean, isAdmin: boolean): boolean {
  if (entry.formKey === "__admin__") return isAdmin;
  if (!entry.formKey) return true;
  return canView(entry.formKey);
}

export default function AllFormsPage() {
  const { t } = useI18n();
  const { canView, isAdmin } = useAuth();

  const categories = ALL_TABLES_REGISTRY.map((category) => ({
    ...category,
    entries: category.entries.filter((entry) => canSeeEntry(entry, canView, isAdmin)),
  })).filter((category) => category.entries.length > 0);

  return (
    <AccessFormWindow caption={t("allTables.title")} helpKey="allTables">
      {categories.length === 0 ? (
        <p className="text-sm text-[var(--win-muted)]">{t("common.accessDenied")}</p>
      ) : (
        <Tabs
          tabs={categories.map((category) => ({
            key: category.key,
            label: t(category.titleKey),
            content: (
              <div className="space-y-2">
                {category.entries.map((entry) => {
                  const title = entry.subtitleKey ? `${t(entry.titleKey)} — ${t(entry.subtitleKey)}` : t(entry.titleKey);
                  return (
                    <GenericTableSection key={entry.key} title={title} endpoint={entry.endpoint} linkHref={entry.linkHref} />
                  );
                })}
              </div>
            ),
          }))}
        />
      )}
    </AccessFormWindow>
  );
}
