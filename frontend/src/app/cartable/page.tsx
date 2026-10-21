"use client";

import { Suspense } from "react";
import { AccessFormWindow } from "@/components/layout/access-form";
import { WarehouseLifecycleHub } from "@/components/domain/warehouse-lifecycle-hub";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import { useI18n } from "@/lib/i18n/context";
import { CARTABLE_VIEW_KEYS } from "@/lib/workflow";

export default function CartablePage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  useCalendar();
  const allowed = CARTABLE_VIEW_KEYS.some((k) => canView(k));

  if (!allowed) {
    return (
      <AccessFormWindow caption={t("wf.cartableTitle")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  return (
    <AccessFormWindow caption={t("wf.cartableTitle")} helpKey="storage">
      <Suspense fallback={<LoadingState />}>
        <WarehouseLifecycleHub page="cartable" />
      </Suspense>
    </AccessFormWindow>
  );
}
