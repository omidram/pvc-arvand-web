"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Ban, ClipboardList, Hammer, Inbox, MessageSquare, Paperclip, Power, Send, Truck, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { PositionCombo } from "@/components/ui/position-combo";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { relationsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { todayIsoLocal } from "@/lib/date-range";
import type { PipelineItem } from "@/lib/types";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { CARTABLE_MS, cellPath, workflowApi, workflowHref, type CellRequest, type CellRequestDetail, type WfGroup } from "@/lib/workflow";
import { StageBadge } from "./element-dashboard-ui";
import { DeadlineBadge, RequestEditForm } from "./warehouse-workflow";

type ApiErr = Error & { response?: { data?: { detail?: string } } };
type T = (k: string, vars?: Record<string, string | number | null | undefined>) => string;

const errText = (err: unknown) => (err as ApiErr)?.response?.data?.detail || (err as Error)?.message || "";

function statusColor(status: string): "emerald" | "slate" | "amber" | "cyan" | "violet" {
  if (status === "completed") return "emerald";
  if (status === "cancelled") return "slate";
  if (status === "in_shop") return "violet";
  if (status === "await_shop") return "cyan";
  return "amber";
}

function useMeta() {
  return useQuery({ queryKey: ["wf", "meta"], queryFn: workflowApi.meta, staleTime: 60_000 });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["wf"] });
  void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
  void qc.invalidateQueries({ queryKey: ["elements"] });
}

