"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package, Warehouse } from "lucide-react";
import { storageApi } from "@/lib/endpoints";
import type { Anode, Cathode, Membrane } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";

export default function StoragePage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  const [q, setQ] = useState("");
  const allowed =
    canView("storage") || canView("anodes") || canView("cathodes") || canView("membranes");

  const summaryQuery = useQuery({
    queryKey: ["storage", "summary"],
    queryFn: storageApi.summary,
    enabled: allowed,
  });
  const anodesQuery = useQuery({
    queryKey: ["storage", "anodes", q],
    queryFn: () => storageApi.anodes(q || undefined),
    enabled: allowed && (canView("storage") || canView("anodes")),
  });
  const cathodesQuery = useQuery({
    queryKey: ["storage", "cathodes", q],
    queryFn: () => storageApi.cathodes(q || undefined),
    enabled: allowed && (canView("storage") || canView("cathodes")),
  });
  const membranesQuery = useQuery({
    queryKey: ["storage", "membranes", q],
    queryFn: () => storageApi.membranes(q || undefined),
    enabled: allowed && (canView("storage") || canView("membranes")),
  });

  if (!allowed) {
    return (
      <AccessFormWindow caption={t("storage.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  const counts = summaryQuery.data?.counts;
  const anodeCols: Column<Anode>[] = [
    { key: "anode_nr", header: t("fields.anodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer"), render: (r) => r.manufacturer || "—" },
    { key: "generation", header: t("fields.generation"), render: (r) => r.generation || "—" },
    { key: "coating", header: t("fields.coating"), render: (r) => r.coating || "—" },
    { key: "batch", header: t("fields.batch"), render: (r) => r.batch || "—" },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
  ];
  const cathodeCols: Column<Cathode>[] = [
    { key: "cathode_nr", header: t("fields.cathodeNr") },
    { key: "manufacturer", header: t("fields.manufacturer"), render: (r) => r.manufacturer || "—" },
    { key: "generation", header: t("fields.generation"), render: (r) => r.generation || "—" },
    { key: "coating", header: t("fields.coating"), render: (r) => r.coating || "—" },
    { key: "batch", header: t("fields.batch"), render: (r) => r.batch || "—" },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
  ];
  const membraneCols: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.membraneType"), render: (r) => r.membrane_type || "—" },
    { key: "batch", header: t("fields.batch"), render: (r) => r.batch || "—" },
    { key: "received_date", header: t("fields.received"), render: (r) => formatDate(r.received_date) },
    { key: "remarks", header: t("fields.remarks"), render: (r) => r.remarks || "—" },
  ];

  return (
    <AccessFormWindow caption={t("storage.title")} helpKey="storage">
      <p className="mb-3 text-xs text-[var(--win-muted)]">{t("storage.description")}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded border border-[var(--win-border-shadow)] bg-[var(--win-panel)] px-2 py-1 text-xs">
          <Warehouse size={14} />
          <span>{t("storage.inStock")}:</span>
          <Badge color="cyan">{counts?.total ?? "—"}</Badge>
        </div>
        <Badge color="slate">
          {t("nav.anodes")}: {counts?.anodes ?? "—"}
        </Badge>
        <Badge color="slate">
          {t("nav.cathodes")}: {counts?.cathodes ?? "—"}
        </Badge>
        <Badge color="slate">
          {t("nav.membranes")}: {counts?.membranes ?? "—"}
        </Badge>
        <div className="ms-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("storage.searchPlaceholder")}
          />
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : summaryQuery.isError ? (
        <ErrorState message={(summaryQuery.error as Error).message} />
      ) : (
        <Tabs
          tabs={[
            {
              key: "anodes",
              label: `${t("storage.tabAnodes")} (${anodesQuery.data?.length ?? counts?.anodes ?? 0})`,
              content: (
                <StockTab
                  summaryTitle={t("storage.byManufacturer")}
                  summaryRows={(summaryQuery.data?.anodes_by_manufacturer || []).map((r) => ({
                    label: `${r.manufacturer} / ${r.generation}`,
                    count: r.count,
                  }))}
                  columns={anodeCols}
                  data={anodesQuery.data}
                  loading={anodesQuery.isLoading}
                  error={anodesQuery.error as Error | null}
                  empty={t("storage.emptyAnodes")}
                  idField="anode_nr"
                />
              ),
            },
            {
              key: "cathodes",
              label: `${t("storage.tabCathodes")} (${cathodesQuery.data?.length ?? counts?.cathodes ?? 0})`,
              content: (
                <StockTab
                  summaryTitle={t("storage.byManufacturer")}
                  summaryRows={(summaryQuery.data?.cathodes_by_manufacturer || []).map((r) => ({
                    label: `${r.manufacturer} / ${r.generation}`,
                    count: r.count,
                  }))}
                  columns={cathodeCols}
                  data={cathodesQuery.data}
                  loading={cathodesQuery.isLoading}
                  error={cathodesQuery.error as Error | null}
                  empty={t("storage.emptyCathodes")}
                  idField="cathode_nr"
                />
              ),
            },
            {
              key: "membranes",
              label: `${t("storage.tabMembranes")} (${membranesQuery.data?.length ?? counts?.membranes ?? 0})`,
              content: (
                <StockTab
                  summaryTitle={t("storage.byMembraneType")}
                  summaryRows={(summaryQuery.data?.membranes_by_type || []).map((r) => ({
                    label: r.membrane_type,
                    count: r.count,
                  }))}
                  columns={membraneCols}
                  data={membranesQuery.data}
                  loading={membranesQuery.isLoading}
                  error={membranesQuery.error as Error | null}
                  empty={t("storage.emptyMembranes")}
                  idField="membrane_nr"
                />
              ),
            },
          ]}
        />
      )}
    </AccessFormWindow>
  );
}

function StockTab<T extends object>({
  summaryTitle,
  summaryRows,
  columns,
  data,
  loading,
  error,
  empty,
  idField,
}: {
  summaryTitle: string;
  summaryRows: { label: string; count: number }[];
  columns: Column<T>[];
  data: T[] | undefined;
  loading: boolean;
  error: Error | null;
  empty: string;
  idField: keyof T & string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-[var(--win-navy)]">
          <Package size={14} />
          {summaryTitle}
        </div>
        {summaryRows.length === 0 ? (
          <p className="text-xs text-[var(--win-muted)]">{t("storage.noGroups")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summaryRows.map((row) => (
              <span
                key={row.label}
                className="inline-flex items-center gap-1 border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-0.5 text-[11px]"
              >
                <span>{row.label}</span>
                <Badge color="cyan">{row.count}</Badge>
              </span>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <ErrorState message={error.message} />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          keyField={idField}
          isLoading={loading}
          emptyTitle={empty}
        />
      )}
    </div>
  );
}
