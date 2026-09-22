"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-[var(--win-navy)]", className)} size={20} />;
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--win-muted)]">
      <Spinner />
      {label ?? t("common.loading")}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="border-2 border-[var(--win-danger)] [border-style:solid] bg-[#fbd7d7] px-4 py-3 text-sm font-semibold text-[var(--win-danger)]">
      {message}
    </div>
  );
}
