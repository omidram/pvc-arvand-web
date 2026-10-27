"use client";

import { useMemo, useState, type ReactNode } from "react";
import { InServiceBreakdown } from "@/components/domain/in-service-breakdown";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { elementDashboardApi } from "@/lib/endpoints";
import type { BoardList, BoardPallet, BoardPiece, ElementBoard, ElementDashOverview, ElementStage, WorkshopSheet } from "@/lib/types";
import { workflowApi, type AssemblyPool, type AssemblyPoolRow } from "@/lib/workflow";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime, formatDisplayedDate, formatNumber } from "@/lib/utils";
import { ElementReportGuideButton } from "./element-report-guide";
import { MembraneUsedModal } from "./membrane-stock-panel";
import { STAGE_FLOW, STAGE_TONE } from "./element-dashboard-ui";

const FLOW_KINDS = ["assembled", "commissioned", "decommissioned", "disassembled"] as const;
type FlowGrain = "day" | "week" | "month" | "year";
type FlowHit = { date: string; kind: string; element_nr: string; reason: string | null };

function bucketLabel(key: string, grain: FlowGrain): string {
  if (grain === "year") return key;
  if (grain === "month") return formatDisplayedDate(`${key}-01`);
  return formatDisplayedDate(key);
}

function reasonBits(reason: string | null | undefined): string[] {
  const bits = (reason || "")
    .split(",")
    .map((bit) => bit.trim())
    .filter(Boolean);
  return bits;
}

function href(tab: string, extra: Record<string, string> = {}): string {
  return `/element-dashboard?${new URLSearchParams({ tab, ...extra }).toString()}`;
}

function pieceHref(serial: string): string {
  return `/segregation?serial_nr=${encodeURIComponent(serial)}`;
}

function elementHref(nr: string): string {
  return `/elements/assembly?element_nr=${encodeURIComponent(nr)}`;
}

function membraneHref(nr: string): string {
  return `/membranes?membrane_nr=${encodeURIComponent(nr)}`;
}

function palletHref(pallet: BoardPallet): string {
  return pallet.batch_id ? `/cartable?wf=coating:${pallet.batch_id}` : "/cartable";
}

/** Element counterpart of the voltage report: where the elements are, how worn the parts are, what is at the coater. */
export function ElementReportPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { canView } = useAuth();
  const allowed = canView("elements") || canView("anodes") || canView("cathodes") || canView("membranes") || canView("storage");
  const query = useQuery({
    queryKey: ["element-dashboard", "overview"],
    queryFn: () => elementDashboardApi.overview(false),
    enabled: allowed,
    refetchInterval: 60_000,
  });
  if (!allowed) return null;

  const cls = `dash-voltage-report er-report ${compact ? "is-compact" : ""}`;
  const head = (updated?: string) => (
    <div className="dash-voltage-head">
      <div className="er-report-lead">
        <h2 className="dash-voltage-title">{t("elDash.report.title")}</h2>
        <p className="dash-voltage-sub">{t("elDash.report.sub")}</p>
        {updated ? <p className="er-updated">{updated}</p> : null}
      </div>
      <div className="er-report-actions">
        <ElementReportGuideButton compact={compact} />
        <Link href="/element-dashboard" className="dash-voltage-link">
          {t("elDash.report.open")}
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );

  if (query.isLoading && !query.data) {
    return (
      <section className={cls}>
        {head()}
        <p className="dash-voltage-sub">{t("elDash.loading")}</p>
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section className={cls}>
        {head()}
        <p className="dash-voltage-sub" style={{ color: "#a10000" }}>
          {(query.error as Error | null)?.message || "Error"}
        </p>
      </section>
    );
  }
  return <Report data={query.data} compact={compact} cls={cls} head={head} />;
}

