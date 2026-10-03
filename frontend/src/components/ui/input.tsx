"use client";

import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { DateInput } from "@/components/ui/date-input";

const fieldClass =
  "ui-field w-full border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] px-2 py-1 text-sm text-[var(--win-text)] placeholder:text-[#8a8a8a] focus:outline focus:outline-1 focus:outline-[var(--win-navy)] focus:-outline-offset-1 disabled:bg-[var(--win-face-dark)] disabled:text-[var(--win-muted)]";

export function Input({ className, type, dir, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  if (type === "date" || type === "datetime-local") {
    return (
      <DateInput
        className={cn(fieldClass, className)}
        type={type as "date" | "datetime-local"}
        {...props}
      />
    );
  }
  // dir=auto + plaintext keeps mixed Persian/English phrases in reading order.
  const textLike = !type || type === "text" || type === "search" || type === "url" || type === "tel";
  return (
    <input
      className={cn(fieldClass, textLike && "bidi-plaintext", className)}
      type={type}
      dir={dir ?? (textLike ? "auto" : undefined)}
      {...props}
    />
  );
}

export function Textarea({ className, dir, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldClass, "bidi-plaintext", className)}
      dir={dir ?? "auto"}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("ui-label mb-1 block text-xs font-bold text-[var(--win-muted)]", className)} {...props} />;
}
