"use client";

import { Suspense } from "react";
import { AssemblyDataForm } from "@/components/domain/assembly-data-form";
import { LoadingState } from "@/components/ui/spinner";

export default function AssemblyDataPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AssemblyDataForm />
    </Suspense>
  );
}
