"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  guide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Larger shell + taller body for the Element Report visual guide. */
  guide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const width = guide ? "max-w-[92vw] xl:max-w-7xl" : wide ? "max-w-6xl" : "max-w-lg";

  return createPortal(
    <div className={`ui-modal-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-6 sm:px-4 ${guide ? "sm:py-8" : "py-10"}`}>
      <div className={`ui-modal w-full ${width} border-2 border-[var(--win-face)] [border-style:outset] bg-[var(--win-face)] shadow-2xl`}>
        <div className={`ui-modal-header flex items-center justify-between gap-3 bg-gradient-to-r from-[var(--win-navy)] to-[var(--win-navy-mid)] ${guide ? "px-5 py-3" : "px-3 py-1.5"}`}>
          <h3 className={`truncate font-bold text-white ${guide ? "text-lg sm:text-xl" : "text-sm"}`}>{title}</h3>
          <button
            onClick={onClose}
            className="ui-modal-close flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--win-face)] [border-style:outset] bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)] active:[border-style:inset]"
          >
            <X size={14} />
          </button>
        </div>
        <div className={`ui-modal-body overflow-y-auto ${guide ? "max-h-[min(90vh,960px)] p-5 sm:p-7" : "max-h-[75vh] p-4"}`}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
