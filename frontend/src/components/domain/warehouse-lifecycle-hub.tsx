"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalLink, History, Search } from "lucide-react";
import { WarehouseInventoryPanel } from "@/components/domain/warehouse-inventory-panel";
import {
  CoatingWorkflowPanel,
  PurchaseWorkflowPanel,
  WorkflowCartablePanel,
  WorkflowDetailModal,
  WorkflowHistoryPanel,
  useWorkflowMeta,
} from "@/components/domain/warehouse-workflow";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import {
  warehouseLifecycleApi,
  type WhCompany,
  type WhElementTimeline,
  type WhLifecycleDashboard,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { workflowApi, workflowHref, type WfFlow } from "@/lib/workflow";

export type WhSection =
  | "dashboard"
  | "cartable"
  | "inventory"
  | "elements"
  | "companies"
  | "coating"
  | "purchase"
  | "history"
  | "decommission"
  | "timeline"
  | "search";

const SECTIONS: WhSection[] = ["dashboard", "cartable", "inventory", "elements", "companies", "coating", "purchase", "history", "decommission", "timeline", "search"];

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

function SectionNav({
  section,
  setSection,
  waiting,
  t,
}: {
  section: WhSection;
  setSection: (s: WhSection) => void;
  waiting: number;
  t: (k: string) => string;
}) {
  return (
    <nav className="wh-section-nav" aria-label={t("wh.nav.label")}>
      {SECTIONS.map((id) => (
        <button key={id} type="button" className={`wh-section-btn${section === id ? " is-active" : ""}`} onClick={() => setSection(id)}>
          {t(`wh.nav.${id}`)}
          {id === "cartable" && waiting > 0 ? <span className="wf-nav-count">{waiting}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function parseTarget(raw: string | null): { flow: WfFlow; id: number } | null {
  const m = raw?.match(/^(coating|purchase):(\d+)$/);
  return m ? { flow: m[1] as WfFlow, id: Number(m[2]) } : null;
}

export function WarehouseLifecycleHub() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const editable = canEdit("storage") || canEdit("anodes") || canEdit("cathodes");
  const meta = useWorkflowMeta();
  const urlSection = params.get("section") as WhSection | null;
  const urlTarget = parseTarget(params.get("wf"));
  const [picked, setPicked] = useState<WhSection | null>(null);
  const [opened, setOpened] = useState<{ flow: WfFlow; id: number } | null>(null);
  const [closedUrlTarget, setClosedUrlTarget] = useState<string | null>(null);
  const defaultSection: WhSection = (meta.data?.groups.length ?? 0) > 0 ? "cartable" : "dashboard";
  const section: WhSection =
    picked ?? (urlSection && SECTIONS.includes(urlSection) ? urlSection : urlTarget ? (urlTarget.flow === "coating" ? "coating" : "purchase") : defaultSection);
  const target = opened ?? (urlTarget && params.get("wf") !== closedUrlTarget ? urlTarget : null);
  const dash = useQuery({ queryKey: ["wh", "dashboard"], queryFn: () => warehouseLifecycleApi.dashboard() });
  const companies = useQuery({ queryKey: ["wh", "companies"], queryFn: () => warehouseLifecycleApi.companies() });
  const decommissions = useQuery({ queryKey: ["wh", "decommissions"], queryFn: () => warehouseLifecycleApi.decommissions() });
  const states = useQuery({ queryKey: ["wh", "states"], queryFn: () => warehouseLifecycleApi.elementStates() });
  const summary = useQuery({ queryKey: ["wf", "summary"], queryFn: workflowApi.summary, refetchInterval: 15_000 });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["wh"] });
  const openRecord = (flow: WfFlow, id: number) => (flow === "cell" ? router.push(workflowHref(flow, id)) : setOpened({ flow, id }));
  const closeRecord = () => {
    setOpened(null);
    if (urlTarget) {
      setClosedUrlTarget(params.get("wf"));
      router.replace(pathname);
    }
  };
  const companyList = companies.data ?? [];

  return (
    <div className="wh">
      <header className="wh-hero">
        <div>
          <div className="wh-kicker">{t("wh.kicker")}</div>
          <h2>{t("wh.title")}</h2>
          <p>{t("wh.subtitle")}</p>
        </div>
      </header>
      <SectionNav section={section} setSection={setPicked} waiting={summary.data?.cartable ?? 0} t={t} />
      {section === "dashboard" ? <DashboardPanel dash={dash} t={t} /> : null}
      {section === "cartable" ? <WorkflowCartablePanel onOpen={openRecord} /> : null}
      {section === "inventory" ? <WarehouseInventoryPanel /> : null}
      {section === "elements" ? <ElementsPanel states={states} t={t} setSection={setPicked} /> : null}
      {section === "companies" ? <CompaniesPanel companies={companies} editable={editable} t={t} onSaved={invalidate} /> : null}
      {section === "coating" ? <CoatingWorkflowPanel onOpen={openRecord} /> : null}
      {section === "purchase" ? <PurchaseWorkflowPanel companies={companyList} onOpen={openRecord} /> : null}
      {section === "history" ? <WorkflowHistoryPanel companies={companyList} onOpen={openRecord} /> : null}
      {section === "decommission" ? (
        <DecommissionPanel rows={decommissions} editable={editable} t={t} onSaved={invalidate} />
      ) : null}
      {section === "timeline" ? <TimelinePanel t={t} /> : null}
      {section === "search" ? <SearchPanel t={t} companies={companyList} /> : null}
      <WorkflowDetailModal target={target} companies={companyList} onClose={closeRecord} />
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
    queryKey: ["wf", "company-stats", historyId],
    queryFn: async () => (await workflowApi.companyReport()).find((r) => r.company_id === historyId) ?? null,
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
              {(
                [
                  ["wf.rep.coatingPieces", `${history.data.coating_pieces} (${history.data.coating_requests})`],
                  ["wf.rep.atCompany", history.data.at_company],
                  ["wf.reworks", history.data.reworks],
                  ["wf.rep.purchased", `${history.data.purchased_anodes} / ${history.data.purchased_cathodes}`],
                  ["wf.rep.onTime", `${history.data.on_time} / ${history.data.deliveries}`],
                  ["wf.rep.late", history.data.late],
                  ["wf.rep.lateCompany", history.data.late_company],
                  ["wf.rep.avgDelay", history.data.avg_delay ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <span>{t(label)}</span>
                  <b>{value}</b>
                </div>
              ))}
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
