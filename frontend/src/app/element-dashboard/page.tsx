"use client";

import { Suspense } from "react";
import { AccessFormWindow } from "@/components/layout/access-form";
import { ElementDashboardPanel } from "@/components/domain/element-dashboard-panel";
import { LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

export default function ElementDashboardPage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  if (!(canView("elements") || canView("anodes") || canView("cathodes") || canView("membranes") || canView("storage"))) return null;
  return (
    <AccessFormWindow caption={t("elDash.title")} helpKey="elements">
      <Suspense fallback={<LoadingState />}>
        <ElementDashboardPanel />
      </Suspense>
    </AccessFormWindow>
  );
}
