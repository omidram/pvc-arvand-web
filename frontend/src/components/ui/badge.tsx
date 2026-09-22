import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  slate: "bg-[var(--win-face-hi)] text-[var(--win-text)] border-[var(--win-border-shadow)]",
  cyan: "bg-[#cfe4f7] text-[#0a246a] border-[#5b8fc7]",
  emerald: "bg-[#d9f0d9] text-[#0d5c0d] border-[#5fa85f]",
  amber: "bg-[#fbe7c6] text-[#8a5a00] border-[#c99a3f]",
  rose: "bg-[#fbd7d7] text-[#a10000] border-[#c96a6a]",
  violet: "bg-[#e3d9f7] text-[#4a2a8a] border-[#9c7fce]",
};

export function Badge({
  children,
  color = "slate",
  className,
}: {
  children: React.ReactNode;
  color?: keyof typeof COLORS;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-[11px] font-bold [border-style:solid]",
        COLORS[color],
        className
      )}
    >
      {children}
    </span>
  );
}

export function statusColor(status: string | null | undefined): keyof typeof COLORS {
  switch (status) {
    case "active":
      return "emerald";
    case "planned":
      return "slate";
    case "decommissioned":
      return "amber";
    case "disassembled":
      return "rose";
    default:
      return "slate";
  }
}
