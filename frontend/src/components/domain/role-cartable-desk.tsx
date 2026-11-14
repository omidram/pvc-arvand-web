"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
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
  onClick,
  href,
  active = false,
}: {
  label: string;
  value: number | string;
  tone?: "late" | "ok" | "neutral" | "accent" | "warn";
  icon?: LucideIcon;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  const hot = typeof value === "number" && value > 0 && (tone === "late" || tone === "warn" || tone === "ok");
  const className = `rcd-stat is-${tone}${hot ? " is-hot" : ""}${active ? " is-picked" : ""}`;
  const body = (
    <>
      <div className="rcd-stat-top">
        {Icon ? (
          <span className="rcd-stat-icon" aria-hidden>
            <Icon size={16} />
          </span>
        ) : null}
        <strong>{value}</strong>
      </div>
      <span>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-pressed={active}>
        {body}
      </button>
    );
  }
  return <article className={className}>{body}</article>;
}

function partHref(kind: string, serial: string) {
  const q = encodeURIComponent(serial);
  if (kind === "cathode") return `/cathodes?cathode_nr=${q}`;
  if (kind === "membrane") return `/membranes?membrane_nr=${q}`;
  return `/anodes?anode_nr=${q}`;
}

function elementHref(el: CartableElementBrief) {
  const params = new URLSearchParams();
  if (el.element_nr) params.set("element_nr", el.element_nr);
  if (el.id) params.set("id", String(el.id));
  return `/elements/assembly?${params.toString()}`;
}

function poolCardHref(bucket: "reusable" | "purchased" | "recoated", pool: CartablePoolSnap) {
  const preview = bucket === "reusable" ? pool.reusable_preview : bucket === "purchased" ? pool.purchased_preview : pool.recoated_preview;
  if (preview?.length === 1 && preview[0]?.serial) return partHref(preview[0].kind, preview[0].serial);
  if (bucket === "purchased") return "/storage?section=purchase";
  if (bucket === "recoated") return "/storage?section=coating";
  return "/elements/assembly-stock";
}

/** Which waiting rows a desk tile is counting. The list below uses the same rule. */
function statMatch(key: string, group: WfGroup | "all", row: WfSummary): boolean {
  if (key === "waiting") return true;
  if (key === "late") return row.sla_state === "late";
  if (key === "await_disassembly") return row.flow === "cell" && row.status === "await_disassembly";
  if (key === "await_reinstall") return row.flow === "cell" && row.status === "await_reinstall";
  if (key === "await_numbering") return row.flow === "cell" && row.status === "await_numbering";
  if (key === "await_inspection_request") return row.flow === "inspection" && row.status === "await_request";
  if (key === "coating_approval") return row.flow === "coating" && row.status === "await_approval";
  if (key === "purchase_registration") return row.flow === "purchase" && row.status === "await_registration";
  if (key === "await_assembly") return row.flow === "assemble" && row.status === "await_assembly";
  if (key === "await_air") return row.flow === "assemble" && row.status === "await_air";
  if (key === "await_position") return row.flow === "assemble" && row.status === "await_position";
  if (key === "await_shop") return row.flow === "cell" && row.status === "await_shop";
  if (key === "in_shop") return row.flow === "cell" && row.status === "in_shop";
  if (key === "element_inspection") return row.flow === "inspection" && row.status === "await_inspection";
  if (key === "coating_inspection") return row.flow === "coating" && row.status === "await_inspection";
  if (key === "await_inspection") {
    if (group === "process") {
      return (row.status === "await_inspection" && row.groups.includes("process")) || (row.flow === "assemble" && row.status === "await_proc_sign");
    }
    return (row.status === "await_inspection" && row.groups.includes("inspection")) || (row.flow === "assemble" && row.status === "await_insp_sign");
  }
  if (key === "await_shutdown") return row.flow === "cell" && row.status === "await_shutdown";
  if (key === "await_company") return row.flow === "coating" && row.status === "await_company";
  if (key === "await_dispatch") return row.flow === "coating" && row.status === "await_dispatch";
  if (key === "await_return") return row.flow === "coating" && row.status === "await_return";
  if (key === "await_order") return row.flow === "purchase" && row.status === "await_order";
  if (key === "await_indent") return row.status === "await_indent";
  if (key === "open_work_orders") return row.flow === "workorder";
  return false;
}