function CellStepper({ status, kind, decision, t }: { status: string; kind?: string; decision?: string | null; t: T }) {
  const steps = cellPath(kind === "numbering" ? "await_numbering" : status, decision);
  const at = steps.indexOf(status);
  return (
    <ol className="wf-stepper">
      {status === "cancelled" ? <li className="wf-step is-cancelled">{t("wf.status.cancelled")}</li> : null}
      {steps.map((s, i) => (
        <li key={s} className={`wf-step${i < at || status === "completed" ? " is-done" : ""}${i === at && status !== "completed" ? " is-current" : ""}`}>
          <span className="wf-step-dot">{i + 1}</span>
          <span className="wf-step-label">{t(`wf.status.${s}`)}</span>
          {s !== "completed" ? <span className="wf-step-group">{t(`wf.stageGroup.cell.${s}`)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function StatusBadge({ r, t }: { r: Pick<CellRequest, "status" | "urgent">; t: T }) {
  return (
    <span className="wf-status-cell">
      <Badge color={statusColor(r.status)}>{t(`wf.status.${r.status}`)}</Badge>
      {r.urgent && r.status !== "completed" && r.status !== "cancelled" ? <Badge color="rose">{t("cellReq.urgent")}</Badge> : null}
    </span>
  );
}

// ------------------------------------------------------------------ new request

/** Operation (or an Assembly Data editor) sends one element to the cell shop; the shop is notified at once. */
export function CellRequestForm({ elementNr, onSent }: { elementNr: string; onSent?: (r: CellRequestDetail) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [planned, setPlanned] = useState(todayIsoLocal());
  const [alreadyOff, setAlreadyOff] = useState(false);
  const [offDate, setOffDate] = useState(todayIsoLocal());
  const reasons = useQuery({ queryKey: ["relations", "decommission-reasons"], queryFn: () => relationsApi.lookup("decommission-reasons"), staleTime: 300_000 });
  const send = useMutation({
    mutationFn: () =>
      workflowApi.cellCreate({
        element_nr: elementNr,
        reason: reason.trim(),
        urgent,
        problem: problem.trim() || null,
        planned_date: alreadyOff ? null : planned || null,
        decommission_date: alreadyOff ? offDate : null,
      }),
    onSuccess: (res) => {
      invalidateAll(qc);
      onSent?.(res);
    },
  });
  const listId = `cell-reasons-${elementNr}`;
  return (
    <div className="cr-form">
      <p className="mon-sub">{t("cellReq.newHint")}</p>
      <div className="cr-grid">
        <label className="ed-filters">
          <span className="text-xs font-bold">{t("cellReq.reason")} *</span>
          <input list={listId} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("cellReq.reasonHint")} maxLength={200} />
          <datalist id={listId}>
            {(reasons.data ?? []).slice(0, 80).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label className="ed-filters cr-check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          <span className="text-xs font-bold">{t("cellReq.urgent")}</span>
        </label>
        <label className="ed-filters cr-wide">
          <span className="text-xs font-bold">{t("cellReq.problem")}</span>
          <textarea rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder={t("cellReq.problemHint")} />
        </label>
        <label className="ed-filters cr-check">
          <input type="checkbox" checked={alreadyOff} onChange={(e) => setAlreadyOff(e.target.checked)} />
          <span className="text-xs font-bold">{t("cellReq.alreadyOff")}</span>
        </label>
        {alreadyOff ? (
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("cellReq.shutdownDate")}</span>
            <DateInput value={offDate} onChange={(e) => setOffDate(e.target.value)} />
          </label>
        ) : (
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("cellReq.planned")}</span>
            <DateInput value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </label>
        )}
      </div>
      <div className="ew-action-btns">
        <button type="button" className="wf-btn is-primary" disabled={!reason.trim() || send.isPending || (alreadyOff && !offDate)} onClick={() => send.mutate()}>
          <Send size={14} /> {t("cellReq.send")}
        </button>
      </div>
      {send.isError ? <p className="asm-note is-danger">{errText(send.error)}</p> : null}
    </div>
  );
}

/** In the "Where is element" card: the open request of this element, or the button to raise one. */
export function ElementCellRequest({ item }: { item: PipelineItem }) {
  const { t } = useI18n();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const canSee = meta.data?.can_view_cell ?? false;
  const list = useQuery({
    queryKey: ["wf", "cell", "element", item.key],
    queryFn: () => workflowApi.cellList({ element_nr: item.element_nr, open_only: true }),
    enabled: canSee,
  });
  if (!canSee) return null;
  const current = (list.data ?? []).find((row) => row.request_kind !== "numbering");
  if (current) {
    return (
      <div className={cn("cr-box", current.urgent && "is-urgent")}>
        <Truck className="h-4 w-4 shrink-0" />
        <span>
          {t("cellReq.open", { code: current.code, status: t(`wf.status.${current.status}`) })}
          {current.groups.length ? ` — ${t("wf.col.waitingFor")}: ${current.groups.map((g) => t(`wf.group.${g}`)).join(" / ")}` : ""}
        </span>
        <Link className="wf-btn wf-btn-sm" href={workflowHref("cell", current.id)}>
          {t("cellReq.openBtn")}
        </Link>
      </div>
    );
  }
  const removable = item.base_state === "in_service" || item.base_state === "installed" || (item.base_state === "decommissioned" && item.state === "decommissioned");
  if (!removable || !meta.data?.can_request_cell) return sent ? <p className="asm-note is-ok">{sent}</p> : null;
  return (
    <div className="cr-new">
      <button type="button" className="wf-btn" onClick={() => setOpen((v) => !v)}>
        <Truck size={14} /> {t("cellReq.newBtn")}
      </button>
      {open ? (
        <CellRequestForm
          elementNr={item.element_nr}
          onSent={(r) => {
            setOpen(false);
            setSent(t("cellReq.sent", { code: r.code }));
          }}
        />
      ) : null}
      {sent ? <p className="asm-note is-ok">{sent}</p> : null}
    </div>
  );
}

/** Cell Arrangement: the same removal request, plus a C-90 check when element numbers do not match positions. */
export function ArrangementOperatorPanel({
  electrolyzer,
  position,
  elementNr,
}: {
  electrolyzer: string;
  position: number;
  elementNr: string | null;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = useMeta();
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [removalSent, setRemovalSent] = useState<string | null>(null);
  const canAsk = meta.data?.can_request_cell ?? false;
  const canSee = meta.data?.can_view_cell ?? false;
  const pos = String(position);
  const list = useQuery({
    queryKey: ["wf", "cell", "arrangement", electrolyzer, pos, elementNr],
    queryFn: () => workflowApi.cellList({ open_only: true, element_nr: elementNr || undefined }),
    enabled: canSee && Boolean(elementNr),
  });
  const removal = (list.data ?? []).find((row) => row.request_kind !== "numbering" && elementNr && row.element_nr === elementNr);
  const numbering = useQuery({
    queryKey: ["wf", "cell", "numbering-open"],
    queryFn: () => workflowApi.cellList({ open_only: true }),
    enabled: canSee,
    select: (rows) => rows.find((row) => row.request_kind === "numbering" && row.electrolyzer === electrolyzer && String(row.position ?? "") === pos),
  });
  const send = useMutation({
    mutationFn: () => workflowApi.cellNumbering({ electrolyzer, position: pos, element_nr: elementNr, note: note.trim() || null }),
    onSuccess: (res) => {
      setSent(t("arrangement.numberingSent", { code: res.code }));
      setNote("");
      invalidateAll(qc);
    },
  });
  const openNumbering = numbering.data;

  return (
    <section className="arr-requests">
      <h3>{t("arrangement.operatorTitle")}</h3>
      <p className="mon-sub">
        {t("arrangement.operatorCell", { cell: `${electrolyzer}-${pos}`, element: elementNr || "—" })}
      </p>
      {!canAsk ? <p className="asm-note">{t("arrangement.needRight")}</p> : null}

      <div className="arr-request-grid">
        <div>
          <strong>{t("cellReq.newTitle")}</strong>
          {!elementNr ? <p className="asm-note">{t("arrangement.noElement")}</p> : null}
          {removal ? (
            <div className={cn("cr-box", removal.urgent && "is-urgent")}>
              <Truck className="h-4 w-4 shrink-0" />
              <span>{t("cellReq.open", { code: removal.code, status: t(`wf.status.${removal.status}`) })}</span>
              <Link className="wf-btn wf-btn-sm" href={workflowHref("cell", removal.id)}>
                {t("cellReq.openBtn")}
              </Link>
            </div>
          ) : elementNr && canAsk ? (
            <>
              <CellRequestForm
                elementNr={elementNr}
                onSent={(r) => {
                  setRemovalSent(t("cellReq.sent", { code: r.code }));
                  void list.refetch();
                }}
              />
              {removalSent ? <p className="asm-note is-ok">{removalSent}</p> : null}
            </>
          ) : null}
        </div>

        <div>
          <strong>{t("arrangement.numberingTitle")}</strong>
          <p className="mon-sub">{t("arrangement.numberingHint")}</p>
          {openNumbering ? (
            <div className="cr-box">
              <ClipboardList className="h-4 w-4 shrink-0" />
              <span>{t("cellReq.open", { code: openNumbering.code, status: t(`wf.status.${openNumbering.status}`) })}</span>
              <Link className="wf-btn wf-btn-sm" href={workflowHref("cell", openNumbering.id)}>
                {t("cellReq.openBtn")}
              </Link>
            </div>
          ) : canAsk ? (
            <>
              <label className="ed-filters cr-wide">
                <span className="text-xs font-bold">{t("arrangement.numberingNote")}</span>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("arrangement.numberingNoteHint")} />
              </label>
              <div className="ew-action-btns">
                <button type="button" className="wf-btn is-primary" disabled={send.isPending} onClick={() => send.mutate()}>
                  <ClipboardList size={14} /> {t("arrangement.numberingSend")}
                </button>
              </div>
              {sent ? <p className="asm-note is-ok">{sent}</p> : null}
              {send.isError ? <p className="asm-note is-danger">{errText(send.error)}</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ list (element dashboard tab)

export function CellRequestsTab({ initialId }: { initialId?: number }) {
  const { t } = useI18n();
  const meta = useMeta();
  const [openOnly, setOpenOnly] = useState(true);
  const [mine, setMine] = useState(false);
  const [opened, setOpened] = useState<number | null>(initialId ?? null);
  const list = useQuery({ queryKey: ["wf", "cell", "list", openOnly], queryFn: () => workflowApi.cellList({ open_only: openOnly }), refetchInterval: CARTABLE_MS });
  const groups = meta.data?.groups ?? [];
  const rows = (list.data ?? []).filter((r) => !mine || r.groups.some((g) => groups.includes(g)));

  const columns: Column<CellRequest>[] = [
    { key: "code", header: t("cellReq.col.code"), render: (r) => <strong className="wf-code">{r.code}</strong> },
    { key: "element_nr", header: t("cellReq.col.element"), render: (r) => <strong>{r.element_nr}</strong> },
    { key: "cell", header: t("cellReq.col.cell"), render: (r) => (r.electrolyzer ? `${r.electrolyzer}-${r.position ?? ""}` : "—"), filterText: (r) => `${r.electrolyzer ?? ""}-${r.position ?? ""}` },
    { key: "reason", header: t("cellReq.col.reason"), render: (r) => r.reason },
    { key: "status", header: t("cellReq.col.status"), render: (r) => <StatusBadge r={r} t={t} />, filterText: (r) => t(`wf.status.${r.status}`) },
    { key: "sla_state", header: t("wf.col.deadline"), render: (r) => <DeadlineBadge row={r} t={t} /> },
    {
      key: "groups",
      header: t("cellReq.col.waiting"),
      render: (r) => (r.groups.length ? r.groups.map((g) => t(`wf.group.${g}`)).join(" / ") : "—"),
      filterText: (r) => r.groups.map((g) => t(`wf.group.${g}`)).join(" "),
    },
    { key: "decommission_date", header: t("cellReq.col.off"), render: (r) => formatDate(r.decommission_date) },
    { key: "received_date", header: t("cellReq.col.received"), render: (r) => formatDate(r.received_date) },
    { key: "decision", header: t("cellReq.col.decision"), render: (r) => (r.decision ? t(`cellReq.decision.${r.decision}`) : "—") },
    { key: "created_by", header: t("cellReq.col.by"), render: (r) => r.created_by || "—" },
    { key: "updated_at", header: t("cellReq.col.updated"), render: (r) => formatDateTime(r.updated_at) },
  ];

  return (
    <div className="wh-panel-block">
      <div className="wf-head">
        <h3>
          <Inbox size={16} /> {t("cellReq.title")}
        </h3>
        <span className="wf-groups">
          {groups.filter((g) => g === "operation" || g === "cellshop").map((g) => (
            <Badge key={g} color="cyan">
              {t(`wf.group.${g}`)}
            </Badge>
          ))}
        </span>
      </div>
      <p className="wh-subdesc">{t("cellReq.hint")}</p>
      <div className="cr-toolbar">
        <label className="cr-check">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> {t("cellReq.openOnly")}
        </label>
        {groups.length ? (
          <label className="cr-check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("cellReq.mine")}
          </label>
        ) : null}
      </div>
      {list.isError ? <ErrorState message={errText(list.error)} /> : null}
      <DataTable
        columns={columns}
        data={rows}
        keyField="id"
        isLoading={list.isLoading}
        onRowClick={(r) => setOpened(r.id)}
        emptyTitle={t("cellReq.none")}
        maxHeight="min(60vh, 640px)"
      />
      <CellRequestModal id={opened} onClose={() => setOpened(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ detail + steps

export function CellRequestModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ["wf", "cell", "detail", id],
    queryFn: async () => {
      const d = await workflowApi.cellGet(id!);
      void workflowApi.markRead({ flow: "cell", record_id: id! }).catch(() => undefined);
      return d;
    },
    enabled: id != null,
  });
  const d = detail.data;
  return (
    <Modal open={id != null} onClose={onClose} title={d ? `${t("wf.flow.cell")} — ${d.code} · ${d.title}` : t("cellReq.title")} wide>
      {detail.isLoading ? <LoadingState /> : null}
      {detail.isError ? <ErrorState message={errText(detail.error)} /> : null}
      {d ? <CellDetailBody d={d} t={t} /> : null}
    </Modal>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function CellDetailBody({ d, t }: { d: CellRequestDetail; t: T }) {
  return (
    <div className="wf-detail">
      <CellStepper status={d.status} kind={d.request_kind} decision={d.decision} t={t} />
      <div className="wh-facts wf-facts">
        <Fact label={t("cellReq.col.status")}>
          <StatusBadge r={d} t={t} />
        </Fact>
        <Fact label={t("cellReq.col.element")}>
          {d.element_nr} {d.electrolyzer ? `· ${d.electrolyzer}-${d.position ?? ""}` : ""}
        </Fact>
        <Fact label={d.request_kind === "numbering" ? t("cellReq.col.reason") : t("fields.decommissionReason")}>{d.request_kind === "numbering" ? t("cellReq.numberingReason") : d.reason}</Fact>
        <Fact label={t("cellReq.facts.requested")}>
          {d.created_by || "—"} · {formatDateTime(d.created_at)}
        </Fact>
        {d.planned_date ? <Fact label={t("cellReq.facts.planned")}>{formatDate(d.planned_date)}</Fact> : null}
        <Fact label={t("cellReq.facts.off")}>{formatDate(d.decommission_date)}</Fact>
        <Fact label={t("cellReq.facts.received")}>{formatDate(d.received_date)}</Fact>
        {d.decision ? <Fact label={t("cellReq.facts.decision")}>{t(`cellReq.decision.${d.decision}`)}</Fact> : null}
        {d.element ? (
          <Fact label={t("cellReq.facts.element")}>
            <StageBadge stage={d.element.state} />
          </Fact>
        ) : null}
        {d.problem ? <Fact label={t("cellReq.problem")}>{d.problem}</Fact> : null}
      </div>

      <CellActions key={`${d.id}-${d.status}`} d={d} t={t} />

      {d.files.length ? (
        <section className="wf-section">
          <h4>{t("wf.files")}</h4>
          <ul className="wf-files">
            {d.files.map((f) => (
              <li key={f.id}>
                <button type="button" className="wf-link" onClick={() => void workflowApi.downloadFile(f)}>
                  <Paperclip size={13} /> {f.name}
                </button>
                <span className="wh-muted">
                  {f.uploaded_by} · {formatDateTime(f.uploaded_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="wf-section">
        <h4>{t("wf.log")}</h4>
        <ul className="wh-timeline">
          {d.events.map((e) => (
            <li key={e.id} className={e.action === "comment" ? "cr-msg" : undefined}>
              <span className="wh-tl-date">{formatDateTime(e.created_at)}</span>
              <span className="wh-tl-title">
                <strong>{t(`wf.event.${e.action}`)}</strong> — {e.actor}
                {e.to_status && e.to_status !== e.from_status ? ` → ${t(`wf.status.${e.to_status}`)}` : ""}
                {typeof e.data?.choice === "string" ? ` · ${t(`cellReq.decision.${e.data.choice === "relocate" ? "relocated" : e.data.choice}`)}` : ""}
                {typeof e.data?.cell === "string" ? ` (${e.data.cell})` : ""}
                {e.note ? <em className="wf-note"> «{e.note}»</em> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CellActions({ d, t }: { d: CellRequestDetail; t: T }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const acts = d.actions;
  const [note, setNote] = useState("");
  const [day, setDay] = useState(todayIsoLocal());
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [electrolyzer, setElectrolyzer] = useState("");
  const [position, setPosition] = useState("");
  const [relocating, setRelocating] = useState(false);

  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) => workflowApi.cellStep(d.id, action, body),
    onSuccess: (next) => {
      qc.setQueryData(["wf", "cell", "detail", d.id], next);
      invalidateAll(qc);
      setNote("");
      setMessage("");
    },
  });
  const attach = useMutation({
    mutationFn: () => workflowApi.attach("cell", d.id, files, note || undefined),
    onSuccess: () => {
      setFiles([]);
      void qc.invalidateQueries({ queryKey: ["wf", "cell", "detail", d.id] });
    },
  });
  const go = (action: string, body: Record<string, unknown> = {}) => run.mutate({ action, body: { note: note.trim() || undefined, ...body } });

  const stepActs = acts.filter((a) => a === "shutdown" || a === "receive" || a === "decide" || a === "review" || a === "dismantle" || a === "install");
  const error = run.error || attach.error;

  return (
    <>
      {acts.includes("edit") || stepActs.length ? (
        <section className="wf-actions">
          <h4>{t("wf.yourStep")}</h4>
          {acts.includes("edit") ? <RequestEditForm d={d} t={t} /> : null}
          {acts.includes("shutdown") || acts.includes("receive") ? (
            <div className="wh-form-inline wf-inline-plain">
              <label>
                {acts.includes("shutdown") ? t("cellReq.shutdownDate") : t("cellReq.receiveDate")}
                <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
              {acts.includes("shutdown") ? (
                <button type="button" className="wf-btn is-primary" disabled={!day || run.isPending} onClick={() => go("shutdown", { date: day })}>
                  <Power size={14} /> {t("cellReq.shutdownBtn")}
                </button>
              ) : (
                <button type="button" className="wf-btn is-primary" disabled={!day || run.isPending} onClick={() => go("receive", { date: day })}>
                  <Truck size={14} /> {t("cellReq.receiveBtn")}
                </button>
              )}
            </div>
          ) : null}
          {acts.includes("decide") ? (
            <div className="cr-decide">
              <strong>{t("cellReq.decideTitle")}</strong>
              <div className="ew-action-btns">
                <button type="button" className="wf-btn" disabled={run.isPending} onClick={() => go("decide", { choice: "keep" })}>
                  <Warehouse size={14} /> {t("cellReq.keep")}
                </button>
                <button type="button" className="wf-btn is-bad" disabled={run.isPending} onClick={() => go("decide", { choice: "disassemble" })}>
                  <Hammer size={14} /> {t("cellReq.disassemble")}
                </button>
                <button type="button" className={cn("wf-btn", relocating && "is-active")} onClick={() => setRelocating((v) => !v)}>
                  <ArrowRightLeft size={14} /> {t("cellReq.relocate")}
                </button>
              </div>
              {relocating ? (
                <div className="wh-form-inline wf-inline-plain">
                  <label>
                    {t("elDash.col.electrolyzer")}
                    <ElectrolyzerCombo value={electrolyzer} onChange={setElectrolyzer} required />
                  </label>
                  <label>
                    {t("elDash.cartable.position")}
                    <PositionCombo electrolyzer={electrolyzer} value={position} onChange={setPosition} excludeId={d.element_id} required />
                  </label>
                  <label>
                    {t("elDash.cartable.date")}
                    <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
                  </label>
                  <button
                    type="button"
                    className="wf-btn is-primary"
                    disabled={!electrolyzer || !position || run.isPending}
                    onClick={() => go("decide", { choice: "relocate", electrolyzer, position, date: day || null })}
                  >
                    <ArrowRightLeft size={14} /> {t("cellReq.relocateBtn")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {acts.includes("dismantle") ? (
            <div className="cr-decide">
              <strong>{t("cellReq.dismantleTitle")}</strong>
              <p className="mon-sub">{t("cellReq.dismantleHint")}</p>
              <div className="wh-form-inline wf-inline-plain">
                <label>
                  {t("elDash.cartable.disassemblyDate")}
                  <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
                </label>
                <button type="button" className="wf-btn is-primary" disabled={!day || run.isPending} onClick={() => go("dismantle", { date: day })}>
                  <Hammer size={14} /> {t("cellReq.dismantleBtn")}
                </button>
              </div>
            </div>
          ) : null}
          {acts.includes("install") ? (
            <div className="cr-decide">
              <strong>{t("cellReq.returnTitle")}</strong>
              <p className="mon-sub">{t("cellReq.returnHint")}</p>
              <div className="wh-form-inline wf-inline-plain">
                <label>
                  {t("elDash.col.electrolyzer")}
                  <ElectrolyzerCombo value={electrolyzer} onChange={setElectrolyzer} required />
                </label>
                <label>
                  {t("elDash.cartable.position")}
                  <PositionCombo electrolyzer={electrolyzer} value={position} onChange={setPosition} excludeId={d.element_id} required />
                </label>
                <label>
                  {t("elDash.cartable.date")}
                  <DateInput value={day} onChange={(e) => setDay(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="wf-btn is-primary"
                  disabled={!electrolyzer || !position || run.isPending}
                  onClick={() => go("install", { electrolyzer, position, date: day || null })}
                >
                  <ArrowRightLeft size={14} /> {t("cellReq.returnBtn")}
                </button>
              </div>
            </div>
          ) : null}
          {acts.includes("review") ? (
            <div className="cr-decide">
              <strong>{t("cellReq.reviewTitle")}</strong>
              <p className="mon-sub">{t("cellReq.reviewHint")}</p>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("cellReq.reviewHint")} />
              <button type="button" className="wf-btn is-primary" disabled={!note.trim() || run.isPending} onClick={() => go("review", { note: note.trim() })}>
                <ClipboardList size={14} /> {t("cellReq.reviewBtn")}
              </button>
            </div>
          ) : null}
          <label className="ed-filters">
            <span className="text-xs font-bold">{(isAdmin || acts.includes("edit")) && acts.includes("cancel") ? t("wf.cancelReason") : t("elDash.note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={(isAdmin || acts.includes("edit")) && acts.includes("cancel") ? t("wf.cancelReason") : t("elDash.noteHint")} />
          </label>
        </section>
      ) : d.status !== "completed" && d.status !== "cancelled" ? (
        <div className="wf-wait">{t("cellReq.noRight", { group: d.groups.map((g: WfGroup) => t(`wf.group.${g}`)).join(" / ") })}</div>
      ) : null}

      {acts.includes("comment") ? (
        <section className="wf-section cr-talk">
          <h4>
            <MessageSquare size={14} /> {t("cellReq.message")}
          </h4>
          <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("cellReq.messageHint")} />
          <div className="ew-action-btns">
            <button type="button" className="wf-btn is-primary" disabled={!message.trim() || run.isPending} onClick={() => run.mutate({ action: "comment", body: { note: message.trim() } })}>
              <Send size={14} /> {t("cellReq.sendMessage")}
            </button>
            {acts.includes("attach") ? (
              <>
                <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                <button type="button" className="wf-btn" disabled={!files.length || attach.isPending} onClick={() => attach.mutate()}>
                  <Paperclip size={14} /> {t("wf.action.attach")}
                </button>
              </>
            ) : null}
            {acts.includes("cancel") ? (
              <button
                type="button"
                className="wf-btn is-bad"
                disabled={run.isPending || ((isAdmin || acts.includes("edit")) && !note.trim())}
                title={(isAdmin || acts.includes("edit")) ? t("wf.cancelReason") : undefined}
                onClick={() => {
                  if ((isAdmin || acts.includes("edit")) && !note.trim()) return;
                  if (window.confirm(t("wf.confirmDelete"))) go("cancel");
                }}
              >
                <Ban size={14} /> {t("wf.action.delete")}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {error ? <p className="asm-note is-danger">{errText(error)}</p> : null}
    </>
  );
}
