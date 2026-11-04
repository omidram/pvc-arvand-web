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
  const lines = body.split("\n");

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
      <Modal open={open} onClose={() => setOpen(false)} title={`${t("common.help")} — ${title}`} wide>
        <article className="help-guide space-y-1 text-[15px] leading-7 text-[var(--win-text)]" dir="auto">
          {lines.map((line, i) => {
            const text = line.trimEnd();
            if (!text.trim()) return <div key={i} className="h-2" />;
            if (text.startsWith("# ")) {
              return (
                <h4 key={i} className="mt-4 border-b border-[var(--win-border)] pb-1 text-base font-bold text-[var(--win-navy)] first:mt-0">
                  {text.slice(2)}
                </h4>
              );
            }
            return <p key={i}>{text}</p>;
          })}
        </article>
      </Modal>
    </>
  );
}
