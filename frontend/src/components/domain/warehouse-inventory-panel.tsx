"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Package,
  PackageCheck,
  PackageOpen,
  PackageX,
  RefreshCw,
  Search,
  Send,
  Wrench,
} from "lucide-react";
import { ExportButtons } from "@/components/domain/export-buttons";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
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

function bucketLabel(t: (path: string, vars?: Record<string, string | number>) => string, bucket: WarehouseItem["bucket"]) {
  if (bucket === "on_rack") return t("storage.onRack");
  if (bucket === "out_repair") return t("storage.outRepair");
  if (bucket === "pending") return t("storage.pending");
  if (bucket === "not_ok") return t("storage.notOk");
  return t("storage.ready");
}

function KpiCard({
  label,
  value,
  tone,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone: "cyan" | "amber" | "violet" | "emerald" | "rose" | "navy" | "slate";
  active?: boolean;
  onClick?: () => void;
  icon: typeof Package;
}) {
  return (
    <button type="button" className={`wh-kpi is-${tone}${active ? " is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      <span className="wh-kpi-icon">
        <Icon size={16} />
      </span>
      <span className="wh-kpi-body">
        <b>{value}</b>
        <small>{label}</small>
      </span>
    </button>
  );
}

function filtersLabel(t: (path: string) => string, bucket: Bucket) {
  if (bucket === "warehouse") return t("storage.warehouse");
  if (bucket === "out_repair") return t("storage.outRepair");
  if (bucket === "pending") return t("storage.pending");
  if (bucket === "ok") return t("storage.ready");
  if (bucket === "not_ok") return t("storage.notOk");
  if (bucket === "on_rack") return t("storage.onRack");
  return t("storage.all");
}

export function WarehouseInventoryPanel() {
  const { t } = useI18n();
  const { canView, canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("anode");
  const [bucket, setBucket] = useState<Bucket>("warehouse");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WarehouseItem | null>(null);
  const [actionDate, setActionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const allowed = canView("storage") || canView("anodes") || canView("cathodes") || canView("membranes");
  const editable = canEdit("storage") || canEdit("anodes") || canEdit("cathodes");
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

  const counts = boardQuery.data?.counts;
  const inWarehouse = counts ? counts.total - counts.on_rack : 0;
  const columns: Column<WarehouseItem>[] = useMemo(
    () => [
      { key: "serial", header: kind === "cathode" ? t("fields.cathodeNr") : t("fields.anodeNr") },
      {
        key: "bucket",
        header: t("storage.status"),
        render: (row) => <Badge color={BUCKET_COLOR[row.bucket]}>{bucketLabel(t, row.bucket)}</Badge>,
        filterText: (row) => bucketLabel(t, row.bucket),
      },
      {
        key: "cell",
        header: t("storage.cell"),
        render: (row) => (row.electrolyzer ? `${row.electrolyzer}${row.position ? `-${String(row.position).padStart(3, "0")}` : ""}` : "—"),
        filterText: (row) => (row.electrolyzer ? `${row.electrolyzer}${row.position || ""}` : ""),
      },
      { key: "element_nr", header: t("fields.elementNr"), render: (row) => row.element_nr || "—" },
      { key: "manufacturer", header: t("fields.manufacturer"), render: (row) => row.manufacturer || "—" },
      { key: "coating", header: t("fields.coating"), render: (row) => row.coating || "—" },
      { key: "assembly_date", header: t("fields.assemblyDate"), render: (row) => formatDate(row.assembly_date) },
      { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (row) => formatDate(row.disassembly_date) },
      { key: "last_dol", header: t("storage.lastDol"), render: (row) => row.last_dol ?? "—" },
      { key: "total_dol", header: t("storage.totalDol"), render: (row) => row.total_dol ?? "—" },
      { key: "runs", header: t("storage.runs"), render: (row) => row.runs },
      {
        key: "repair",
        header: t("storage.repair"),
        render: (row) =>
          row.repair || row.repair_dispatch
            ? `${row.repair || ""}${row.repair_dispatch ? ` ${formatDate(row.repair_dispatch)}` : ""}${row.repair_return ? ` → ${formatDate(row.repair_return)}` : ""}`
            : "—",
        filterText: (row) => `${row.repair || ""} ${row.repair_dispatch || ""} ${row.repair_return || ""}`,
      },
      { key: "remarks", header: t("fields.remarks"), render: (row) => row.remarks || "—", className: "max-w-[14rem] whitespace-normal" },
    ],
    [kind, t]
  );
  const membraneCols: Column<Membrane>[] = [
    { key: "membrane_nr", header: t("fields.membraneNr") },
    { key: "membrane_type", header: t("fields.membraneType"), render: (row) => row.membrane_type || "—" },
    { key: "batch", header: t("fields.batch"), render: (row) => row.batch || "—" },
    { key: "received_date", header: t("fields.received"), render: (row) => formatDate(row.received_date) },
    { key: "remarks", header: t("fields.remarks"), render: (row) => row.remarks || "—" },
  ];

  if (!allowed) return <ErrorState message={t("common.accessDenied")} />;

  return (
    <div className="wh wh-inventory">
      <p className="wh-subdesc">{t("storage.description")}</p>
      <div className="wh-related-grid wh-related-inline">
        {(
          [
            ["/anodes?tab=maintenance", t("menus.anodeMaintenance")],
            ["/cathodes?tab=maintenance", t("menus.cathodeMaintenance")],
            ["/anodes?tab=recoating", t("menus.anodeRecoating")],
            ["/cathodes?tab=recoating", t("menus.cathodeRecoating")],
          ] as const
        ).map(([href, label]) => (
          <Link key={href} href={href} className="wh-chip">
            <ExternalLink size={12} />
            <span>{label}</span>
          </Link>
        ))}
        {electrode ? (
          <ExportButtons
            prefix="/storage/board"
            params={{ kind, bucket, q: q || undefined }}
            filenameBase={`warehouse-${kind}`}
          />
        ) : null}
      </div>

      <div className="wh-tabs" role="tablist">
        {(
          [
            ["anode", t("storage.tabAnodes")],
            ["cathode", t("storage.tabCathodes")],
            ["membrane", t("storage.tabMembranes")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            className={`wh-tab${kind === id ? " is-active" : ""}`}
            onClick={() => {
              setKind(id);
              setSelected(null);
              setNote("");
              if (id === "membrane") setBucket("warehouse");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {electrode ? (
        <>
          <div className="wh-kpis">
            <KpiCard label={t("storage.warehouse")} value={counts?.total != null ? inWarehouse : "—"} tone="navy" icon={Package} active={bucket === "warehouse"} onClick={() => setBucket("warehouse")} />
            <KpiCard label={t("storage.outRepair")} value={counts?.out_repair ?? "—"} tone="amber" icon={Send} active={bucket === "out_repair"} onClick={() => setBucket("out_repair")} />
            <KpiCard label={t("storage.pending")} value={counts?.pending ?? "—"} tone="violet" icon={RefreshCw} active={bucket === "pending"} onClick={() => setBucket("pending")} />
            <KpiCard label={t("storage.ready")} value={counts?.ok ?? "—"} tone="emerald" icon={PackageCheck} active={bucket === "ok"} onClick={() => setBucket("ok")} />
            <KpiCard label={t("storage.notOk")} value={counts?.not_ok ?? "—"} tone="rose" icon={PackageX} active={bucket === "not_ok"} onClick={() => setBucket("not_ok")} />
            <KpiCard label={t("storage.onRack")} value={counts?.on_rack ?? "—"} tone="cyan" icon={PackageOpen} active={bucket === "on_rack"} onClick={() => setBucket("on_rack")} />
            <KpiCard label={t("storage.all")} value={counts?.total ?? "—"} tone="slate" icon={Wrench} active={bucket === "all"} onClick={() => setBucket("all")} />
          </div>
          <div className="wh-toolbar">
            <label className="wh-search">
              <Search size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("storage.searchPlaceholder")} />
            </label>
            <label className="wh-date">
              <span>{t("storage.actionDate")}</span>
              <DateInput type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} />
            </label>
          </div>
          <div className="wh-workbench">
            <aside className={`wh-panel${selected ? " has-selection" : ""}`}>
              <div className="wh-panel-head">
                <h3>{t("storage.actions")}</h3>
                {selected ? <Badge color={BUCKET_COLOR[selected.bucket]}>{bucketLabel(t, selected.bucket)}</Badge> : null}
              </div>
              {selected ? (
                <div className="wh-selected">
                  <strong>{selected.serial}</strong>
                  <div className="wh-facts">
                    <div>
                      <span>{t("storage.cell")}</span>
                      <b>{selected.electrolyzer ? `${selected.electrolyzer}${selected.position ? `-${String(selected.position).padStart(3, "0")}` : ""}` : "—"}</b>
                    </div>
                    <div>
                      <span>{t("fields.elementNr")}</span>
                      <b>{selected.element_nr || "—"}</b>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="wh-empty-select">{t("storage.selectRow")}</p>
              )}
              {editable ? (
                <div className="wh-actions">
                  <button type="button" disabled={!selected || move.isPending} onClick={() => move.mutate("dispatch_maintenance")}>
                    <Send size={14} /> {t("storage.sendMaintenance")}
                  </button>
                  <button type="button" disabled={!selected || move.isPending} onClick={() => move.mutate("dispatch_recoating")}>
                    <RefreshCw size={14} /> {t("storage.sendRecoating")}
                  </button>
                  <button type="button" disabled={!selected || move.isPending} onClick={() => move.mutate("return")}>
                    <PackageOpen size={14} /> {t("storage.markReturned")}
                  </button>
                  <button type="button" className="is-ok" disabled={!selected || move.isPending} onClick={() => move.mutate("ok")}>
                    <CheckCircle2 size={14} /> {t("storage.markOk")}
                  </button>
                  <button type="button" className="is-bad" disabled={!selected || move.isPending} onClick={() => move.mutate("not_ok")}>
                    <PackageX size={14} /> {t("storage.markNotOk")}
                  </button>
                </div>
              ) : (
                <p className="wh-empty-select">{t("common.viewOnly")}</p>
              )}
              {note ? <p className="wh-note">{note}</p> : null}
            </aside>
            <div className="wh-table">
              {boardQuery.isLoading ? <LoadingState /> : null}
              {boardQuery.isError ? <ErrorState message={(boardQuery.error as Error).message} /> : null}
              {!boardQuery.isLoading && !boardQuery.isError ? (
                <>
                  <div className="wh-table-meta">
                    <strong>
                      {kind === "anode" ? t("storage.tabAnodes") : t("storage.tabCathodes")} · {filtersLabel(t, bucket)}
                    </strong>
                  </div>
                  <DataTable
                    columns={columns}
                    data={boardQuery.data?.items}
                    keyField="key"
                    selectedKey={selected?.key}
                    onRowClick={(row) => {
                      setSelected(row);
                      setNote("");
                    }}
                    emptyTitle={t("storage.emptyWarehouse")}
                    maxHeight="min(52vh, 640px)"
                  />
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : membranesQuery.isError ? (
        <ErrorState message={(membranesQuery.error as Error).message} />
      ) : (
        <div className="wh-membrane">
          <label className="wh-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("storage.searchPlaceholder")} />
          </label>
          <DataTable columns={membraneCols} data={membranesQuery.data} keyField="membrane_nr" isLoading={membranesQuery.isLoading} emptyTitle={t("storage.emptyMembranes")} maxHeight="min(58vh, 680px)" />
        </div>
      )}
    </div>
  );
}
