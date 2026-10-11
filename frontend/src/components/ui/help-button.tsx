"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Modal } from "./modal";
import { ElementReportGuideModal } from "@/components/domain/element-report-guide";
import { useI18n } from "@/lib/i18n/context";

/**
 * Small circular "?" icon that opens a modal with bilingual help text for the
 * current form. Content is looked up from "help.<helpKey>" (title + body).
 * Element Report / Dashboard opens the full visual guide instead of a bullet list.
 */
export function HelpButton({ helpKey }: { helpKey: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const richGuide = helpKey === "elementReport";

  if (richGuide) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t("common.help")}
          aria-label={t("common.help")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--win-border-shadow)] bg-[var(--win-input)] text-[var(--win-navy)] shadow-sm transition-colors hover:bg-[var(--win-face-hi)] active:[border-style:inset]"
        >
          <HelpCircle size={15} />
        </button>
        <ElementReportGuideModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  const title = t(`help.${helpKey}.title`);
  const body = t(`help.${helpKey}.body`);
  const lines = body.split("\n").filter(Boolean);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("common.help")}
        aria-label={t("common.help")}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--win-border-shadow)] bg-[var(--win-input)] text-[var(--win-navy)] shadow-sm transition-colors hover:bg-[var(--win-face-hi)] active:[border-style:inset]"
      >
        <HelpCircle size={15} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${t("common.help")} — ${title}`}>
        <ul className="list-disc space-y-2 ps-5 text-sm leading-relaxed text-[var(--win-text)]">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
