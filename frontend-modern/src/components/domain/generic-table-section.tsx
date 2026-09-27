"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ExportButtons } from "./export-buttons";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { snakeToCamel, humanizeKey } from "@/lib/utils";

const PREVIEW_LIMIT = 50;

type Row = Record<string, unknown> & { _rowKey: number };

/** Fetches and displays a compact, read-only, lazily-loaded preview of any
 * list endpoint, deriving table columns automatically from the response
 * shape. Used by the "All Forms & Tables" overview page so every table in
 * the system can be browsed and exported from a single place. */
export function GenericTableSection({
  title,
  endpoint,
  linkHref,
}: {
  title: string;
  endpoint: string;
  linkHref?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["all-tables-preview", endpoint],
    queryFn: async () => {
      const { data } = await apiClient.get<Record<string, unknown>[]>(endpoint, { params: { limit: PREVIEW_LIMIT } });
      return data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  const rows = query.data;

  const columns: Column<Row>[] = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return Object.keys(rows[0]).map((k) => {
      const camel = snakeToCamel(k);
      const translated = t(`fields.${camel}`);
      const header = translated !== `fields.${camel}` ? translated : humanizeKey(k);
      return { key: k, header };
    });
  }, [rows, t]);

  const dataWithKeys: Row[] | undefined = useMemo(() => rows?.map((r, idx) => ({ ...r, _rowKey: idx })), [rows]);

  return (
    <div className="border-2 border-[var(--win-face-dark)] bg-[var(--win-panel)]">
      <div className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--win-face-hi)]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 text-start text-sm font-bold text-[var(--win-navy)]"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {title}
        </button>
        {linkHref && (
          <Link href={linkHref} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--win-navy)] hover:underline">
            {t("allTables.openForm")} <ExternalLink size={12} />
          </Link>
        )}
      </div>
      {open && (
        <div className="border-t-2 border-[var(--win-face-dark)] p-3">
          {query.isLoading ? (
            <LoadingState />
          ) : query.isError ? (
            <ErrorState message={(query.error as Error).message} />
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--win-muted)]">
                  {t("allTables.previewNote", { count: rows?.length ?? 0 })}
                </span>
                <div className="flex items-center gap-2">
                  <ExportButtons prefix={endpoint} filenameBase={endpoint.replace(/^\//, "").replace(/\//g, "-")} />
                </div>
              </div>
              <DataTable<Row>
                columns={columns}
                data={dataWithKeys}
                keyField="_rowKey"
                emptyTitle={t("common.noRecordsFound")}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
