import { HelpButton } from "./help-button";

export function PageHeader({
  title,
  description,
  actions,
  helpKey,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  helpKey?: string;
}) {
  return (
    <div className="mb-4 border-2 border-[var(--win-face)] [border-style:outset] bg-[var(--win-face)] px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-[var(--win-navy)]">{title}</h1>
            {helpKey && <HelpButton helpKey={helpKey} />}
          </div>
          {description && <p className="mt-0.5 text-xs text-[var(--win-muted)]">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
