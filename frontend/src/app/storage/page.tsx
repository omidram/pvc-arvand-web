"use client";

import { AccessFormWindow } from "@/components/layout/access-form";
import { WarehouseLifecycleHub } from "@/components/domain/warehouse-lifecycle-hub";
import { ErrorState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import { useI18n } from "@/lib/i18n/context";

export default function StoragePage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  useCalendar();
  const allowed = canView("storage") || canView("anodes") || canView("cathodes") || canView("membranes");

  if (!allowed) {
    return (
      <AccessFormWindow caption={t("storage.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  return (
    <AccessFormWindow caption={t("storage.title")} helpKey="storage">
      <WarehouseLifecycleHub />
    </AccessFormWindow>
  );
}
