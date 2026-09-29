"use client";

import type { ImportProgress } from "@/lib/endpoints";

export function ImportProgressBar({ progress, wide }: { progress: ImportProgress; wide?: boolean }) {
  const percent = Math.max(0, Math.min(100, progress.percent || 0));
  const counts = progress.total > 0 ? `${progress.processed}/${progress.total}` : "";
  return (
    <div className={`access-import-progress ${wide ? "is-wide" : ""}`}>
      <div className="access-import-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="access-import-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="access-import-progress-label">
        {percent}%{counts ? ` ${counts}` : ""}
      </span>
    </div>
  );
}
