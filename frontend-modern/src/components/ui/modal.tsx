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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10">
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} border-2 border-[var(--win-face)] rounded-lg bg-[var(--win-face)] shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-[var(--win-navy)] to-[var(--win-navy-mid)] px-3 py-1.5">
          <h3 className="truncate text-sm font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="flex h-5 w-5 shrink-0 items-center justify-center border border-[var(--win-face)] rounded-lg bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)]"
          >
            <X size={12} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