function vendorName(t: (path: string, vars?: Record<string, string | number | null | undefined>) => string, name: string) {
  const key = `elDash.report.vendor.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

function coatingGrade(quality: string | null): "good" | "medium" | "open" {
  const text = (quality || "").trim().toLowerCase();
  if (!text) return "open";
  if (text.includes("medium") || text.includes("متوسط")) return "medium";
  if (text.includes("good") || text.includes("خوب")) return "good";
  return "open";
}

function countSide(rows: AssemblyPoolRow[], kind: "anode" | "cathode", grade?: "good" | "medium" | "open") {
  return rows.filter((row) => row.kind === kind && (grade == null || coatingGrade(row.quality) === grade)).length;
}

/** Anode and cathode counts: reusable from TAFKIK, plus purchased / recoated stock tables. */
function AssemblyStockSummary({ board }: { board?: ElementBoard }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const pool = useQuery({
    queryKey: ["workflow", "assembly-pool"],
    queryFn: () => workflowApi.assemblyPool(),
    staleTime: 30_000,
  });
  const data: AssemblyPool | undefined = pool.data;
  const rows: { key: string; label: string; anode: number; cathode: number }[] = [
    { key: "good", label: t("elDash.report.stockGood"), anode: board?.stock_good?.anode ?? countSide(data?.reusable || [], "anode", "good"), cathode: board?.stock_good?.cathode ?? countSide(data?.reusable || [], "cathode", "good") },
    { key: "medium", label: t("elDash.report.stockMedium"), anode: board?.stock_medium?.anode ?? countSide(data?.reusable || [], "anode", "medium"), cathode: board?.stock_medium?.cathode ?? countSide(data?.reusable || [], "cathode", "medium") },
    { key: "open", label: t("elDash.report.stockOpen"), anode: board?.stock_open?.anode ?? countSide(data?.reusable || [], "anode", "open"), cathode: board?.stock_open?.cathode ?? countSide(data?.reusable || [], "cathode", "open") },
    { key: "purchased", label: t("assemblyStock.purchased"), anode: countSide(data?.purchased || [], "anode"), cathode: countSide(data?.purchased || [], "cathode") },
    { key: "recoated", label: t("assemblyStock.recoated"), anode: countSide(data?.recoated || [], "anode"), cathode: countSide(data?.recoated || [], "cathode") },
  ].filter((row) => row.key === "purchased" || row.key === "recoated" || row.anode + row.cathode > 0);
  if (!rows.length) return null;
  const anodeTotal = rows.reduce((sum, row) => sum + row.anode, 0);
  const cathodeTotal = rows.reduce((sum, row) => sum + row.cathode, 0);
  return (
    <section className="er-panel">
      <h3 className="er-shop-title">
        <Link href="/elements/assembly-stock">{t("elDash.report.stockTitle")}</Link>
        <CollapseBtn open={open} onToggle={() => setOpen((v) => !v)} locale={locale} />
      </h3>
      {open ? (
      <>
      <p className="dash-voltage-sub">{t("elDash.report.stockSub")}</p>
      <table className="ed-table er-shop-table">
        <thead>
          <tr>
            <th>{t("assemblyStock.quality")}</th>
            <th className="ed-num">{t("elDash.report.anode")}</th>
            <th className="ed-num">{t("elDash.report.cathode")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <Link href="/elements/assembly-stock">{row.label}</Link>
              </td>
              <td className="ed-num">
                <Link href="/elements/assembly-stock">{formatNumber(row.anode, 0)}</Link>
              </td>
              <td className="ed-num">
                <Link href="/elements/assembly-stock">{formatNumber(row.cathode, 0)}</Link>
              </td>
            </tr>
          ))}
          <tr className="is-total">
            <td>
              <Link href="/elements/assembly-stock">
                <strong>{t("elDash.report.stockTotal")}</strong>
              </Link>
            </td>
            <td className="ed-num">
              <Link href="/elements/assembly-stock">
                <strong>{formatNumber(anodeTotal, 0)}</strong>
              </Link>
            </td>
            <td className="ed-num">
              <Link href="/elements/assembly-stock">
                <strong>{formatNumber(cathodeTotal, 0)}</strong>
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
      <SerialStrip
        title={t("elDash.report.assemblySerials")}
        rows={[...(data?.purchased ?? []), ...(data?.recoated ?? [])]}
      />
      </>
      ) : null}
    </section>
  );
}

function sourceLabel(t: (path: string, vars?: Record<string, string | number | null | undefined>) => string, row: AssemblyPoolRow) {
  if (row.source === "purchased") return t("assemblyStock.purchased");
  if (row.source === "recoated") return t("assemblyStock.recoated");
  const grade = coatingGrade(row.quality);
  if (grade === "good") return t("elDash.report.stockGood");
  if (grade === "medium") return t("elDash.report.stockMedium");
  return t("elDash.report.stockOpen");
}

function SerialStrip({ title, rows }: { title: string; rows: AssemblyPoolRow[] }) {
  const { t } = useI18n();
  const shown = rows.slice(0, 24);
  if (!shown.length) return null;
  return (
    <div className="er-serial-strip">
      <div className="er-board-kicker">{title}</div>
      <ul className="er-board-list">
        {shown.map((row) => (
          <li key={`${row.source}-${row.kind}-${row.serial}`}>
            <span className={`er-kind is-${row.kind}`}>{row.kind === "cathode" ? "C" : "A"}</span>
            <Link href={pieceHref(row.serial)}>{row.serial}</Link>
            <span className="er-board-meta">{sourceLabel(t, row)}</span>
          </li>
        ))}
        {rows.length > shown.length ? (
          <li className="er-board-more">
            <Link href="/elements/assembly-stock">{t("elDash.report.more", { n: rows.length - shown.length })}</Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Workshop inventory in the same groups as the cell-shop paper: assembled cells, spare electrodes, coating, membranes. */
function ShopSheet({ sheet, compact }: { sheet: WorkshopSheet; compact: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [usedPick, setUsedPick] = useState<{ type: string | undefined } | null>(null);
  const pairLimit = compact ? 4 : sheet.assembled_pairs.length;
  const typeLimit = compact ? 4 : sheet.membrane_types.length;
  const coated = (kind: "anode" | "cathode") => (compact ? sheet[kind].coated.slice(0, 4) : sheet[kind].coated);
  return (
    <section className="er-panel">
      <h3 className="er-shop-title">
        <Link href={href("shop")}>{t("elDash.report.shopTitle")}</Link>
        <CollapseBtn open={open} onToggle={() => setOpen((v) => !v)} locale={locale} />
      </h3>
      {open ? (
      <>
      <p className="dash-voltage-sub">{t("elDash.report.shopSub")}</p>
      <div className="er-shop-grid">
        <table className="ed-table er-shop-table">
          <thead>
            <tr>
              <th>{t("elDash.report.assembled")}</th>
              <th className="ed-num">{t("elDash.report.assembledTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.assembled_pairs.slice(0, pairLimit).map((row) => (
              <tr key={`${row.anode}-${row.cathode}`}>
                <td>
                  <Link href={href("shop", { stage: "ready" })}>
                    {t("elDash.report.assembledPair", { anode: vendorName(t, row.anode), cathode: vendorName(t, row.cathode) })}
                  </Link>
                </td>
                <td className="ed-num">
                  <Link href={href("shop", { stage: "ready" })}>{formatNumber(row.count, 0)}</Link>
                </td>
              </tr>
            ))}
            {sheet.assembled_membranes.slice(0, typeLimit).map((row) => (
              <tr key={row.type}>
                <td>
                  <Link href="/membranes">{t("elDash.report.assembledMem", { type: row.type })}</Link>
                </td>
                <td className="ed-num">
                  <Link href="/membranes">{formatNumber(row.count, 0)}</Link>
                </td>
              </tr>
            ))}
            <tr className="is-total">
              <td>
                <Link href={href("shop", { stage: "ready" })}>
                  <strong>{t("elDash.report.assembledTotal")}</strong>
                </Link>
              </td>
              <td className="ed-num">
                <Link href={href("shop", { stage: "ready" })}>
                  <strong>{formatNumber(sheet.assembled_total, 0)}</strong>
                </Link>
              </td>
            </tr>
            <tr>
              <td>
                <Link href={href("shop", { stage: "awaiting_disassembly" })}>{t("elDash.report.dismantleTitle")}</Link>
              </td>
              <td className="ed-num">
                <Link href={href("shop", { stage: "awaiting_disassembly" })}>{formatNumber(sheet.awaiting_disassembly, 0)}</Link>
              </td>
            </tr>
            <tr>
              <td>
                <button type="button" className="asm-link" onClick={() => setUsedPick({ type: undefined })}>
                  <strong>{t("membraneStock.dashTitle")}</strong>
                </button>
              </td>
              <td className="ed-num">
                <button type="button" className="asm-link" onClick={() => setUsedPick({ type: undefined })}>
                  {formatNumber(sheet.membrane_used?.total ?? 0, 0)}
                </button>
              </td>
            </tr>
            {(sheet.membrane_used?.types ?? []).slice(0, typeLimit).map((row) => (
              <tr key={`used-${row.type}`}>
                <td>
                  <button type="button" className="asm-link" onClick={() => setUsedPick({ type: row.type })}>
                    {row.type}
                  </button>
                </td>
                <td className="ed-num">
                  <button type="button" className="asm-link" onClick={() => setUsedPick({ type: row.type })}>
                    {formatNumber(row.count, 0)}
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <Link href="/elements/assembly-stock">{t("membraneStock.dashStore")}</Link>
              </td>
              <td className="ed-num">
                <Link href="/elements/assembly-stock">{formatNumber(sheet.membrane_store?.total ?? 0, 0)}</Link>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="ed-table er-shop-table">
          <thead>
            <tr>
              <th>{t("elDash.report.spareTitle")}</th>
              <th className="ed-num">{t("elDash.report.anode")}</th>
              <th className="ed-num">{t("elDash.report.cathode")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Link href="/elements/assembly-stock">{t("elDash.report.usable")}</Link>
              </td>
              <td className="ed-num">
                <Link href="/elements/assembly-stock">{formatNumber(sheet.anode.usable, 0)}</Link>
              </td>
              <td className="ed-num">
                <Link href="/elements/assembly-stock">{formatNumber(sheet.cathode.usable, 0)}</Link>
              </td>
            </tr>
            {Array.from(new Set([...coated("anode").map((r) => r.vendor), ...coated("cathode").map((r) => r.vendor)])).map((vendor) => (
              <tr key={vendor}>
                <td>
                  <Link href="/cartable">{t("elDash.report.coatedBy", { vendor: vendorName(t, vendor) })}</Link>
                </td>
                <td className="ed-num">
                  <Link href="/cartable">{formatNumber(sheet.anode.coated.find((r) => r.vendor === vendor)?.count ?? 0, 0)}</Link>
                </td>
                <td className="ed-num">
                  <Link href="/cartable">{formatNumber(sheet.cathode.coated.find((r) => r.vendor === vendor)?.count ?? 0, 0)}</Link>
                </td>
              </tr>
            ))}
            <tr>
              <td>
                <Link href={href("parts", { kind: "anode" })}>{t("elDash.report.trainLm")}</Link>
              </td>
              <td className="ed-num">
                <Link href={href("parts", { kind: "anode" })}>{formatNumber(sheet.anode.train_lm, 0)}</Link>
              </td>
              <td className="ed-num">
                <Link href={href("parts", { kind: "cathode" })}>{formatNumber(sheet.cathode.train_lm, 0)}</Link>
              </td>
            </tr>
            <tr>
              <td>
                <Link href="/storage">{t("elDash.report.awaitingCheck")}</Link>
              </td>
              <td className="ed-num">
                <Link href="/storage">{formatNumber(sheet.anode.awaiting_check, 0)}</Link>
              </td>
              <td className="ed-num">
                <Link href="/storage">{formatNumber(sheet.cathode.awaiting_check, 0)}</Link>
              </td>
            </tr>
            <tr>
              <td>
                <Link href="/segregation">{t("elDash.report.rateOff")}</Link>
              </td>
              <td className="ed-num">
                <Link href="/segregation">{formatNumber(sheet.anode.rate_off, 0)}</Link>
              </td>
              <td className="ed-num">
                <Link href="/segregation">{formatNumber(sheet.cathode.rate_off, 0)}</Link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </>
      ) : null}
      <MembraneUsedModal open={usedPick != null} onClose={() => setUsedPick(null)} type={usedPick?.type} />
    </section>
  );
}

function reasonText(t: (path: string) => string, reason: string | null | undefined) {
  const key = `elDash.report.reason.${reason || "other"}`;
  const label = t(key);
  return label === key ? reason || "" : label;
}

function PieceList({ list, moreHref }: { list: BoardList; moreHref: string }) {
  const { t } = useI18n();
  const items = list.items || [];
  if (!items.length) return <p className="er-board-empty">{t("elDash.report.none")}</p>;
  const more = Math.max(0, (list.total || 0) - items.length);
  return (
    <ul className="er-board-list">
      {items.map((item: BoardPiece, index) => (
        <li key={`${item.kind}-${item.serial}-${index}`}>
          <span className={`er-kind is-${item.kind === "cathode" ? "cathode" : "anode"}`}>{item.kind === "cathode" ? "C" : "A"}</span>
          {item.serial ? <Link href={pieceHref(item.serial)}>{item.serial}</Link> : <span>—</span>}
          {item.date ? <span className="er-board-meta">{formatDisplayedDate(item.date)}</span> : null}
          {item.element_nr ? (
            <Link className="er-board-meta" href={elementHref(item.element_nr)}>
              {item.element_nr}
            </Link>
          ) : null}
          {item.company ? <span className="er-board-meta">{item.company}</span> : null}
          {item.days != null ? <span className="er-board-meta">{t("elDash.report.daysOut", { n: item.days })}</span> : null}
          {item.reason ? <span className="er-board-meta">{reasonText(t, item.reason)}</span> : null}
        </li>
      ))}
      {more > 0 ? (
        <li className="er-board-more">
          <Link href={moreHref}>{t("elDash.report.more", { n: more })}</Link>
        </li>
      ) : null}
    </ul>
  );
}

function CountPair({ anode, cathode, hrefTo }: { anode: number; cathode: number; hrefTo: string }) {
  const { t } = useI18n();
  return (
    <Link href={hrefTo} className="er-board-nums">
      <div>
        <strong>{formatNumber(anode, 0)}</strong>
        <span>{t("elDash.report.anode")}</span>
      </div>
      <div>
        <strong>{formatNumber(cathode, 0)}</strong>
        <span>{t("elDash.report.cathode")}</span>
      </div>
    </Link>
  );
}

function GroupedCounts({
  groups,
  hrefTo,
}: {
  groups: { key: string; label: string; list?: BoardList }[];
  hrefTo: string;
}) {
  return (
    <div className="er-board-groups">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="er-board-kicker">{group.label}</div>
          <CountPair anode={group.list?.anode ?? 0} cathode={group.list?.cathode ?? 0} hrefTo={hrefTo} />
        </div>
      ))}
    </div>
  );
}

function BoardCard({ title, sub, hrefTo, tone, children }: { title: string; sub: string; hrefTo: string; tone: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <article className={`er-board-card is-${tone}${open ? " is-open" : " is-min"}`}>
      <button type="button" className="er-board-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <h3 className="er-shop-title">{title}</h3>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      <p className="er-board-sub">{sub}</p>
      {open ? (
        <>
          <Link className="er-board-open" href={hrefTo}>
            {title}
          </Link>
          {children}
        </>
      ) : null}
    </article>
  );
}

function ManagementBoard({ board }: { board: ElementBoard }) {
  const { t } = useI18n();
  return (
    <div className="er-board">
      <BoardCard title={t("elDash.report.readySendTitle")} sub={t("elDash.report.readySendSub")} hrefTo="/segregation" tone="send">
        <GroupedCounts
          hrefTo="/segregation"
          groups={[
            { key: "coating", label: t("elDash.report.readySendCoating"), list: board.ready_send_coating },
            { key: "mechanical", label: t("elDash.report.readySendMechanical"), list: board.ready_send_mechanical },
          ]}
        />
        <PieceList list={board.ready_send} moreHref="/segregation" />
      </BoardCard>
      <BoardCard title={t("elDash.report.stockCardTitle")} sub={t("elDash.report.stockCardSub")} hrefTo="/segregation" tone="stock">
        <GroupedCounts
          hrefTo="/segregation"
          groups={[
            { key: "good", label: t("elDash.report.stockGood"), list: board.stock_good },
            { key: "medium", label: t("elDash.report.stockMedium"), list: board.stock_medium },
            { key: "open", label: t("elDash.report.stockOpen"), list: board.stock_open },
          ]}
        />
        <PieceList list={board.stock || { anode: 0, cathode: 0, total: 0, shown: 0, items: [] }} moreHref="/segregation" />
      </BoardCard>
      <BoardCard title={t("elDash.report.disassembledTitle")} sub={t("elDash.report.disassembledSub")} hrefTo={href("shop", { stage: "disassembled" })} tone="apart">
        <CountPair anode={board.disassembled.anode} cathode={board.disassembled.cathode} hrefTo={href("shop", { stage: "disassembled" })} />
        <PieceList list={board.disassembled} moreHref={href("shop", { stage: "disassembled" })} />
      </BoardCard>
      <BoardCard title={t("elDash.report.rateOffTitle")} sub={t("elDash.report.rateOffSub")} hrefTo="/segregation" tone="off">
        <CountPair anode={board.rate_off.anode} cathode={board.rate_off.cathode} hrefTo="/segregation" />
        <PieceList list={board.rate_off} moreHref="/segregation" />
      </BoardCard>
      <BoardCard title={t("elDash.report.atCoaterTitle")} sub={t("elDash.report.atCoaterSub")} hrefTo="/cartable" tone="coat">
        <CountPair anode={board.at_coater.anode} cathode={board.at_coater.cathode} hrefTo="/cartable" />
        <PieceList list={board.at_coater} moreHref="/cartable" />
      </BoardCard>
      <BoardCard title={t("elDash.report.awaitingTitle")} sub={t("elDash.report.awaitingSub")} hrefTo="/storage" tone="check">
        <CountPair anode={board.awaiting_check.anode} cathode={board.awaiting_check.cathode} hrefTo="/storage" />
        <PieceList list={board.awaiting_check} moreHref="/storage" />
      </BoardCard>
      <BoardCard title={t("elDash.report.membraneCard")} sub={t("elDash.report.membraneCardSub")} hrefTo="/membranes" tone="mem">
        <Link href="/membranes" className="er-board-nums">
          <div>
            <strong>{formatNumber(board.membranes.stock, 0)}</strong>
            <span>{t("elDash.report.membraneTotal")}</span>
          </div>
          <div>
            <strong>{formatNumber(board.membranes.installed, 0)}</strong>
            <span>{t("elDash.report.membraneOnCells")}</span>
          </div>
        </Link>
        {board.membranes.items.length === 0 ? (
          <p className="er-board-empty">{t("elDash.report.none")}</p>
        ) : (
          <ul className="er-board-list">
            {board.membranes.items.map((item, index) => (
              <li key={`${item.serial}-${index}`}>
                <span className="er-kind is-membrane">M</span>
                {item.serial ? <Link href={membraneHref(item.serial)}>{item.serial}</Link> : <span>—</span>}
                <span className="er-board-meta">{item.type}</span>
              </li>
            ))}
            {board.membranes.stock > board.membranes.items.length ? (
              <li className="er-board-more">
                <Link href="/membranes">{t("elDash.report.more", { n: board.membranes.stock - board.membranes.items.length })}</Link>
              </li>
            ) : null}
          </ul>
        )}
      </BoardCard>
    </div>
  );
}

function PalletBoard({ pallets }: { pallets: BoardPallet[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className={`er-panel${open ? " is-open" : " is-min"}`}>
      <button type="button" className="er-board-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <h3 className="er-shop-title">{t("elDash.report.palletTitle")}</h3>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      <p className="dash-voltage-sub">{t("elDash.report.palletSub")}</p>
      {!open ? null : pallets.length === 0 ? (
        <p className="er-board-empty">{t("elDash.report.palletEmpty")}</p>
      ) : (
        <div className="er-pallet-grid">
          {pallets.map((pallet) => {
            const statusKey = `wf.status.${pallet.status}`;
            const status = t(statusKey);
            return (
              <article key={`${pallet.code}-${pallet.pallet_no}`} className="er-pallet">
                <header>
                  <Link href={palletHref(pallet)}>
                    <strong>{pallet.code}</strong>
                  </Link>
                  <Link href={palletHref(pallet)}>{t("elDash.report.palletNo", { no: pallet.pallet_no })}</Link>
                  <span className="er-board-meta">{status === statusKey ? pallet.status : status}</span>
                  {pallet.company ? <span className="er-board-meta">{pallet.company}</span> : null}
                </header>
                <Link href={palletHref(pallet)} className="er-board-nums is-compact">
                  <div>
                    <strong>{formatNumber(pallet.anode_count, 0)}</strong>
                    <span>{t("elDash.report.anode")}</span>
                  </div>
                  <div>
                    <strong>{formatNumber(pallet.cathode_count, 0)}</strong>
                    <span>{t("elDash.report.cathode")}</span>
                  </div>
                </Link>
                <ul className="er-board-list">
                  {pallet.anodes.map((serial) => (
                    <li key={`a-${serial}`}>
                      <span className="er-kind is-anode">A</span>
                      <Link href={pieceHref(serial)}>{serial}</Link>
                    </li>
                  ))}
                  {pallet.cathodes.map((serial) => (
                    <li key={`c-${serial}`}>
                      <span className="er-kind is-cathode">C</span>
                      <Link href={pieceHref(serial)}>{serial}</Link>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function MonthFlow({ compact }: { compact: boolean }) {
  const { t } = useI18n();
  const [grain, setGrain] = useState<FlowGrain>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pick, setPick] = useState("");
  const series = useQuery({
    queryKey: ["element-dashboard", "activity", grain],
    queryFn: () => elementDashboardApi.activity(grain),
    staleTime: 60_000,
  });
  const why = useQuery({
    queryKey: ["element-dashboard", "activity-why", grain, pick],
    queryFn: () => elementDashboardApi.activityWhy(grain, pick),
    enabled: Boolean(pick),
  });
  const buckets = series.data || [];
  const shown = useMemo(() => {
    // Never plot periods that have not started yet (bad or future-dated events).
    const today = new Date().toISOString().slice(0, 10);
    const rows = buckets.filter((row) => row.key <= today.slice(0, row.key.length) && (!from || row.key >= from) && (!to || row.key <= to));
    const limited = from || to ? rows : grain === "day" ? rows.slice(-31) : grain === "week" ? rows.slice(-16) : grain === "year" ? rows : rows.slice(-12);
    return limited.map((row) => ({ ...row, label: bucketLabel(row.key, grain) }));
  }, [buckets, from, to, grain]);
  const picked = shown.find((row) => row.key === pick) || null;
  const hits = (why.data || []) as FlowHit[];
  const reasons = useMemo(() => {
    const counts = new Map<string, string[]>();
    for (const event of hits) {
      if (event.kind !== "decommissioned") continue;
      const bits = reasonBits(event.reason);
      const labels = bits.length ? bits : ["—"];
      for (const label of labels) {
        const list = counts.get(label) || [];
        if (event.element_nr && !list.includes(event.element_nr)) list.push(event.element_nr);
        counts.set(label, list);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hits]);
  return (
    <section className="er-panel er-flow">
      <div className="er-flow-head">
        <div>
          <h3 className="er-shop-title">{t(`elDash.report.flowGrainTitle.${grain}`)}</h3>
          <p className="dash-voltage-sub">{t("elDash.report.flowHint")}</p>
        </div>
        <div className="er-flow-filter">
          {(["day", "week", "month", "year"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`er-flow-chip ${grain === key ? "is-on" : ""}`}
              onClick={() => {
                setGrain(key);
                setFrom("");
                setTo("");
                setPick("");
              }}
            >
              {t(`elDash.report.grain.${key}`)}
            </button>
          ))}
          <label>
            {t("elDash.report.flowFrom")}
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">—</option>
              {buckets.map((row) => (
                <option key={row.key} value={row.key}>
                  {bucketLabel(row.key, grain)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("elDash.report.flowTo")}
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">—</option>
              {buckets.map((row) => (
                <option key={`to-${row.key}`} value={row.key}>
                  {bucketLabel(row.key, grain)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="er-flow-body">
      <div className="er-flow-chart" style={{ height: compact ? 260 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={shown}
            margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            onClick={(state) => {
              const label = state?.activeLabel == null ? "" : String(state.activeLabel);
              const index = Number(state?.activeIndex ?? state?.activeTooltipIndex);
              const row = (label && shown.find((item) => item.label === label)) || (Number.isFinite(index) ? shown[index] : undefined);
              if (row?.key) setPick(row.key);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={36} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="assembled" name={t("elDash.flow.assembled")} stroke="#7c3aed" strokeWidth={2.4} dot={{ r: 2 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="commissioned" name={t("elDash.flow.commissioned")} stroke="#16a34a" strokeWidth={2.4} dot={{ r: 2 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="decommissioned" name={t("elDash.flow.decommissioned")} stroke="#dc2626" strokeWidth={2.4} dot={{ r: 2 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="disassembled" name={t("elDash.flow.disassembled")} stroke="#64748b" strokeWidth={2.4} dot={{ r: 2 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="er-flow-why">
        <h4>{t("elDash.report.whyTitle")}</h4>
        {!picked ? <p>{t("elDash.report.whyHint")}</p> : null}
        {picked && why.isFetching ? <p>{t("common.loading")}</p> : null}
        {picked && !why.isFetching ? (
          <>
            <p>
              {bucketLabel(picked.key, grain)}
            </p>
            {FLOW_KINDS.map((kind) => {
              const list = hits.filter((event) => event.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="er-flow-why-block">
                  <strong>
                    {t(`elDash.flow.${kind}`)} · {list.length}
                  </strong>
                  {kind === "decommissioned" ? (
                    <ul>
                      {reasons.map(([reason, elements]) => (
                        <li key={reason}>
                          <span>{reason === "—" ? t("elDash.report.reasonUnknown") : reason}</span>
                          <em>{elements.join("، ")}</em>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{list.map((event) => event.element_nr).filter(Boolean).join("، ")}</p>
                  )}
                </div>
              );
            })}
          </>
        ) : null}
      </div>
      </div>
    </section>
  );
}

function Report({ data, compact, cls, head }: { data: ElementDashOverview; compact: boolean; cls: string; head: (updated?: string) => React.ReactNode }) {
  const { t } = useI18n();
  const { counts, parts } = data;
  const kinds = ["anode", "cathode", "membrane"] as const;
  const stages = STAGE_FLOW.filter((stage) => stage !== "awaiting_assembly");

  return (
    <section className={cls}>
      {head(t("elDash.updatedAt", { time: formatDateTime(data.generated_at) }))}

      <div className="er-pipeline" role="list">
        {stages.map((stage: ElementStage) => (
          <Link
            key={stage}
            role="listitem"
            href={stage === "in_service" || stage === "installed" ? href("installed") : href("shop", { stage })}
            className={`er-stage ed-tone-${STAGE_TONE[stage]}`}
          >
            <span className="er-stage-value">{formatNumber(counts[stage], 0)}</span>
            <span className="er-stage-label">{t(`elDash.stage.${stage}`)}</span>
          </Link>
        ))}
      </div>

      {data.board ? <ManagementBoard board={data.board} /> : null}

      <MonthFlow compact={compact} />
      <InServiceBreakdown />

      {data.board ? <PalletBoard pallets={data.board.pallets} /> : null}

      <div className="er-two">
        <AssemblyStockSummary board={data.board} />
        {data.workshop ? <ShopSheet sheet={data.workshop} compact={compact} /> : null}
      </div>

      {!compact ? (
        <div className="er-parts">
          {kinds.map((k) => {
            const s = parts[k].summary;
            return (
              <Link key={k} href={href("parts", { kind: k, where: "installed", life: "all" })} className="er-part">
                <span className="er-part-name">{t(`elDash.installedTitle.${k}`)}</span>
                <span className="er-part-value">{formatNumber(s.installed, 0)}</span>
                <span className="er-part-sub">
                  {t("elDash.report.partLine", { warn: s.installed_warning, expired: s.installed_expired, due: s.due_90 })}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function CollapseBtn({ open, onToggle, locale }: { open: boolean; onToggle: () => void; locale: string }) {
  const label = open ? (locale === "fa" ? "کوچک کردن" : "Minimize") : locale === "fa" ? "باز کردن" : "Expand";
  return (
    <button type="button" className="er-collapse-btn" onClick={onToggle} title={label} aria-label={label} aria-expanded={open}>
      {open ? "▾" : "▸"} <span>{label}</span>
    </button>
  );
}
