"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AccessFormWindow } from "@/components/layout/access-form";
import { GroupOverviewPanel } from "@/components/domain/group-overview-panel";
import { LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

function GroupOverviewPage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  const group = useSearchParams().get("group") || "";
  if (!canView("elements")) return null;
  return (
    <AccessFormWindow caption={t("groups.overview")} helpKey="elements" backHref="/elements" backLabel={t("elements.title")}>
      <GroupOverviewPanel initialGroup={group} />
    </AccessFormWindow>
  );
}

export default function GroupOverviewRoute() {
  return (
    <Suspense fallback={<LoadingState />}>
      <GroupOverviewPage />
    </Suspense>
  );
}
