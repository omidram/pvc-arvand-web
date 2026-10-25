"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Factory,
  Inbox,
  LayoutDashboard,
  Package,
  Power,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  SplitSquareVertical,
  Timer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { matchesCartableQuery, summaryColumns } from "@/components/domain/warehouse-workflow";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import {
  CARTABLE_MS,
  workflowApi,
  type CartableDesk,
  type CartableElementBrief,
  type CartablePoolSnap,
  type WfFlow,
  type WfGroup,
  type WfSummary,
} from "@/lib/workflow";

const GROUP_ORDER: WfGroup[] = [
  "c90",
  "cellshop",
  "inspection",
  "process",
  "operation",
  "procurement",
  "warehouse",
  "planner",
];

const GROUP_ICON: Record<WfGroup | "all", LucideIcon> = {
  all: Inbox,
  c90: Wrench,
  cellshop: Factory,
  inspection: ClipboardCheck,
  process: ShieldCheck,
  operation: Power,
  procurement: ShoppingCart,
  warehouse: Package,
  planner: ClipboardList,
};

function asPool(snap: Record<string, unknown> | undefined): CartablePoolSnap | null {
  const pool = snap?.pool as CartablePoolSnap | undefined;
  return pool && typeof pool.reusable === "number" ? pool : null;
}

function asElements(value: unknown): CartableElementBrief[] {
  return Array.isArray(value) ? (value as CartableElementBrief[]) : [];
}

function num(snap: Record<string, unknown> | undefined, key: string): number {
  const v = snap?.[key];
  return typeof v === "number" ? v : 0;
}

function StatCard({
  label,
  value,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone?: "late" | "ok" | "neutral" | "accent" | "warn";
  icon?: LucideIcon;
}) {
  const hot = typeof value === "number" && value > 0 && (tone === "late" || tone === "warn" || tone === "ok");
  return (
    <article className={`rcd-stat is-${tone}${hot ? " is-hot" : ""}`}>
      <div className="rcd-stat-top">
        {Icon ? (
          <span className="rcd-stat-icon" aria-hidden>
            <Icon size={16} />
          </span>
        ) : null}
        <strong>{value}</strong>
      </div>
      <span>{label}</span>
    </article>
  );
}

function QuickLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Link href={href} className="rcd-chip">
      <Icon size={14} aria-hidden />
      <span>{children}</span>
      <ArrowUpRight size={13} aria-hidden />
    </Link>
  );
}

