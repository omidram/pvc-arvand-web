"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AccessHub } from "@/components/layout/access-hub";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { workflowApi, type AssemblyPoolRow } from "@/lib/workflow";

function detailHref(row: AssemblyPoolRow) {
  const serial = encodeURIComponent(row.serial);
  return row.kind === "anode" ? `/anodes?anode_nr=${serial}` : `/cathodes?cathode_nr=${serial}`;
}

function assembleHref(row: AssemblyPoolRow) {
  const key = row.kind === "anode" ? "pick_anode" : "pick_cathode";
  return `/elements/assembly?${key}=${encodeURIComponent(row.serial)}`;
}

export default function AssemblyStockPage() {
  const { t } = useI18n();
  const query = useQuery({ queryKey: ["workflow", "assembly-pool"], queryFn: () => workflowApi.assemblyPool() });
  const columns: Column<AssemblyPoolRow>[] = [
    {
      key: "serial",
      header: t("assemblyStock.serial"),
      render: (row) => <Link href={detailHref(row)}>{row.serial}</Link>,
    },
    {
      key: "kind",
      header: t("assemblyStock.kind"),
      render: (row) => t(row.kind === "anode" ? "wf.kind.anode" : "wf.kind.cathode"),
    },
    { key: "company", header: t("assemblyStock.company"), render: (row) => row.company || "—" },
    { key: "quality", header: t("assemblyStock.quality"), render: (row) => row.quality || "—" },
    { key: "ref", header: t("assemblyStock.ref"), render: (row) => row.ref || row.detail || "—" },
    { key: "date", header: t("assemblyStock.date"), render: (row) => formatDate(row.date) || "—" },
    {
      key: "pair_serial",
      header: t("assemblyStock.pair"),
      render: (row) => row.pair_serial || "—",
    },
    {
      key: "source",
      header: "",
      render: (row) => (
        <Link href={assembleHref(row)} onClick={(event) => event.stopPropagation()}>
          {t("assemblyStock.use")}
        </Link>
      ),
    },
  ];
  const tables: { key: "reusable" | "purchased" | "recoated"; rows: AssemblyPoolRow[] }[] = [
    { key: "reusable", rows: query.data?.reusable || [] },
    { key: "purchased", rows: query.data?.purchased || [] },
    { key: "recoated", rows: query.data?.recoated || [] },
  ];

  return (
    <AccessHub title={t("assemblyStock.title")} backHref="/elements" backLabel={t("elements.title")}>
      <p className="mb-3 text-sm text-[var(--win-muted)]">{t("assemblyStock.hint")}</p>
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState message={(query.error as Error).message} /> : null}
      {query.data
        ? tables.map((table) => (
            <section key={table.key} className="mb-5">
              <h2 className="mb-1 text-sm font-bold text-[var(--win-navy)]">
                {t(`assemblyStock.${table.key}`)} ({table.rows.length})
              </h2>
              <DataTable
                columns={columns}
                data={table.rows}
                keyField="serial"
                emptyTitle={t("assemblyStock.empty")}
                onRowClick={(row) => {
                  window.location.href = detailHref(row);
                }}
              />
            </section>
          ))
        : null}
    </AccessHub>
  );
}
