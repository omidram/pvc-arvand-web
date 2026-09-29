"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExportButtons } from "@/components/domain/export-buttons";
import { AccessBtn } from "@/components/layout/access-hub";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useCalendar } from "@/lib/calendar/context";
import { storageApi, type WarehouseItem } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import type { Membrane } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Kind = "anode" | "cathode" | "membrane";
type Bucket = "warehouse" | "out_repair" | "pending" | "ok" | "not_ok" | "on_rack" | "all";

const BUCKET_COLOR: Record<WarehouseItem["bucket"], "cyan" | "amber" | "violet" | "emerald" | "rose"> = {
  on_rack: "cyan",
  out_repair: "amber",
  pending: "violet",
  ok: "emerald",
  not_ok: "rose",
};

export default function StoragePage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  useCalendar();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("anode");
  const [bucket, setBucket] = useState<Bucket>("warehouse");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WarehouseItem | null>(null);
  const [actionDate, setActionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const allowed = canView("storage") || canView("anodes") || canView("cathodes") || canView("membranes");
  const electrode = kind === "anode" || kind === "cathode";

  const boardQuery = useQuery({
    queryKey: ["storage", "board", kind, bucket, q],
    queryFn: () => storageApi.board(kind as "anode" | "cathode", bucket, q || undefined),
    enabled: allowed && electrode,
  });
  const membranesQuery = useQuery({
    queryKey: ["storage", "membranes", q],
    queryFn: () => storageApi.membranes(q || undefined),
    enabled: allowed && kind === "membrane",
  });
  const move = useMutation({
    mutationFn: (action: "dispatch_maintenance" | "dispatch_recoating" | "return" | "ok" | "not_ok") => {
      if (!selected || !electrode) throw new Error(t("storage.selectRow"));
      return storageApi.move({
        kind,
        serial: selected.serial,
        action,
        date: actionDate || undefined,
      });
    },
    onSuccess: async (result) => {
      setNote(result.already ? t("storage.alreadyOut") : t("storage.saved"));
      await queryClient.invalidateQueries({ queryKey: ["storage"] });
    },
    onError: (err: Error) => setNote(err.message),
  });

  if (!allowed) {
    return (
      <AccessFormWindow caption={t("storage.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  const counts = boardQuery.data?.counts;
  const columns: Column<WarehouseItem>[] = [
    { key: "serial", header: kind === "cathode" ? t("fields.cathodeNr") : t("fields.anodeNr") },
    {
      key: "bucket",
      header: t("storage.warehouse"),
      render: (row) => <Badge color={BUCKET_COLOR[row.bucket]}>{bucketLabel(t, row.bucket)}</Badge>,
    },
    {
      key: "cell",
      header: t("storage.cell"),
      render: (row) => (row.electrolyzer ? `${row.electrolyzer}${row.position ? ` / ${row.position}` : ""}` : "—"),
    },
    { key: "element_nr", header: t("fields.elementNr"), render: (row) => row.element_nr || "—" },
    { key: "assembly_date", header: t("fields.assemblyDate"), render: (row) => formatDate(row.assembly_date) },
    { key: "commissioning_date", header: t("fields.commissioningDate"), render: (row) => formatDate(row.commissioning_date) },
    { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (row) => formatDate(row.disassembly_date) },
    { key: "last_dol", header: t("storage.lastDol"), render: (row) => row.last_dol ?? "—" },
    { key: "total_dol", header: t("storage.totalDol"), render: (row) => row.total_dol ?? "—" },
    { key: "runs", header: t("storage.runs"), render: (row) => row.runs },
    { key: "remarks", header: t("fields.remarks"), render: (row) => row.remarks || "—" },
    {
      key: "repair",
      header: t("storage.repair"),
      render: (row) =>
        row.repair || row.repair_dispatch
          ? `${row.repair || ""}${row.repair_dispatch ? ` ${formatDate(row.repair_dispatch)}` : ""}${row.repair_return ? ` → ${formatDate(row.repair_return)}` : ""}`
          : "—",
    },
    { key: "coating", header: t("storage.coating"), render: (row) => row.coating || "—" },
  ];
  const membraneCols: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.membraneType"), render: (row) => row.membrane_type || "—" },
    { key: "batch", header: t("fields.batch"), render: (row) => row.batch || "—" },
    { key: "received_date", header: t("fields.received"), render: (row) => formatDate(row.received_date) },
    { key: "remarks", header: t("fields.remarks"), render: (row) => row.remarks || "—" },
  ];

  const filters: { id: Bucket; label: string; count?: number }[] = [
    { id: "warehouse", label: t("storage.warehouse"), count: counts ? counts.total - counts.on_rack : undefined },
    { id: "out_repair", label: t("storage.outRepair"), count: counts?.out_repair },
    { id: "pending", label: t("storage.pending"), count: counts?.pending },
    { id: "ok", label: t("storage.ready"), count: counts?.ok },
    { id: "not_ok", label: t("storage.notOk"), count: counts?.not_ok },
    { id: "on_rack", label: t("storage.onRack"), count: counts?.on_rack },
    { id: "all", label: t("storage.all"), count: counts?.total },
  ];

  return (
    <AccessFormWindow
      caption={t("storage.title")}
      helpKey="storage"
      commands={
        electrode ? (
          <ExportButtons
            prefix="/storage/board"
            params={{ kind, bucket, q: q || undefined }}
            filenameBase={`warehouse-${kind}`}
          />
        ) : null
      }
    >
      <p className="mb-3 max-w-4xl text-xs text-[var(--win-muted)]">{t("storage.description")}</p>

      <div className="mb-4 grid max-w-[720px] grid-cols-1 gap-3 sm:grid-cols-2">
        <AccessBtn href="/anodes?tab=maintenance">{t("menus.anodeMaintenance")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=maintenance">{t("menus.cathodeMaintenance")}</AccessBtn>
        <AccessBtn href="/anodes?tab=recoating">{t("menus.anodeRecoating")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=recoating">{t("menus.cathodeRecoating")}</AccessBtn>
        <AccessBtn href="/anodes?tab=coating">{t("menus.checkAnodeCoating")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=coating">{t("menus.checkCathodeCoating")}</AccessBtn>
      </div>

      <div className="mb-3 grid max-w-[720px] grid-cols-3 gap-2">
        <AccessBtn onClick={() => { setKind("anode"); setSelected(null); }}>{t("storage.tabAnodes")}</AccessBtn>
        <AccessBtn onClick={() => { setKind("cathode"); setSelected(null); }}>{t("storage.tabCathodes")}</AccessBtn>
        <AccessBtn onClick={() => { setKind("membrane"); setSelected(null); }}>{t("storage.tabMembranes")}</AccessBtn>
      </div>

      <div className="mb-3 max-w-md">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("storage.searchPlaceholder")} />
      </div>

      {electrode ? (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setBucket(item.id)}
                className={`border px-2 py-1 text-[11px] font-bold ${bucket === item.id ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white" : "border-[var(--win-border-shadow)] bg-[var(--win-face)]"}`}
              >
                {item.label}
                {item.count != null ? ` (${item.count})` : ""}
              </button>
            ))}
          </div>

          <div className="mb-3 grid max-w-[720px] grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="col-span-2 text-[11px] font-bold sm:col-span-3">
              {t("storage.actionDate")}
              <DateInput type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
            </label>
            <AccessBtn disabled={!selected || move.isPending} onClick={() => move.mutate("dispatch_maintenance")}>
              {t("storage.sendMaintenance")}
            </AccessBtn>
            <AccessBtn disabled={!selected || move.isPending} onClick={() => move.mutate("dispatch_recoating")}>
              {t("storage.sendRecoating")}
            </AccessBtn>
            <AccessBtn disabled={!selected || move.isPending} onClick={() => move.mutate("return")}>
              {t("storage.markReturned")}
            </AccessBtn>
            <AccessBtn disabled={!selected || move.isPending} onClick={() => move.mutate("ok")}>
              {t("storage.markOk")}
            </AccessBtn>
            <AccessBtn disabled={!selected || move.isPending} onClick={() => move.mutate("not_ok")}>
              {t("storage.markNotOk")}
            </AccessBtn>
          </div>
          {note ? <p className="mb-2 text-xs font-bold text-[var(--win-navy)]">{note}</p> : null}
          {selected ? <p className="mb-2 text-xs">{selected.serial}</p> : <p className="mb-2 text-xs text-[var(--win-muted)]">{t("storage.selectRow")}</p>}
          {boardQuery.isError ? (
            <ErrorState message={(boardQuery.error as Error).message} />
          ) : (
            <>
              {boardQuery.data?.truncated ? (
                <p className="mb-1 text-[11px] text-[var(--win-muted)]">
                  {t("storage.showing", { shown: boardQuery.data.items.length })}
                </p>
              ) : null}
              <DataTable
                columns={columns}
                data={boardQuery.data?.items}
                keyField="key"
                selectedKey={selected?.key}
                onRowClick={(row) => setSelected(row)}
                isLoading={boardQuery.isLoading}
                emptyTitle={t("storage.emptyWarehouse")}
              />
            </>
          )}
        </>
      ) : membranesQuery.isError ? (
        <ErrorState message={(membranesQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={membraneCols}
          data={membranesQuery.data}
          keyField="membrane_nr"
          isLoading={membranesQuery.isLoading}
          emptyTitle={t("storage.emptyMembranes")}
        />
      )}
    </AccessFormWindow>
  );
}

function bucketLabel(t: (path: string, vars?: Record<string, string | number>) => string, bucket: WarehouseItem["bucket"]) {
  if (bucket === "on_rack") return t("storage.onRack");
  if (bucket === "out_repair") return t("storage.outRepair");
  if (bucket === "pending") return t("storage.pending");
  if (bucket === "not_ok") return t("storage.notOk");
  return t("storage.ready");
}
