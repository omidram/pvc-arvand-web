"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: { key: string; label: string; content: React.ReactNode }[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab || tabs[0]?.key);
  const activeTab = tabs.find((tab) => tab.key === active) || tabs[0];

  useEffect(() => {
    if (defaultTab && tabs.some((tab) => tab.key === defaultTab)) {
      setActive(defaultTab);
    }
    // tabs is a new array each render; only open the requested tab when the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTab]);

  return (
    <div>
      <div className="flex flex-wrap gap-0.5 px-0.5 pt-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "relative z-0 border-2 border-b-0 px-3 py-1.5 text-xs font-bold [border-style:outset]",
              active === tab.key
                ? "z-10 -mb-0.5 bg-[var(--win-face)] pb-2 text-[var(--win-navy)]"
                : "translate-y-0.5 bg-[var(--win-face-dark)] text-[var(--win-muted)] hover:bg-[var(--win-face)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="border-2 border-[var(--win-face)] [border-style:outset] bg-[var(--win-face)] p-4">
        {activeTab?.content}
      </div>
    </div>
  );
}
