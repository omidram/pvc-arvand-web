import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "cyan",
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  accent?: "cyan" | "emerald" | "amber" | "violet" | "rose" | "blue";
}) {
  const accents: Record<string, string> = {
    cyan: "bg-[#cfe4f7] text-[#0a246a] border-[#5b8fc7]",
    emerald: "bg-[#d9f0d9] text-[#0d5c0d] border-[#5fa85f]",
    amber: "bg-[#fbe7c6] text-[#8a5a00] border-[#c99a3f]",
    violet: "bg-[#e3d9f7] text-[#4a2a8a] border-[#9c7fce]",
    rose: "bg-[#fbd7d7] text-[#a10000] border-[#c96a6a]",
    blue: "bg-[#d6e3f7] text-[#123a7a] border-[#6c8fc9]",
  };

  return (
    <div
      data-accent={accent}
      className="ui-stat flex items-center justify-between border-2 border-[var(--win-face)] bg-[var(--win-face)] p-3 [border-style:outset]"
    >
      <div>
        <div className="ui-stat-label text-[11px] font-bold uppercase tracking-wide text-[var(--win-muted)]">{label}</div>
        <div className="ui-stat-value mt-1 text-xl font-bold text-[var(--win-navy)]">{value}</div>
      </div>
      <div className={cn("ui-stat-icon flex h-9 w-9 items-center justify-center border [border-style:solid]", accents[accent])}>
        <Icon size={18} />
      </div>
    </div>
  );
}
