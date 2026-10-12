"use client";

import { Suspense } from "react";
import { AccessFormWindow } from "@/components/layout/access-form";
import { TicketsPanel } from "@/components/domain/tickets-panel";
import { LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";

/** Open to every signed-in user, whatever their role. */
export default function TicketsPage() {
  const { t } = useI18n();
  return (
    <AccessFormWindow caption={t("tickets.title")}>
      <Suspense fallback={<LoadingState />}>
        <TicketsPanel />
      </Suspense>
    </AccessFormWindow>
  );
}
