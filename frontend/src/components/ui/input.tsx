import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)] px-2 py-1 text-sm text-[var(--win-text)] placeholder:text-[#8a8a8a] focus:outline focus:outline-1 focus:outline-[var(--win-navy)] focus:-outline-offset-1 disabled:bg-[var(--win-face-dark)] disabled:text-[var(--win-muted)]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClass, className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-xs font-bold text-[var(--win-muted)]", className)} {...props} />;
}