const STAT_PAGE: Record<string, string> = {
  await_disassembly: "/element-dashboard?tab=requests",
  await_reinstall: "/element-dashboard?tab=requests",
  await_numbering: "/element-dashboard?tab=requests",
  await_inspection_request: "/inspections",
  coating_approval: "/storage?section=coating",
  purchase_registration: "/storage?section=purchase",
  await_assembly: "/elements/assembly",
  await_air: "/assembly-inspection",
  await_position: "/element-dashboard?tab=requests",
  await_shop: "/element-dashboard?tab=requests",
  in_shop: "/element-dashboard?tab=shop",
  await_inspection: "/inspections",
  element_inspection: "/inspections",
  coating_inspection: "/storage?section=coating",
  await_shutdown: "/element-dashboard?tab=requests",
  await_company: "/storage?section=coating",
  await_dispatch: "/storage?section=coating",
  await_return: "/storage?section=coating",
  await_order: "/storage?section=purchase",
  await_indent: "/storage",
  open_work_orders: "/work-orders",
};

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
        <StatCard label={t("wf.desk.reusable")} value={pool.reusable} tone="ok" icon={CheckCircle2} href={poolCardHref("reusable", pool)} />
        <StatCard label={t("wf.desk.purchased")} value={pool.purchased} tone="accent" icon={ShoppingCart} href={poolCardHref("purchased", pool)} />
        <StatCard label={t("wf.desk.recoated")} value={pool.recoated} tone="warn" icon={Sparkles} href={poolCardHref("recoated", pool)} />
      </div>
      {pool.reusable_preview?.length ? (
        <ul className="rcd-piece-grid">
          {pool.reusable_preview.map((row) => (
            <li key={`${row.kind}-${row.serial}`}>
              <Link href={partHref(row.kind, row.serial)} className={`rcd-piece is-${row.kind}`}>
                <span className="rcd-piece-kind">{row.kind === "anode" ? t("wf.desk.anode") : t("wf.desk.cathode")}</span>
                <strong className="en">{row.serial}</strong>
                {row.quality ? <em>{row.quality}</em> : null}
              </Link>
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
  const router = useRouter();
  return (
    <section className={`rcd-card rcd-recent is-${accent}`}>
      <div className="rcd-card-head">
        <h4>{title}</h4>
        <span className="rcd-count-pill">{rows.length}</span>
      </div>
      {rows.length ? (
        <ul>
          {rows.map((el) => (
            <li
              key={`${dateKey}-${el.id}`}
              className="is-link"
              role="link"
              tabIndex={0}
              onClick={() => router.push(elementHref(el))}
              onKeyDown={(event) => {
                if (event.key === "Enter") router.push(elementHref(el));
              }}
            >
              <span className="rcd-el">
                <strong className="en">{el.element_nr || "—"}</strong>
                <span className="rcd-el-meta">{[el.electrolyzer, el.position].filter(Boolean).join("-") || "—"}</span>
              </span>
              <div className="rcd-el-parts">
                {el.anode_nr ? (
                  <Link href={partHref("anode", el.anode_nr)} className="en" title={t("wf.desk.anode")} onClick={(event) => event.stopPropagation()}>
                    {el.anode_nr}
                  </Link>
                ) : (
                  <span className="en" title={t("wf.desk.anode")}>
                    —
                  </span>
                )}
                {el.cathode_nr ? (
                  <Link href={partHref("cathode", el.cathode_nr)} className="en" title={t("wf.desk.cathode")} onClick={(event) => event.stopPropagation()}>
                    {el.cathode_nr}
                  </Link>
                ) : (
                  <span className="en" title={t("wf.desk.cathode")}>
                    —
                  </span>
                )}
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
  onStat,
  activeKey,
}: {
  group: WfGroup;
  snap: Record<string, unknown> | undefined;
  t: (k: string, v?: Record<string, string | number>) => string;
  onStat: (key: string) => void;
  activeKey: string | null;
}) {
  const step = (key: string, label: string, tone: "late" | "ok" | "neutral" | "accent" | "warn" | undefined, icon: LucideIcon) => (
    <StatCard label={label} value={num(snap, key)} tone={tone} icon={icon} onClick={() => onStat(key)} active={activeKey === key} />
  );
  if (!snap) return null;
  const pool = asPool(snap);

  if (group === "c90") {
    return (
      <div className="rcd-snap">
        <div className="rcd-stats rcd-stats-grid">
          {step("await_disassembly", t("wf.desk.awaitDisassembly"), num(snap, "await_disassembly") ? "late" : "neutral", Wrench)}
          {step("await_reinstall", t("wf.desk.awaitReinstall"), num(snap, "await_reinstall") ? "warn" : "neutral", LayoutDashboard)}
          {step("await_numbering", t("wf.desk.awaitNumbering"), undefined, ClipboardList)}
          {step("await_inspection_request", t("wf.desk.awaitInspRequest"), num(snap, "await_inspection_request") ? "accent" : "neutral", ClipboardCheck)}
          {step("coating_approval", t("wf.desk.coatingApproval"), undefined, Sparkles)}
          {step("purchase_registration", t("wf.desk.purchaseReg"), undefined, ShoppingCart)}
          {step("await_assembly", t("wf.desk.awaitAssembly"), num(snap, "await_assembly") ? "accent" : "neutral", ClipboardList)}
          {step("await_air", t("wf.desk.awaitAir"), num(snap, "await_air") ? "warn" : "neutral", ClipboardCheck)}
          {step("await_position", t("wf.desk.awaitPosition"), num(snap, "await_position") ? "warn" : "neutral", LayoutDashboard)}
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
          {step("await_shop", t("wf.desk.awaitShop"), num(snap, "await_shop") ? "late" : "neutral", Timer)}
          {step("in_shop", t("wf.desk.inShop"), num(snap, "in_shop") ? "warn" : "neutral", Factory)}
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
          {step("await_inspection", t("wf.desk.awaitInspection"), num(snap, "await_inspection") ? "late" : "neutral", ClipboardCheck)}
          {step("element_inspection", t("wf.desk.elementInspection"), "accent", ShieldCheck)}
          {step("coating_inspection", t("wf.desk.coatingInspection"), undefined, Sparkles)}
        </div>
        <p className="rcd-hint">{group === "process" ? t("wf.desk.processHint") : t("wf.desk.inspectionHint")}</p>
        <div className="rcd-links">
          <QuickLink href="/inspections" icon={ClipboardCheck}>
            {t("wf.desk.linkInspections")}
          </QuickLink>
          <QuickLink href="/assembly-inspection" icon={ClipboardCheck}>
            {t("wf.asm.openAir")}
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
          {step("await_shutdown", t("wf.desk.awaitShutdown"), num(snap, "await_shutdown") ? "late" : "neutral", Power)}
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
          {step("await_company", t("wf.desk.awaitCompany"), undefined, Factory)}
          {step("await_dispatch", t("wf.desk.awaitDispatch"), undefined, Package)}
          {step("await_return", t("wf.desk.awaitReturn"), undefined, Timer)}
          {step("await_order", t("wf.desk.awaitOrder"), undefined, ShoppingCart)}
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
          {step("await_indent", t("wf.desk.awaitIndent"), num(snap, "await_indent") ? "late" : "neutral", Package)}
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
          {step("open_work_orders", t("wf.desk.openWorkOrders"), num(snap, "open_work_orders") ? "late" : "neutral", ClipboardList)}
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
  const router = useRouter();
  const params = useSearchParams();
  const listRef = useRef<HTMLElement>(null);
  const desk = useQuery({ queryKey: ["wf", "cartable-desk"], queryFn: workflowApi.cartableDesk, refetchInterval: CARTABLE_MS });
  const groups = useMemo(() => {
    const raw = desk.data?.groups ?? [];
    return [...raw].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b) || a.localeCompare(b));
  }, [desk.data?.groups]);

  const urlGroup = params.get("group") as WfGroup | null;
  const [active, setActive] = useState<WfGroup | "all">("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (urlGroup && groups.includes(urlGroup)) setActive(urlGroup);
    else if (groups.length === 1) setActive(groups[0]);
  }, [urlGroup, groups]);

  if (desk.isLoading) return <LoadingState />;
  if (desk.isError) return <ErrorState message={(desk.error as Error).message} />;
  const data = desk.data as CartableDesk;
  const snap = active === "all" ? undefined : data.snapshots?.[active];
  const source = active === "all" ? data.waiting : data.by_group?.[active]?.items ?? [];
  const groupForMatch: WfGroup | "all" = active;
  const narrowed =
    picked === "late"
      ? data.waiting.filter((row) => row.sla_state === "late")
      : picked
        ? source.filter((row) => statMatch(picked, groupForMatch, row))
        : source;
  const items: WfSummary[] = narrowed.filter((row) => matchesCartableQuery(row, q, t));

  function showList() {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function chooseStat(key: string) {
    if (key === "waiting") {
      setPicked(null);
      showList();
      return;
    }
    if (picked === key) {
      setPicked(null);
      return;
    }
    setPicked(key);
    const matched = (key === "late" ? data.waiting : source).filter((row) => statMatch(key, groupForMatch, row));
    if (matched.length === 1) onOpen(matched[0].flow, matched[0].id);
    else if (matched.length === 0 && STAT_PAGE[key]) router.push(STAT_PAGE[key]);
    else showList();
  }

  function chooseGroup(next: WfGroup | "all") {
    setActive(next);
    setPicked(null);
  }
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
          <StatCard label={t("wf.desk.waiting")} value={data.waiting_total} tone="accent" icon={Inbox} onClick={() => chooseStat("waiting")} />
          <StatCard label={t("wf.desk.late")} value={data.late_total} tone={data.late_total ? "late" : "neutral"} icon={Timer} onClick={() => chooseStat("late")} active={picked === "late"} />
        </div>
      </header>

      <nav className="rcd-tabs" aria-label={t("wf.desk.tabs")}>
        <button type="button" className={active === "all" ? "is-active" : ""} onClick={() => chooseGroup("all")}>
          <Inbox size={14} aria-hidden />
          {t("wf.desk.all")}
          <span>{data.waiting_total}</span>
        </button>
        {groups.map((g) => {
          const Icon = GROUP_ICON[g];
          const waiting = data.by_group?.[g]?.waiting ?? 0;
          const lateCount = data.by_group?.[g]?.late ?? 0;
          return (
            <button key={g} type="button" className={active === g ? "is-active" : ""} onClick={() => chooseGroup(g)}>
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
          <GroupSnapshot group={active} snap={snap} t={t} onStat={chooseStat} activeKey={picked} />
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

      <section className="rcd-table-card" ref={listRef}>
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
