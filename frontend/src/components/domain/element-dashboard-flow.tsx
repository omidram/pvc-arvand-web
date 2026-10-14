"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, GitBranch } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { FlowIssue, FlowItem, FlowNode, PipelineItem } from "@/lib/types";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { ExportButton } from "./element-dashboard-ui";
import type { OpenTarget } from "./element-dashboard-overview";

const ELECTRODE_NODES: FlowNode[] = [
  "reusable_good",
  "reusable_medium",
  "reusable_open",
  "rate_off",
  "coating_warranty",
  "coating_no_warranty",
  "mechanical_warranty",
  "mechanical_no_warranty",
  "undecided",
];

const ISSUES: FlowIssue[] = [
  "decommission_no_reason",
  "disassembled_no_decision",
  "warranty_no_vendor",
  "rate_off_installed",
  "problem_installed",
  "warehouse_ok_but_not_reusable",
  "warehouse_bad_but_reusable",
];

type PickId = FlowNode | `issue:${FlowIssue}` | "healthy_kept" | "decommissioned" | "awaiting_disassembly" | "awaiting_assembly" | "in_service" | "ready";

function Box({
  label,
  count,
  hint,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  hint?: string;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = cn("ew-box", `ed-tone-${tone}`, active && "is-picked", !count && "is-zero");
  const body = (
    <>
      <span className="ew-box-n">{formatNumber(count, 0)}</span>
      <span className="ew-box-label">{label}</span>
      {hint ? <span className="ew-box-hint">{hint}</span> : null}
    </>
  );
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  );
}

function serialHref(row: FlowItem) {
  const serial = encodeURIComponent(row.serial);
  if (row.kind === "cathode") return `/cathodes?cathode_nr=${serial}`;
  return `/anodes?anode_nr=${serial}`;
}