function PoolStrip({ pool, t }: { pool: CartablePoolSnap; t: (k: string, v?: Record<string, string | number>) => string }) {
  return (
    <section className="rcd-card rcd-pool">
      <div className="rcd-card-head">
        <div>
          <p className="rcd-eyebrow">{t("wf.desk.assemblyStock")}</p>
          <h4>{t("wf.desk.reusableReady")}</h4>
        </div>
        <Link href="/elements/assembly-stock" className="rcd-card-link">
          {t("wf.desk.openStock")}
          <ArrowUpRight size={14} />
        </Link>
      </div>
      <div className="rcd-stats rcd-stats-3">
        <StatCard label={t("wf.desk.reusable")} value={pool.reusable} tone="ok" icon={CheckCircle2} />
        <StatCard label={t("wf.desk.purchased")} value={pool.purchased} tone="accent" icon={ShoppingCart} />
        <StatCard label={t("wf.desk.recoated")} value={pool.recoated} tone="warn" icon={Sparkles} />
      </div>
      {pool.reusable_preview?.length ? (
        <ul className="rcd-piece-grid">
          {pool.reusable_preview.map((row) => (
            <li key={`${row.kind}-${row.serial}`} className={`rcd-piece is-${row.kind}`}>
              <span className="rcd-piece-kind">{row.kind === "anode" ? t("wf.desk.anode") : t("wf.desk.cathode")}</span>
              <strong className="en">{row.serial}</strong>
              {row.quality ? <em>{row.quality}</em> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rcd-empty-inline">{t("wf.desk.noReusable")}</p>
      )}
    </section>
  );
}

function RecentList({
  title,
  rows,
  dateKey,
  accent,
  t,
}: {
  title: string;
  rows: CartableElementBrief[];
  dateKey: "assembly_date" | "disassembly_date";
  accent: "assemble" | "dismantle";
  t: (k: string) => string;
}) {
  return (
    <section className={`rcd-card rcd-recent is-${accent}`}>
      <div className="rcd-card-head">
        <h4>{title}</h4>
        <span className="rcd-count-pill">{rows.length}</span>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((el) => (
            <li key={`${dateKey}-${el.id}`}>
              <Link href={`/elements?element_nr=${encodeURIComponent(el.element_nr || "")}`} className="rcd-el">
                <strong className="en">{el.element_nr || "—"}</strong>
                <span className="rcd-el-meta">
                  {[el.electrolyzer, el.position].filter(Boolean).join("-") || "—"}
                </span>
              </Link>
              <div className="rcd-el-parts">
                <span className="en" title={t("wf.desk.anode")}>
                  {el.anode_nr || "—"}
                </span>
                <span className="en" title={t("wf.desk.cathode")}>
                  {el.cathode_nr || "—"}
                </span>
              </div>
              <time>{formatDate(el[dateKey])}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rcd-empty-inline">{t("wf.desk.noRecent")}</p>
      )}
    </section>
  );
}

function GroupSnapshot({
  group,
  snap,
  t,
}: {
  group: WfGroup;
  snap: Record<string, unknown> | undefined;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  if (!snap) return null;
  const pool = asPool(snap);

  if (group === "c90") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitDisassembly")} value={num(snap, "await_disassembly")} tone={num(snap, "await_disassembly") ? "late" : "neutral"} icon={Wrench} />
          <StatCard label={t("wf.desk.awaitReinstall")} value={num(snap, "await_reinstall")} tone={num(snap, "await_reinstall") ? "warn" : "neutral"} icon={LayoutDashboard} />
          <StatCard label={t("wf.desk.awaitNumbering")} value={num(snap, "await_numbering")} icon={ClipboardList} />
          <StatCard label={t("wf.desk.awaitInspRequest")} value={num(snap, "await_inspection_request")} tone={num(snap, "await_inspection_request") ? "accent" : "neutral"} icon={ClipboardCheck} />
          <StatCard label={t("wf.desk.coatingApproval")} value={num(snap, "coating_approval")} icon={Sparkles} />
          <StatCard label={t("wf.desk.purchaseReg")} value={num(snap, "purchase_registration")} icon={ShoppingCart} />
          <StatCard label={t("wf.desk.awaitAssembly")} value={num(snap, "await_assembly")} tone={num(snap, "await_assembly") ? "accent" : "neutral"} icon={ClipboardList} />
          <StatCard label={t("wf.desk.awaitPosition")} value={num(snap, "await_position")} tone={num(snap, "await_position") ? "warn" : "neutral"} icon={LayoutDashboard} />
        </div>
        {pool ? <PoolStrip pool={pool} t={t} /> : null}
        <div className="rcd-two">
          <RecentList title={t("wf.desk.recentAssemblies")} rows={asElements(snap.recent_assemblies)} dateKey="assembly_date" accent="assemble" t={t} />
          <RecentList title={t("wf.desk.recentDisassemblies")} rows={asElements(snap.recent_disassemblies)} dateKey="disassembly_date" accent="dismantle" t={t} />
        </div>
        <div className="rcd-links">
          <QuickLink href="/elements/assembly" icon={ClipboardList}>
            {t("wf.desk.startAssemble")}
          </QuickLink>
          <QuickLink href="/element-dashboard" icon={LayoutDashboard}>
            {t("wf.desk.linkDashboard")}
          </QuickLink>
          <QuickLink href="/elements/assembly-stock" icon={Boxes}>
            {t("wf.desk.linkStock")}
          </QuickLink>
          <QuickLink href="/work-orders" icon={ClipboardList}>
            {t("wf.desk.linkWorkOrders")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "cellshop") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitShop")} value={num(snap, "await_shop")} tone={num(snap, "await_shop") ? "late" : "neutral"} icon={Timer} />
          <StatCard label={t("wf.desk.inShop")} value={num(snap, "in_shop")} tone={num(snap, "in_shop") ? "warn" : "neutral"} icon={Factory} />
        </div>
        {pool ? <PoolStrip pool={pool} t={t} /> : null}
        <RecentList title={t("wf.desk.recentAssemblies")} rows={asElements(snap.recent_assemblies)} dateKey="assembly_date" accent="assemble" t={t} />
        <div className="rcd-links">
          <QuickLink href="/element-dashboard?tab=shop" icon={Factory}>
            {t("wf.desk.linkShop")}
          </QuickLink>
          <QuickLink href="/elements/assembly-stock" icon={Boxes}>
            {t("wf.desk.linkStock")}
          </QuickLink>
          <QuickLink href="/elements/assembly" icon={ClipboardList}>
            {t("wf.desk.linkAssembly")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "inspection" || group === "process") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitInspection")} value={num(snap, "await_inspection")} tone={num(snap, "await_inspection") ? "late" : "neutral"} icon={ClipboardCheck} />
          <StatCard label={t("wf.desk.elementInspection")} value={num(snap, "element_inspection")} tone="accent" icon={ShieldCheck} />
          <StatCard label={t("wf.desk.coatingInspection")} value={num(snap, "coating_inspection")} icon={Sparkles} />
        </div>
        <p className="rcd-hint">{group === "process" ? t("wf.desk.processHint") : t("wf.desk.inspectionHint")}</p>
        <div className="rcd-links">
          <QuickLink href="/inspections" icon={ClipboardCheck}>
            {t("wf.desk.linkInspections")}
          </QuickLink>
          <QuickLink href="/segregation" icon={SplitSquareVertical}>
            {t("wf.desk.linkSegregation")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "operation") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitShutdown")} value={num(snap, "await_shutdown")} tone={num(snap, "await_shutdown") ? "late" : "neutral"} icon={Power} />
        </div>
        <div className="rcd-links">
          <QuickLink href="/element-dashboard?tab=requests" icon={Inbox}>
            {t("wf.desk.linkCellRequests")}
          </QuickLink>
          <QuickLink href="/arrangement" icon={LayoutDashboard}>
            {t("wf.desk.linkArrangement")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "procurement") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitCompany")} value={num(snap, "await_company")} icon={Factory} />
          <StatCard label={t("wf.desk.awaitDispatch")} value={num(snap, "await_dispatch")} icon={Package} />
          <StatCard label={t("wf.desk.awaitReturn")} value={num(snap, "await_return")} icon={Timer} />
          <StatCard label={t("wf.desk.awaitOrder")} value={num(snap, "await_order")} icon={ShoppingCart} />
        </div>
        <div className="rcd-links">
          <QuickLink href="/storage?section=coating" icon={Sparkles}>
            {t("wf.desk.linkCoating")}
          </QuickLink>
          <QuickLink href="/storage?section=purchase" icon={ShoppingCart}>
            {t("wf.desk.linkPurchase")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "warehouse") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.awaitIndent")} value={num(snap, "await_indent")} tone={num(snap, "await_indent") ? "late" : "neutral"} icon={Package} />
        </div>
        <div className="rcd-links">
          <QuickLink href="/storage" icon={Package}>
            {t("wf.desk.linkWarehouse")}
          </QuickLink>
        </div>
      </div>
    );
  }

  if (group === "planner") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          <StatCard label={t("wf.desk.openWorkOrders")} value={num(snap, "open_work_orders")} tone={num(snap, "open_work_orders") ? "late" : "neutral"} icon={ClipboardList} />
        </div>
        <div className="rcd-links">
          <QuickLink href="/work-orders" icon={ClipboardList}>
            {t("wf.desk.linkWorkOrders")}
          </QuickLink>
        </div>
      </div>
    );
  }

  return null;
}

export function RoleCartableDesk({ onOpen }: { onOpen: (flow: WfFlow, id: number) => void }) {
  const { t } = useI18n();
  const params = useSearchParams();
  const desk = useQuery({ queryKey: ["wf", "cartable-desk"], queryFn: workflowApi.cartableDesk, refetchInterval: CARTABLE_MS });
  const groups = useMemo(() => {
    const raw = desk.data?.groups ?? [];
    return [...raw].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b) || a.localeCompare(b));
  }, [desk.data?.groups]);

  const urlGroup = params.get("group") as WfGroup | null;
  const [active, setActive] = useState<WfGroup | "all">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (urlGroup && groups.includes(urlGroup)) setActive(urlGroup);
    else if (groups.length === 1) setActive(groups[0]);
  }, [urlGroup, groups]);

  if (desk.isLoading) return <LoadingState />;
  if (desk.isError) return <ErrorState message={(desk.error as Error).message} />;
  const data = desk.data as CartableDesk;
  const snap = active === "all" ? undefined : data.snapshots?.[active];
  const items: WfSummary[] = (active === "all" ? data.waiting : data.by_group?.[active]?.items ?? []).filter((row) =>
    matchesCartableQuery(row, q, t)
  );
  const late = active === "all" ? data.late_total : data.by_group?.[active]?.late ?? 0;
  const ActiveIcon = GROUP_ICON[active] || Inbox;

  return (
    <div className="rcd">
      <header className="rcd-hero">
        <div className="rcd-hero-copy">
          <p className="rcd-eyebrow">{t("wf.desk.kicker")}</p>
          <h2>
            <span className="rcd-hero-mark" aria-hidden>
              <Inbox size={20} />
            </span>
            {t("wf.desk.title")}
          </h2>
          <p>{t("wf.desk.subtitle")}</p>
        </div>
        <div className="rcd-hero-kpis">
          <StatCard label={t("wf.desk.waiting")} value={data.waiting_total} tone="accent" icon={Inbox} />
          <StatCard label={t("wf.desk.late")} value={data.late_total} tone={data.late_total ? "late" : "neutral"} icon={Timer} />
        </div>
      </header>

      <nav className="rcd-tabs" aria-label={t("wf.desk.tabs")}>
        <button type="button" className={active === "all" ? "is-active" : ""} onClick={() => setActive("all")}>
          <Inbox size={14} aria-hidden />
          {t("wf.desk.all")}
          <span>{data.waiting_total}</span>
        </button>
        {groups.map((g) => {
          const Icon = GROUP_ICON[g];
          const waiting = data.by_group?.[g]?.waiting ?? 0;
          const lateCount = data.by_group?.[g]?.late ?? 0;
          return (
            <button key={g} type="button" className={active === g ? "is-active" : ""} onClick={() => setActive(g)}>
              <Icon size={14} aria-hidden />
              {t(`wf.group.${g}`)}
              <span>{waiting}</span>
              {lateCount > 0 ? <em>{lateCount}</em> : null}
            </button>
          );
        })}
      </nav>

      {active !== "all" ? (
        <section className="rcd-panel">
          <div className="rcd-panel-head">
            <span className="rcd-panel-mark" aria-hidden>
              <ActiveIcon size={18} />
            </span>
            <div>
              <p className="rcd-eyebrow">{t("wf.desk.kicker")}</p>
              <h3>{t("wf.desk.focus", { role: t(`wf.group.${active}`) })}</h3>
            </div>
          </div>
          <GroupSnapshot group={active} snap={snap} t={t} />
        </section>
      ) : (
        <div className="rcd-all-hint">
          <Sparkles size={16} aria-hidden />
          <p>{t("wf.desk.allHint")}</p>
        </div>
      )}

      {late ? (
        <div className="rcd-alert">
          <Timer size={16} aria-hidden />
          {t("wf.sla.lateCount", { n: late })}
        </div>
      ) : null}

      <section className="rcd-table-card">
        <div className="rcd-card-head">
          <div>
            <p className="rcd-eyebrow">{t("wf.desk.waitingList")}</p>
            <h3>{active === "all" ? t("wf.desk.all") : t(`wf.group.${active}`)}</h3>
          </div>
          <label className="rcd-search">
            <Search size={14} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("wf.searchPlaceholder")} />
          </label>
          <span className="rcd-count-pill">{items.length}</span>
        </div>
        <DataTable
          columns={summaryColumns(t, true)}
          data={items.map((r) => ({ ...r, _key: `${r.flow}:${r.id}` }))}
          keyField="_key"
          onRowClick={(r) => onOpen(r.flow, r.id)}
          emptyTitle={t("wf.cartableEmpty")}
          maxHeight="min(52vh, 560px)"
        />
      </section>
    </div>
  );
}
