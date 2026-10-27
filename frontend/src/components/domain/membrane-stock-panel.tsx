"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n/context";
import { todayIsoLocal } from "@/lib/date-range";
import { formatDate } from "@/lib/utils";
import { membraneStockApi } from "@/lib/workflow";

type Mode = "addSerial" | "addCount" | "remove";

/** Rows of the membranes that assemble requests took from the stock. */
export function MembraneUsedTable({ type }: { type?: string }) {
  const { t } = useI18n();
  const used = useQuery({
    queryKey: ["membrane-stock", "used", type ?? ""],
    queryFn: () => membraneStockApi.used(type),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const rows = used.data?.items ?? [];
  if (used.isLoading) return <p className="asm-mute">…</p>;
  if (!rows.length) return <p className="asm-mute">{t("membraneStock.emptyUsed")}</p>;
  return (
    <div className="ed-table-wrap">
      <table className="ed-table">
        <thead>
          <tr>
            <th>{t("membraneStock.type")}</th>
            <th>{t("membraneStock.serial")}</th>
            <th>{t("membraneStock.element")}</th>
            <th>{t("membraneStock.request")}</th>
            <th>{t("membraneStock.purchaseDate")}</th>
            <th>{t("membraneStock.usedDate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.type}</td>
              <td>
                {row.serial ? <Link href={`/membranes?membrane_nr=${encodeURIComponent(row.serial)}`}>{row.serial}</Link> : "—"}
                {!row.from_stock ? <small className="asm-mute"> ({t("membraneStock.untracked")})</small> : null}
              </td>
              <td>
                {row.element_nr ? <Link href={`/elements/assembly?element_nr=${encodeURIComponent(row.element_nr)}`}>{row.element_nr}</Link> : "—"}
              </td>
              <td>{row.request_code || "—"}</td>
              <td>{formatDate(row.purchase_date) || "—"}</td>
              <td>{formatDate(row.date) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dashboard pop-up: type and serial of every membrane used from the stock. */
export function MembraneUsedModal({ open, onClose, type }: { open: boolean; onClose: () => void; type?: string }) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={`${t("membraneStock.usedTitle")}${type ? ` — ${type}` : ""}`}>
      {open ? <MembraneUsedTable type={type} /> : null}
    </Modal>
  );
}

export function MembraneStockPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["membrane-stock", "overview"], queryFn: membraneStockApi.overview, staleTime: 0, refetchOnMount: "always" });
  const [mode, setMode] = useState<Mode>("addSerial");
  const [type, setType] = useState("");
  const [serial, setSerial] = useState("");
  const [qty, setQty] = useState("1");
  const [day, setDay] = useState(todayIsoLocal());
  const [note, setNote] = useState("");
  const [usedType, setUsedType] = useState<string | undefined>(undefined);
  const [showUsed, setShowUsed] = useState(false);
  const data = overview.data;
  const canEdit = !!data?.can_edit;

  const save = useMutation({
    mutationFn: async () => {
      const common = { type: type.trim(), purchase_date: day || undefined, note: note.trim() || undefined };
      if (mode === "addSerial") return membraneStockApi.add({ ...common, serial: serial.trim() });
      const n = Math.max(1, Math.floor(Number(qty) || 0));
      if (mode === "addCount") return membraneStockApi.add({ ...common, quantity: n });
      return membraneStockApi.adjust({ ...common, delta: -n });
    },
    onSuccess: () => {
      setSerial("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["membrane-stock"] });
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => membraneStockApi.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["membrane-stock"] });
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
    },
  });
  const ready = type.trim() && (mode === "addSerial" ? serial.trim() : Number(qty) >= 1);

  return (
    <section className="mb-5">
      <h2 className="mb-1 text-sm font-bold text-[var(--win-navy)]">
        {t("membraneStock.title")} ({data?.total_in_stock ?? 0})
      </h2>
      <p className="mb-2 text-sm text-[var(--win-muted)]">{t("membraneStock.hint")}</p>

      {canEdit ? (
        <form
          className="wh-form-inline mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) save.mutate();
          }}
        >
          <label>
            {t("membraneStock.addTitle")}
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="addSerial">{t("membraneStock.mode.addSerial")}</option>
              <option value="addCount">{t("membraneStock.mode.addCount")}</option>
              <option value="remove">{t("membraneStock.mode.remove")}</option>
            </select>
          </label>
          <label>
            {t("membraneStock.newType")}
            <input list="mem-stock-types" value={type} onChange={(e) => setType(e.target.value)} required />
            <datalist id="mem-stock-types">
              {(data?.types ?? []).map((row) => (
                <option key={row.type} value={row.type} />
              ))}
            </datalist>
          </label>
          {mode === "addSerial" ? (
            <label>
              {t("membraneStock.serial")}
              <input value={serial} onChange={(e) => setSerial(e.target.value)} required />
            </label>
          ) : (
            <label>
              {t("membraneStock.quantity")}
              <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
            </label>
          )}
          {mode !== "remove" ? (
            <label>
              {t("membraneStock.purchaseDate")}
              <DateInput type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          ) : null}
          <label className="wh-grow">
            {t("membraneStock.note")}
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button type="submit" size="sm" disabled={!ready || save.isPending}>
            <Plus className="h-4 w-4" /> {t("membraneStock.save")}
          </Button>
        </form>
      ) : null}
      {save.error ? <p className="wf-alert">{(save.error as Error).message}</p> : null}
      {remove.error ? <p className="wf-alert">{(remove.error as Error).message}</p> : null}

      <h3 className="mb-1 text-xs font-bold">{t("membraneStock.types")}</h3>
      <div className="ed-table-wrap mb-3">
        <table className="ed-table">
          <thead>
            <tr>
              <th>{t("membraneStock.type")}</th>
              <th className="ed-num">{t("membraneStock.inStock")}</th>
              <th className="ed-num">{t("membraneStock.used")}</th>
              <th>{t("membraneStock.lastPurchase")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.types ?? []).map((row) => (
              <tr key={row.type}>
                <td>
                  <button type="button" className="asm-link" onClick={() => setType(row.type)}>
                    {row.type}
                  </button>
                </td>
                <td className="ed-num">{row.in_stock}</td>
                <td className="ed-num">
                  <button
                    type="button"
                    className="asm-link"
                    onClick={() => {
                      setUsedType(row.type);
                      setShowUsed(true);
                    }}
                  >
                    {row.used}
                  </button>
                </td>
                <td>{formatDate(row.last_purchase) || "—"}</td>
              </tr>
            ))}
            {!data?.types?.length ? (
              <tr>
                <td colSpan={4}>{t("membraneStock.empty")}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h3 className="mb-1 text-xs font-bold">{t("membraneStock.items")}</h3>
      <div className="ed-table-wrap mb-3">
        <table className="ed-table">
          <thead>
            <tr>
              <th>{t("membraneStock.type")}</th>
              <th>{t("membraneStock.serial")}</th>
              <th className="ed-num">{t("membraneStock.count")}</th>
              <th>{t("membraneStock.purchaseDate")}</th>
              <th>{t("membraneStock.note")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.id}>
                <td>{row.type}</td>
                <td>{row.serial || "—"}</td>
                <td className="ed-num">{row.quantity}</td>
                <td>{formatDate(row.purchase_date) || "—"}</td>
                <td>{row.note || "—"}</td>
                <td>
                  {canEdit ? (
                    <button
                      type="button"
                      className="asm-link"
                      title={t("membraneStock.remove")}
                      onClick={() => {
                        if (window.confirm(t("membraneStock.confirmRemove"))) remove.mutate(row.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-1 text-xs font-bold">
        {t("membraneStock.usedTitle")} ({data?.total_used ?? 0})
      </h3>
      <button
        type="button"
        className="asm-link"
        onClick={() => {
          setUsedType(undefined);
          setShowUsed(true);
        }}
      >
        {t("membraneStock.usedAll")}
      </button>
      <MembraneUsedModal open={showUsed} onClose={() => setShowUsed(false)} type={usedType} />
    </section>
  );
}