export function ElementFlowTab({ onOpen }: { onOpen: (t: OpenTarget) => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<PickId | null>(null);
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["element-dashboard", "flow"], queryFn: elementDashboardApi.flow, staleTime: 30_000 });
  const listNode = picked && (ELECTRODE_NODES.includes(picked as FlowNode) || String(picked).startsWith("issue:")) ? picked : null;
  const list = useQuery({
    queryKey: ["element-dashboard", "flow", "list", listNode, search],
    queryFn: () => elementDashboardApi.flowList({ node: listNode!, q: search.trim() || undefined, limit: 500 }),
    enabled: Boolean(listNode),
  });
  const shopState = picked === "healthy_kept" ? "ready" : picked && !listNode ? String(picked) : null;
  const shop = useQuery({
    queryKey: ["element-dashboard", "shop", shopState, ""],
    queryFn: () => elementDashboardApi.shop({ state: shopState!, limit: 400 }),
    enabled: Boolean(shopState),
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;

  const d = query.data;
  const el = d.elements;
  const n = d.electrodes;
  const issueTotal = ISSUES.reduce((s, k) => s + (d.issues[k] || 0), 0);

  function pick(id: PickId) {
    setPicked((cur) => (cur === id ? null : id));
    setSearch("");
  }

  const shopItems: PipelineItem[] = (shop.data?.items ?? []).filter((i) => (picked === "healthy_kept" ? i.base_state === "decommissioned" : true));

  return (
    <div className="mon-page">
      <p className="mon-help">{t("elFlow.help", { days: d.recent_days })}</p>

      <section className="mon-panel">
        <div className="mon-panel-head">
          <h3 className="mon-panel-title">
            <GitBranch className="me-1 inline h-4 w-4" />
            {t("elFlow.title")}
          </h3>
        </div>
        <div className="ew-chart">
          <div className="ew-row">
            <Box label={t("elDash.stage.in_service")} count={el.in_service} tone="green" hint={t("elFlow.hint.in_service")} active={picked === "in_service"} onClick={() => pick("in_service")} />
          </div>
          <ArrowDown className="ew-v-arrow" aria-hidden />
          <p className="ew-caption">{t("elFlow.decommissionDate")}</p>
          <div className="ew-row">
            <Box
              label={t("elDash.stage.decommissioned")}
              count={el.decommissioned}
              tone="red"
              hint={t("elFlow.hint.decommissioned")}
              active={picked === "decommissioned"}
              onClick={() => pick("decommissioned")}
            />
          </div>
          <ArrowDown className="ew-v-arrow" aria-hidden />
          <div className="ew-branches">
            <div className="ew-col">
              <h4>{t("elFlow.healthy")}</h4>
              <Box
                label={t("elFlow.healthyKept")}
                count={el.healthy_kept}
                tone="teal"
                hint={t("elFlow.hint.healthyKept")}
                active={picked === "healthy_kept"}
                onClick={() => pick("healthy_kept")}
              />
              <p className="ew-caption">{t("elFlow.assignPosition")}</p>
              <p className="mon-sub">{t("elFlow.healthyThen")}</p>
            </div>
            <div className="ew-col">
              <h4>{t("elFlow.disassemble")}</h4>
              <Box
                label={t("elDash.stage.awaiting_disassembly")}
                count={el.awaiting_disassembly}
                tone="amber"
                active={picked === "awaiting_disassembly"}
                onClick={() => pick("awaiting_disassembly")}
              />
              <ArrowDown className="ew-v-arrow" aria-hidden />
              <Box
                label={t("elDash.stage.awaiting_assembly")}
                count={el.awaiting_assembly}
                tone="violet"
                hint={t("elFlow.hint.assembly")}
                active={picked === "awaiting_assembly"}
                onClick={() => pick("awaiting_assembly")}
              />
              <p className="ew-caption">{t("elFlow.decision")}</p>
              <div className="ew-row">
                <Box label={t("elFlow.node.reusable_good")} count={n.reusable_good.total} hint={t("elFlow.split", n.reusable_good)} tone="green" active={picked === "reusable_good"} onClick={() => pick("reusable_good")} />
                <Box label={t("elFlow.node.reusable_medium")} count={n.reusable_medium.total} hint={t("elFlow.split", n.reusable_medium)} tone="teal" active={picked === "reusable_medium"} onClick={() => pick("reusable_medium")} />
                <Box label={t("elFlow.node.reusable_open")} count={n.reusable_open.total} hint={t("elFlow.split", n.reusable_open)} tone="blue" active={picked === "reusable_open"} onClick={() => pick("reusable_open")} />
              </div>
              <p className="ew-caption">{t("elFlow.notReusable")}</p>
              <div className="ew-row">
                <Box label={t("elFlow.node.rate_off")} count={n.rate_off.total} hint={t("elFlow.split", n.rate_off)} tone="slate" active={picked === "rate_off"} onClick={() => pick("rate_off")} />
              </div>
              <div className="ew-split">
                <div>
                  <p className="ew-caption">{t("elFlow.coating")}</p>
                  <Box label={t("elFlow.node.coating_warranty")} count={n.coating_warranty.total} hint={t("elFlow.split", n.coating_warranty)} tone="amber" active={picked === "coating_warranty"} onClick={() => pick("coating_warranty")} />
                  <Box label={t("elFlow.node.coating_no_warranty")} count={n.coating_no_warranty.total} hint={t("elFlow.split", n.coating_no_warranty)} tone="red" active={picked === "coating_no_warranty"} onClick={() => pick("coating_no_warranty")} />
                </div>
                <ArrowRight className="ew-h-arrow" aria-hidden />
                <div>
                  <p className="ew-caption">{t("elFlow.mechanical")}</p>
                  <Box label={t("elFlow.node.mechanical_warranty")} count={n.mechanical_warranty.total} hint={t("elFlow.split", n.mechanical_warranty)} tone="violet" active={picked === "mechanical_warranty"} onClick={() => pick("mechanical_warranty")} />
                  <Box label={t("elFlow.node.mechanical_no_warranty")} count={n.mechanical_no_warranty.total} hint={t("elFlow.split", n.mechanical_no_warranty)} tone="red" active={picked === "mechanical_no_warranty"} onClick={() => pick("mechanical_no_warranty")} />
                </div>
              </div>
              <Box label={t("elFlow.node.undecided")} count={n.undecided.total} hint={t("elFlow.split", n.undecided)} tone="amber" active={picked === "undecided"} onClick={() => pick("undecided")} />
              {d.vendors.length ? (
                <div className="ew-vendors">
                  <span className="ew-caption">{t("elFlow.vendors")}</span>
                  {d.vendors.map((v) => (
                    <span key={v.vendor} className="ew-vendor">
                      {v.vendor} ({formatNumber(v.count, 0)})
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mon-sub">
                {t("elFlow.atCoater", { n: d.at_coater })}{" "}
                <button type="button" className="asm-link" onClick={() => onOpen({ tab: "coating" })}>
                  {t("elDash.tab.coating")}
                </button>
                {" · "}
                <a className="asm-link" href="/storage">
                  {t("elFlow.warehouse")}
                </a>
                {" · "}
                <a className="asm-link" href="/segregation">
                  {t("nav.segregation")}
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mon-panel">
        <div className="mon-panel-head">
          <h3 className="mon-panel-title">{t("elFlow.checks", { n: issueTotal })}</h3>
        </div>
        <p className="mon-sub">{t("elFlow.checksHelp")}</p>
        <div className="ew-issues">
          {ISSUES.map((key) => {
            const count = d.issues[key] || 0;
            return (
              <button
                key={key}
                type="button"
                className={cn("ew-issue", count ? "has" : "is-ok", picked === `issue:${key}` && "is-picked")}
                onClick={() => pick(`issue:${key}`)}
              >
                <strong>{formatNumber(count, 0)}</strong>
                <span>{t(`elFlow.issue.${key}`)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {picked ? (
        <section className="mon-panel">
          <div className="mon-panel-head">
            <h3 className="mon-panel-title">
              {listNode
                ? listNode.startsWith("issue:")
                  ? t(`elFlow.issue.${listNode.slice(6)}`)
                  : t(`elFlow.node.${listNode}`)
                : picked === "healthy_kept"
                  ? t("elFlow.healthyKept")
                  : t(`elDash.stage.${picked}`)}
            </h3>
            {list.data?.total != null ? <span className="ed-mute">{t("elDash.matched", { count: list.data.total })}</span> : null}
            {listNode ? (
              <input className="ew-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("elDash.search")} />
            ) : (
              <button type="button" className="asm-link" onClick={() => onOpen({ tab: picked === "in_service" ? "installed" : "shop", stage: picked === "healthy_kept" ? "ready" : picked })}>
                {t("elDash.openList")}
              </button>
            )}
            {list.data?.items.length ? (
              <ExportButton
                filename={`element-flow-${picked}`}
                header={[t("elDash.col.piece"), t("elDash.kind.anode"), t("fields.elementNr"), t("elFlow.destination"), t("elFlow.vendor"), t("fields.date")]}
                rows={() =>
                  list.data!.items.map((r) => [r.serial, r.kind, r.element_nr, r.destination, r.vendor, r.date])
                }
              />
            ) : null}
          </div>
          {listNode ? (
            list.isLoading ? (
              <LoadingState />
            ) : !list.data?.items.length ? (
              <p className="mon-sub">{t("elFlow.empty")}</p>
            ) : (
              <div className="ed-table-wrap">
                <table className="ed-table">
                  <thead>
                    <tr>
                      <th>{t("elDash.col.piece")}</th>
                      <th>{t("elDash.col.type")}</th>
                      <th>{t("fields.elementNr")}</th>
                      <th>{t("elFlow.path")}</th>
                      <th>{t("elFlow.vendor")}</th>
                      <th>{t("fields.date")}</th>
                      <th>{t("segregation.decision")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map((r) => (
                      <tr key={`${r.kind}-${r.key}-${r.date ?? ""}`}>
                        <td>
                          <a className="asm-link" href={`/segregation?serial_nr=${encodeURIComponent(r.serial)}`}>
                            {r.serial}
                          </a>{" "}
                          <a className="ed-mute" href={serialHref(r)}>
                            ↗
                          </a>
                        </td>
                        <td>{t(`elDash.kind.${r.kind}`)}</td>
                        <td>
                          {r.element_nr ? (
                            <a className="asm-link" href={`/elements/assembly?element_nr=${encodeURIComponent(r.element_nr)}`}>
                              {r.element_nr}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {r.steps.map((s) => t(`elFlow.step.${s}`)).join(" → ")}
                          {r.installed ? <span className="ed-badge ed-tone-red"> {t("elDash.installed")}</span> : null}
                        </td>
                        <td>{r.vendor || r.detail || "—"}</td>
                        <td>{formatDate(r.date)}</td>
                        <td>{r.decision || r.segregation || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {list.data.truncated ? <p className="mon-sub">{t("elDash.truncated", { count: list.data.items.length })}</p> : null}
              </div>
            )
          ) : shop.isLoading ? (
            <LoadingState />
          ) : !shopItems.length ? (
            <p className="mon-sub">{t("elFlow.empty")}</p>
          ) : (
            <div className="asm-chips">
              {shopItems.map((item) => (
                <button key={item.key} type="button" className="asm-chip" onClick={() => onOpen({ tab: "shop", stage: item.state })}>
                  {item.element_nr}
                  {item.electrolyzer ? <small>{`${item.electrolyzer}-${item.position ?? ""}`}</small> : null}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
