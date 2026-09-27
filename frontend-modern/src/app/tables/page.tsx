"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { ArchiveTableSection } from "@/components/domain/archive-table-section";
import { Input, Select, Label } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { dbTablesApi } from "@/lib/endpoints";

export default function DatabaseTablesPage() {
  const { t } = useI18n();
  const [tableQuery, setTableQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [dataFilter, setDataFilter] = useState<"all" | "withData" | "empty">("all");

  const archiveQuery = useQuery({
    queryKey: ["db-tables"],
    queryFn: dbTablesApi.list,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const needle = tableQuery.trim().toLowerCase();
    return (archiveQuery.data?.tables ?? []).filter((table) => {
      if (category !== "all" && table.category !== category) return false;
      if (dataFilter === "withData" && table.row_count === 0) return false;
      if (dataFilter === "empty" && table.row_count > 0) return false;
      if (!needle) return true;
      return (
        table.name.toLowerCase().includes(needle) ||
        table.slug.includes(needle) ||
        table.columns.some((col) => col.toLowerCase().includes(needle))
      );
    });
  }, [archiveQuery.data?.tables, tableQuery, category, dataFilter]);

  const total = archiveQuery.data?.total ?? 0;

  return (
    <div>
      <PageHeader title={t("databaseTables.title")} description={t("databaseTables.description")} helpKey="databaseTables" />

      <div className="mb-3 flex flex-wrap items-end gap-3 border-2 border-[var(--win-face)] rounded-lg bg-[var(--win-face)] p-3">
        <div className="min-w-[220px] flex-1">
          <Label>{t("allTables.searchTables")}</Label>
          <Input
            value={tableQuery}
            placeholder={t("allTables.searchTablesPlaceholder")}
            onChange={(e) => setTableQuery(e.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <Label>{t("allTables.filterCategory")}</Label>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">{t("allTables.allCategories")}</option>
            {(archiveQuery.data?.categories ?? []).map((key) => {
              const label = t(`allTables.cat.${key}`);
              return (
                <option key={key} value={key}>
                  {label.startsWith("allTables.") ? key : label}
                </option>
              );
            })}
          </Select>
        </div>
        <div className="min-w-[140px]">
          <Label>{t("allTables.filterData")}</Label>
          <Select value={dataFilter} onChange={(e) => setDataFilter(e.target.value as typeof dataFilter)}>
            <option value="all">{t("allTables.dataAll")}</option>
            <option value="withData">{t("allTables.dataWithRows")}</option>
            <option value="empty">{t("allTables.dataEmpty")}</option>
          </Select>
        </div>
        <div className="pb-1 text-xs text-[var(--win-muted)]">
          {t("allTables.tableCount", { shown: filtered.length, total })}
        </div>
      </div>

      {archiveQuery.isLoading ? (
        <LoadingState />
      ) : archiveQuery.isError ? (
        <ErrorState message={(archiveQuery.error as Error).message} />
      ) : !archiveQuery.data?.available ? (
        <p className="text-sm text-[var(--win-muted)]">{t("allTables.archiveUnavailable")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--win-muted)]">{t("allTables.noMatchingTables")}</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((table) => (
            <ArchiveTableSection key={table.slug} table={table} />
          ))}
        </div>
      )}
    </div>
  );
}
