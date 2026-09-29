"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MaintenanceReportPanel } from "@/components/domain/maintenance-report-panel";
import { LoadingState } from "@/components/ui/spinner";
import type { MaintenanceReportKind } from "@/lib/endpoints";

function MaintenanceReportsInner() {
  const kindParam = useSearchParams().get("kind");
  const kind: MaintenanceReportKind = kindParam === "cathode" || kindParam === "membrane" ? kindParam : "anode";
  return <MaintenanceReportPanel key={kind} kind={kind} />;
}

export default function MaintenanceReportsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MaintenanceReportsInner />
    </Suspense>
  );
}
