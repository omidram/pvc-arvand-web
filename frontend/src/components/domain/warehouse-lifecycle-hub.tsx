"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink, History, Search, Send } from "lucide-react";
import { WarehouseInventoryPanel } from "@/components/domain/warehouse-inventory-panel";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import {
  warehouseLifecycleApi,
  type WhCompany,
  type WhDispatch,
  type WhElementTimeline,
  type WhLifecycleDashboard,
  type WhPurchase,
  type WhReceiving,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";

export type WhSection =
  | "dashboard"
  | "inventory"
  | "elements"
  | "companies"
  | "dispatch"
  | "receiving"
  | "purchase"
  | "decommission"
  | "punch"
  | "timeline"
  | "search";

const DECOMM_REASONS = ["failure", "end_of_life", "mechanical", "no_recoat", "out_of_spec", "other"] as const;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusLabel(t: (k: string) => string, code: string | null | undefined) {
  if (!code) return "—";
  const key = `wh.status.${code}`;
  const v = t(key);
  return v === key ? code : v;
}

function SectionNav({ section, setSection, t }: { section: WhSection; setSection: (s: WhSection) => void; t: (k: string) => string }) {
  const items: { id: WhSection; label: string }[] = [
    { id: "dashboard", label: t("wh.nav.dashboard") },
    { id: "inventory", label: t("wh.nav.inventory") },
    { id: "elements", label: t("wh.nav.elements") },
    { id: "companies", label: t("wh.nav.companies") },
    { id: "dispatch", label: t("wh.nav.dispatch") },
    { id: "receiving", label: t("wh.nav.receiving") },
    { id: "purchase", label: t("wh.nav.purchase") },
    { id: "decommission", label: t("wh.nav.decommission") },
    { id: "punch", label: t("wh.nav.punch") },
    { id: "timeline", label: t("wh.nav.timeline") },
    { id: "search", label: t("wh.nav.search") },
  ];
  return (
    <nav className="wh-section-nav" aria-label={t("wh.nav.label")}>
      {items.map((item) => (
        <button key={item.id} type="button" className={`wh-section-btn${section === item.id ? " is-active" : ""}`} onClick={() => setSection(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function WarehouseLifecycleHub() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const editable = canEdit("storage") || canEdit("anodes") || canEdit("cathodes");
  const [section, setSection] = useState<WhSection>("dashboard");
  const dash = useQuery({ queryKey: ["wh", "dashboard"], queryFn: () => warehouseLifecycleApi.dashboard() });
  const companies = useQuery({ queryKey: ["wh", "companies"], queryFn: () => warehouseLifecycleApi.companies() });
  const dispatches = useQuery({ queryKey: ["wh", "dispatches"], queryFn: () => warehouseLifecycleApi.dispatches() });
  const receivings = useQuery({ queryKey: ["wh", "receivings"], queryFn: () => warehouseLifecycleApi.receivings() });
  const purchases = useQuery({ queryKey: ["wh", "purchases"], queryFn: () => warehouseLifecycleApi.purchases() });
  const punches = useQuery({ queryKey: ["wh", "punches"], queryFn: () => warehouseLifecycleApi.punches() });
  const decommissions = useQuery({ queryKey: ["wh", "decommissions"], queryFn: () => warehouseLifecycleApi.decommissions() });
  const states = useQuery({ queryKey: ["wh", "states"], queryFn: () => warehouseLifecycleApi.elementStates() });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wh"] });

  return (
    <div className="wh">
      <header className="wh-hero">
        <div>
          <div className="wh-kicker">{t("wh.kicker")}</div>
          <h2>{t("wh.title")}</h2>
          <p>{t("wh.subtitle")}</p>
        </div>
      </header>
      <SectionNav section={section} setSection={setSection} t={t} />
      {section === "dashboard" ? <DashboardPanel dash={dash} t={t} /> : null}
      {section === "inventory" ? <WarehouseInventoryPanel /> : null}
      {section === "elements" ? <ElementsPanel states={states} t={t} setSection={setSection} /> : null}
      {section === "companies" ? <CompaniesPanel companies={companies} editable={editable} t={t} onSaved={invalidate} /> : null}
      {section === "dispatch" ? (
        <DispatchPanel dispatches={dispatches} companies={companies.data ?? []} editable={editable} t={t} onSaved={invalidate} />
      ) : null}
      {section === "receiving" ? (
        <ReceivingPanel receivings={receivings} dispatches={dispatches.data ?? []} editable={editable} t={t} onSaved={invalidate} />
      ) : null}
      {section === "purchase" ? (
        <PurchasePanel purchases={purchases} companies={companies.data ?? []} editable={editable} t={t} onSaved={invalidate} />
      ) : null}
      {section === "decommission" ? (
        <DecommissionPanel rows={decommissions} editable={editable} t={t} onSaved={invalidate} />
      ) : null}
      {section === "punch" ? <PunchPanel rows={punches} companies={companies.data ?? []} dispatches={dispatches.data ?? []} editable={editable} t={t} onSaved={invalidate} /> : null}
      {section === "timeline" ? <TimelinePanel t={t} /> : null}
      {section === "search" ? <SearchPanel t={t} companies={companies.data ?? []} /> : null}
    </div>
  );
}

function DashboardPanel({
  dash,
  t,
}: {
  dash: UseQueryResult<WhLifecycleDashboard>;
  t: (k: string) => string;
}) {
  if (dash.isLoading) return <LoadingState />;
  if (dash.isError) return <ErrorState message={(dash.error as Error).message} />;
  const c = dash.data?.counts ?? {};
  const recent = dash.data?.recent ?? [];
  const kpis = [
    ["in_plant", "emerald"],
    ["at_coater", "cyan"],
    ["ready_dispatch", "amber"],
    ["pending_receive", "violet"],
    ["decommissioned", "rose"],
  ] as const;
  return (
    <div className="wh-panel-block">
      <h3>{t("wh.dashboard.current")}</h3>
      <div className="wh-kpis wh-kpis-life">
        {kpis.map(([key, tone]) => (
          <div key={key} className={`wh-life-kpi is-${tone}`}>
            <b>{c[key] ?? 0}</b>
            <small>{statusLabel(t, key)}</small>
          </div>
        ))}
      </div>
      <h3>{t("wh.dashboard.recent")}</h3>
      <ul className="wh-timeline wh-timeline-compact">
        {recent.map((ev) => (
          <li key={ev.id}>
            <span className="wh-tl-date">{formatDate(ev.event_date)}</span>
            <span className="wh-tl-title">
              {ev.serial} · {ev.title}
            </span>
          </li>
        ))}
        {!recent.length ? <li className="wh-muted">{t("wh.empty")}</li> : null}
      </ul>
    </div>
  );
}

function ElementsPanel({
  states,
  t,
  setSection,
}: {
  states: ReturnType<typeof useQuery>;
  t: (k: string) => string;
  setSection: (s: WhSection) => void;
}) {
  type Row = { element_kind: string; serial: string; lifecycle_status: string; company_name: string | null };
  const cols: Column<Row>[] = [
    { key: "serial", header: t("wh.col.serial") },
    { key: "element_kind", header: t("wh.col.kind") },
    { key: "lifecycle_status", header: t("storage.status"), render: (r) => statusLabel(t, r.lifecycle_status) },
    { key: "company_name", header: t("wh.col.company"), render: (r) => r.company_name || "—" },
  ];
  return (
    <div className="wh-panel-block">
      <p className="wh-subdesc">{t("wh.elements.hint")}</p>
      <div className="wh-related-grid wh-related-inline">
        <Link href="/anodes" className="wh-chip">
          <ExternalLink size={12} /> {t("storage.tabAnodes")}
        </Link>
        <Link href="/cathodes" className="wh-chip">
          <ExternalLink size={12} /> {t("storage.tabCathodes")}
        </Link>
        <button type="button" className="wh-chip wh-chip-btn" onClick={() => setSection("timeline")}>
          <History size={12} /> {t("wh.nav.timeline")}
        </button>
      </div>
      <DataTable
        columns={cols}
        data={((states.data as Row[]) ?? []).map((r) => ({ ...r, _key: `${r.element_kind}:${r.serial}` }))}
        keyField="_key"
        isLoading={states.isLoading}
        emptyTitle={t("wh.empty")}
        maxHeight="min(50vh, 560px)"
      />
    </div>
  );
}

function CompaniesPanel({
  companies,
  editable,
  t,
  onSaved,
}: {
  companies: ReturnType<typeof useQuery<WhCompany[]>>;
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<WhCompany> & { name: string }>({ name: "", is_coating: true, is_supplier: false });
  const [editId, setEditId] = useState<number | null>(null);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const history = useQuery({
    queryKey: ["wh", "company-history", historyId],
    queryFn: () => warehouseLifecycleApi.companyHistory(historyId!),
    enabled: historyId != null,
  });
  const save = useMutation({
    mutationFn: () => warehouseLifecycleApi.saveCompany(form, editId ?? undefined),
    onSuccess: () => {
      setForm({ name: "", is_coating: true, is_supplier: false });
      setEditId(null);
      onSaved();
      companies.refetch();
    },
  });
  const cols: Column<WhCompany>[] = [
    { key: "name", header: t("wh.col.company") },
    {
      key: "roles",
      header: t("wh.col.roles"),
      render: (r) =>
        [r.is_coating ? t("wh.role.coating") : null, r.is_supplier ? t("wh.role.supplier") : null].filter(Boolean).join(" + ") || "—",
    },
    { key: "phone", header: t("wh.col.phone"), render: (r) => r.phone || "—" },
  ];
  return (
    <div className="wh-panel-block wh-split">
      <div>
        <DataTable
          columns={cols}
          data={companies.data}
          keyField="id"
          isLoading={companies.isLoading}
          onRowClick={(row) => {
            setEditId(row.id);
            setForm({ ...row });
            setHistoryId(row.id);
          }}
          emptyTitle={t("wh.empty")}
          maxHeight="min(46vh, 520px)"
        />
        {historyId && history.data ? (
          <div className="wh-history-box">
            <h4>{t("wh.companyHistory")}</h4>
            <div className="wh-facts wh-facts-grid">
              <div>
                <span>{t("wh.stats.sent")}</span>
                <b>{history.data.stats.pieces_sent}</b>
              </div>
              <div>
                <span>{t("wh.stats.returned")}</span>
                <b>{history.data.stats.pieces_returned}</b>
              </div>
              <div>
                <span>{t("wh.stats.atCompany")}</span>
                <b>{history.data.stats.at_company}</b>
              </div>
              <div>
                <span>{t("wh.stats.punches")}</span>
                <b>{history.data.stats.punches}</b>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {editable ? (
        <form
          className="wh-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h3>{editId ? t("wh.editCompany") : t("wh.newCompany")}</h3>
          <label>
            {t("wh.col.company")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="wh-check">
            <input type="checkbox" checked={!!form.is_coating} onChange={(e) => setForm({ ...form, is_coating: e.target.checked })} />
            {t("wh.role.coating")}
          </label>
          <label className="wh-check">
            <input type="checkbox" checked={!!form.is_supplier} onChange={(e) => setForm({ ...form, is_supplier: e.target.checked })} />
            {t("wh.role.supplier")}
          </label>
          <label>
            {t("wh.col.contact")}
            <input value={form.contact_person ?? ""} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          </label>
          <label>
            {t("wh.col.phone")}
            <input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label>
            {t("fields.remarks")}
            <textarea value={form.remarks ?? ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} />
          </label>
          <button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function DispatchPanel({
  dispatches,
  companies,
  editable,
  t,
  onSaved,
}: {
  dispatches: ReturnType<typeof useQuery<WhDispatch[]>>;
  companies: WhCompany[];
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const coatingCos = companies.filter((c) => c.is_coating);
  const [companyId, setCompanyId] = useState<number | "">("");
  const [dispatchDate, setDispatchDate] = useState(() => todayIso());
  const [sendNo, setSendNo] = useState("");
  const [lines, setLines] = useState("anode:A-001\ncathode:K-001");
  const create = useMutation({
    mutationFn: () => {
      const items = lines
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [kind, serial] = line.split(/[:,\s]+/);
          return { element_kind: kind as "anode" | "cathode", serial: serial ?? "" };
        })
        .filter((i) => (i.element_kind === "anode" || i.element_kind === "cathode") && i.serial);
      if (!companyId || !items.length) throw new Error(t("wh.validation.required"));
      return warehouseLifecycleApi.createDispatch({
        company_id: Number(companyId),
        dispatch_date: dispatchDate,
        send_no: sendNo || undefined,
        items,
      });
    },
    onSuccess: () => {
      setLines("");
      onSaved();
      dispatches.refetch();
    },
  });
  const cols: Column<WhDispatch>[] = [
    { key: "send_no", header: t("wh.col.sendNo") },
    { key: "company_name", header: t("wh.col.company") },
    { key: "dispatch_date", header: t("wh.col.date"), render: (r) => formatDate(r.dispatch_date) },
    { key: "status", header: t("storage.status"), render: (r) => <Badge color="cyan">{r.status}</Badge> },
    { key: "items", header: t("wh.col.count"), render: (r) => r.items.length },
  ];
  return (
    <div className="wh-panel-block">
      {editable ? (
        <form
          className="wh-form wh-form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {t("wh.col.company")}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : "")} required>
              <option value="">—</option>
              {coatingCos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.date")}
            <DateInput type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
          </label>
          <label>
            {t("wh.col.sendNo")}
            <input value={sendNo} onChange={(e) => setSendNo(e.target.value)} placeholder="CO-…" />
          </label>
          <label className="wh-grow">
            {t("wh.col.lines")}
            <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={3} placeholder="anode:A-001" />
          </label>
          <button type="submit" disabled={create.isPending}>
            <Send size={14} /> {t("wh.newDispatch")}
          </button>
        </form>
      ) : null}
      <DataTable columns={cols} data={dispatches.data} keyField="id" isLoading={dispatches.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}

function ReceivingPanel({
  receivings,
  dispatches,
  editable,
  t,
  onSaved,
}: {
  receivings: ReturnType<typeof useQuery<WhReceiving[]>>;
  dispatches: WhDispatch[];
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const open = dispatches.filter((d) => d.status === "sent" || d.status === "partial");
  const [dispatchId, setDispatchId] = useState<number | "">("");
  const [receiveDate, setReceiveDate] = useState(() => todayIso());
  const [serial, setSerial] = useState("");
  const [kind, setKind] = useState<"anode" | "cathode">("anode");
  const [qc, setQc] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const d = open.find((x) => x.id === dispatchId);
      const item = d?.items.find((i) => i.element_kind === kind && i.serial.toUpperCase() === serial.trim().toUpperCase() && !i.received);
      return warehouseLifecycleApi.createReceiving({
        dispatch_id: dispatchId ? Number(dispatchId) : undefined,
        receive_date: receiveDate,
        items: [
          {
            dispatch_item_id: item?.id,
            element_kind: kind,
            serial: serial.trim(),
            qc_result: qc || undefined,
          },
        ],
      });
    },
    onSuccess: () => {
      setSerial("");
      onSaved();
      receivings.refetch();
    },
  });
  const cols: Column<WhReceiving>[] = [
    { key: "receive_no", header: t("wh.col.receiveNo") },
    { key: "send_no", header: t("wh.col.sendNo"), render: (r) => r.send_no || "—" },
    { key: "receive_date", header: t("wh.col.date"), render: (r) => formatDate(r.receive_date) },
    { key: "items", header: t("wh.col.count"), render: (r) => r.items.length },
  ];
  return (
    <div className="wh-panel-block">
      <p className="wh-subdesc">{t("wh.receiving.hint")}</p>
      {editable ? (
        <form
          className="wh-form wh-form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {t("wh.col.sendNo")}
            <select value={dispatchId} onChange={(e) => setDispatchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {open.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.send_no} ({d.status})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as "anode" | "cathode")}>
              <option value="anode">{t("storage.tabAnodes")}</option>
              <option value="cathode">{t("storage.tabCathodes")}</option>
            </select>
          </label>
          <label>
            {t("wh.col.serial")}
            <input value={serial} onChange={(e) => setSerial(e.target.value)} required />
          </label>
          <label>
            {t("wh.col.qc")}
            <input value={qc} onChange={(e) => setQc(e.target.value)} />
          </label>
          <label>
            {t("wh.col.date")}
            <DateInput type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {t("wh.newReceiving")}
          </button>
        </form>
      ) : null}
      <DataTable columns={cols} data={receivings.data} keyField="id" isLoading={receivings.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}

function PurchasePanel({
  purchases,
  companies,
  editable,
  t,
  onSaved,
}: {
  purchases: ReturnType<typeof useQuery<WhPurchase[]>>;
  companies: WhCompany[];
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const suppliers = companies.filter((c) => c.is_supplier);
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [purchaseDate, setPurchaseDate] = useState(() => todayIso());
  const [kind, setKind] = useState<"anode" | "cathode">("anode");
  const [serials, setSerials] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const list = serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!supplierId || !list.length) throw new Error(t("wh.validation.required"));
      return warehouseLifecycleApi.createPurchase({
        supplier_id: Number(supplierId),
        purchase_date: purchaseDate,
        element_kind: kind,
        serials: list,
      });
    },
    onSuccess: () => {
      setSerials("");
      onSaved();
      purchases.refetch();
    },
  });
  const cols: Column<WhPurchase>[] = [
    { key: "purchase_no", header: t("wh.col.purchaseNo") },
    { key: "supplier_name", header: t("wh.col.company") },
    { key: "purchase_date", header: t("wh.col.date"), render: (r) => formatDate(r.purchase_date) },
    { key: "element_kind", header: t("wh.col.kind") },
    { key: "serials", header: t("wh.col.count"), render: (r) => r.serials.length },
  ];
  return (
    <div className="wh-panel-block">
      {editable ? (
        <form
          className="wh-form wh-form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {t("wh.role.supplier")}
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : "")} required>
              <option value="">—</option>
              {suppliers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as "anode" | "cathode")}>
              <option value="anode">{t("storage.tabAnodes")}</option>
              <option value="cathode">{t("storage.tabCathodes")}</option>
            </select>
          </label>
          <label>
            {t("wh.col.date")}
            <DateInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </label>
          <label className="wh-grow">
            {t("wh.col.serials")}
            <textarea value={serials} onChange={(e) => setSerials(e.target.value)} rows={2} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {t("wh.newPurchase")}
          </button>
        </form>
      ) : null}
      <DataTable columns={cols} data={purchases.data} keyField="id" isLoading={purchases.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}

function DecommissionPanel({
  rows,
  editable,
  t,
  onSaved,
}: {
  rows: ReturnType<typeof useQuery>;
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"anode" | "cathode">("anode");
  const [serial, setSerial] = useState("");
  const [date, setDate] = useState(() => todayIso());
  const [reason, setReason] = useState<string>(DECOMM_REASONS[0]);
  const create = useMutation({
    mutationFn: () =>
      warehouseLifecycleApi.createDecommission({
        element_kind: kind,
        serial,
        decommission_date: date,
        reason,
      }),
    onSuccess: () => {
      setSerial("");
      onSaved();
      rows.refetch();
    },
  });
  type Row = { id: number; element_kind: string; serial: string; decommission_date: string; reason: string };
  const cols: Column<Row>[] = [
    { key: "serial", header: t("wh.col.serial") },
    { key: "element_kind", header: t("wh.col.kind") },
    { key: "decommission_date", header: t("wh.col.date"), render: (r) => formatDate(r.decommission_date) },
    { key: "reason", header: t("wh.col.reason"), render: (r) => t(`wh.decomm.${r.reason}`) },
  ];
  return (
    <div className="wh-panel-block">
      {editable ? (
        <form
          className="wh-form wh-form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {t("wh.col.kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value as "anode" | "cathode")}>
              <option value="anode">{t("storage.tabAnodes")}</option>
              <option value="cathode">{t("storage.tabCathodes")}</option>
            </select>
          </label>
          <label>
            {t("wh.col.serial")}
            <input value={serial} onChange={(e) => setSerial(e.target.value)} required />
          </label>
          <label>
            {t("wh.col.reason")}
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {DECOMM_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`wh.decomm.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.date")}
            <DateInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {t("wh.newDecommission")}
          </button>
        </form>
      ) : null}
      <DataTable columns={cols} data={(rows.data as Row[]) ?? []} keyField="id" isLoading={rows.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}

function PunchPanel({
  rows,
  companies,
  dispatches,
  editable,
  t,
  onSaved,
}: {
  rows: ReturnType<typeof useQuery>;
  companies: WhCompany[];
  dispatches: WhDispatch[];
  editable: boolean;
  t: (k: string) => string;
  onSaved: () => void;
}) {
  const [companyId, setCompanyId] = useState<number | "">("");
  const [dispatchId, setDispatchId] = useState<number | "">("");
  const [kind, setKind] = useState<"anode" | "cathode">("anode");
  const [serial, setSerial] = useState("");
  const [punchNo, setPunchNo] = useState("");
  const create = useMutation({
    mutationFn: () =>
      warehouseLifecycleApi.createPunch({
        company_id: companyId ? Number(companyId) : undefined,
        dispatch_id: dispatchId ? Number(dispatchId) : undefined,
        element_kind: kind,
        serial,
        punch_no: punchNo || undefined,
      }),
    onSuccess: () => {
      setPunchNo("");
      onSaved();
      rows.refetch();
    },
  });
  type Row = { id: number; serial: string; element_kind: string; send_no: string | null; punch_no: string | null; punch_date: string | null };
  const cols: Column<Row>[] = useMemo(
    () => [
      { key: "serial", header: t("wh.col.serial") },
      { key: "punch_no", header: t("wh.col.punchNo"), render: (r) => r.punch_no || "—" },
      { key: "send_no", header: t("wh.col.sendNo"), render: (r) => r.send_no || "—" },
      { key: "punch_date", header: t("wh.col.date"), render: (r) => formatDate(r.punch_date) },
    ],
    [t]
  );
  return (
    <div className="wh-panel-block">
      {editable ? (
        <form
          className="wh-form wh-form-inline"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label>
            {t("wh.col.company")}
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.sendNo")}
            <select value={dispatchId} onChange={(e) => setDispatchId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {dispatches.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.send_no}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("wh.col.serial")}
            <input value={serial} onChange={(e) => setSerial(e.target.value)} required />
          </label>
          <label>
            {t("wh.col.punchNo")}
            <input value={punchNo} onChange={(e) => setPunchNo(e.target.value)} />
          </label>
          <button type="submit" disabled={create.isPending}>
            {t("wh.newPunch")}
          </button>
        </form>
      ) : null}
      <DataTable columns={cols} data={(rows.data as Row[]) ?? []} keyField="id" isLoading={rows.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}

function TimelinePanel({ t }: { t: (k: string) => string }) {
  const [kind, setKind] = useState<"anode" | "cathode">("anode");
  const [serial, setSerial] = useState("");
  const [qSerial, setQSerial] = useState("");
  const timeline = useQuery({
    queryKey: ["wh", "timeline", kind, qSerial],
    queryFn: () => warehouseLifecycleApi.elementTimeline(kind, qSerial),
    enabled: qSerial.length > 0,
  });
  const data = timeline.data as WhElementTimeline | undefined;
  return (
    <div className="wh-panel-block">
      <form
        className="wh-form wh-form-inline"
        onSubmit={(e) => {
          e.preventDefault();
          setQSerial(serial.trim());
        }}
      >
        <label>
          {t("wh.col.kind")}
          <select value={kind} onChange={(e) => setKind(e.target.value as "anode" | "cathode")}>
            <option value="anode">{t("storage.tabAnodes")}</option>
            <option value="cathode">{t("storage.tabCathodes")}</option>
          </select>
        </label>
        <label>
          {t("wh.col.serial")}
          <input value={serial} onChange={(e) => setSerial(e.target.value)} required />
        </label>
        <button type="submit">
          <Search size={14} /> {t("wh.loadTimeline")}
        </button>
      </form>
      {timeline.isLoading ? <LoadingState /> : null}
      {data ? (
        <>
          <div className="wh-current-box">
            <strong>{data.serial}</strong> — {statusLabel(t, data.current.lifecycle_status)}
            {data.current.company_name ? ` · ${data.current.company_name}` : ""}
          </div>
          <ul className="wh-timeline">
            {data.events.map((ev) => (
              <li key={ev.id} className={`wh-tl-${ev.event_type}`}>
                <span className="wh-tl-date">{formatDate(ev.event_date)}</span>
                <span className="wh-tl-title">{ev.title}</span>
              </li>
            ))}
            {!data.events.length ? <li className="wh-muted">{t("wh.emptyTimeline")}</li> : null}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SearchPanel({ t, companies }: { t: (k: string) => string; companies: WhCompany[] }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const search = useQuery({
    queryKey: ["wh", "search", filters],
    queryFn: () => warehouseLifecycleApi.search(filters),
    enabled: Object.values(filters).some((v) => v.trim()),
  });
  type Hit = Record<string, unknown>;
  const cols: Column<Hit>[] = [
    { key: "hit", header: t("wh.col.hit") },
    { key: "serial", header: t("wh.col.serial"), render: (r) => String(r.serial ?? "—") },
    { key: "title", header: t("wh.col.title"), render: (r) => String(r.title ?? r.send_no ?? r.receive_no ?? r.purchase_no ?? "—") },
  ];
  return (
    <div className="wh-panel-block">
      <form
        className="wh-form wh-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          search.refetch();
        }}
      >
        <label>
          {t("wh.col.serial")}
          <input value={filters.serial ?? ""} onChange={(e) => setFilters({ ...filters, serial: e.target.value })} />
        </label>
        <label>
          {t("wh.col.sendNo")}
          <input value={filters.send_no ?? ""} onChange={(e) => setFilters({ ...filters, send_no: e.target.value })} />
        </label>
        <label>
          {t("wh.col.receiveNo")}
          <input value={filters.receive_no ?? ""} onChange={(e) => setFilters({ ...filters, receive_no: e.target.value })} />
        </label>
        <label>
          {t("wh.col.purchaseNo")}
          <input value={filters.purchase_no ?? ""} onChange={(e) => setFilters({ ...filters, purchase_no: e.target.value })} />
        </label>
        <label>
          {t("wh.col.company")}
          <select value={filters.company_id ?? ""} onChange={(e) => setFilters({ ...filters, company_id: e.target.value })}>
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">
          <Search size={14} /> {t("common.search")}
        </button>
      </form>
      <DataTable columns={cols} data={(search.data?.results as Hit[]) ?? []} keyField="hit" isLoading={search.isFetching} emptyTitle={t("wh.empty")} maxHeight="min(48vh, 540px)" />
    </div>
  );
}
