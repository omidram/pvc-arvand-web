"use client";

import { Suspense } from "react";
import { WorkOrderPanel } from "@/components/domain/work-order-panel";
import { LoadingState } from "@/components/ui/spinner";

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <WorkOrderPanel />
    </Suspense>
  );
}
