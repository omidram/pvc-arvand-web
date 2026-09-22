"use client";

import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Icon size={28} className="text-[var(--win-muted)] opacity-60" />
      <div className="text-sm font-bold text-[var(--win-muted)]">{title ?? t("common.noRecordsFound")}</div>
      {description && <div className="max-w-sm text-xs text-[var(--win-muted)] opacity-80">{description}</div>}
    </div>
  );
}
