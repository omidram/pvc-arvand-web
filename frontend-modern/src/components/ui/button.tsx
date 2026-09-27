import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export function Button({ className, variant = "primary", size = "md", disabled, ...props }: ButtonProps) {
  const variants: Record<string, string> = {
    primary: "border-transparent bg-[var(--win-navy)] text-white font-semibold hover:bg-[var(--win-navy-dark)]",
    secondary: "bg-[var(--win-face)] text-[var(--win-text)] hover:bg-[var(--win-face-hi)]",
    ghost:
      "border-transparent bg-transparent text-[var(--win-navy)] hover:border-[var(--win-face)] hover:bg-[var(--win-face)] [border-style:solid]",
    danger: "bg-[var(--win-face)] text-[var(--win-danger)] font-bold hover:bg-[var(--win-face-hi)]",
  };
  const sizes: Record<string, string> = {
    sm: "px-2 py-1 text-xs gap-1",
    md: "px-3 py-1.5 text-sm gap-1.5",
  };

  return (
    <button
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center border-2 border-[var(--win-face)] rounded-lg disabled:cursor-not-allowed disabled:text-[#6b6b6b]",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}
