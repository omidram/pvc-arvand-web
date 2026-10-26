"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, ClipboardCheck, Clock, Download, FileSpreadsheet, FileText, Inbox, Paperclip, Plus, RotateCcw, Search, Send, Upload, X } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import type { WhCompany } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";
import { defaultDateRange } from "@/lib/date-range";
import {
  CARTABLE_MS,
  ASSEMBLE_STEPS,
  CELL_STEPS,
  COATING_STEPS,
  DELAY_PARTIES,
  INSPECTION_STEPS,
  LIVE_MS,
  PURCHASE_STEPS,
  inspectionFormHref,
  parseSerialLines,
  refreshWarehouseData,
  workflowApi,
  type WfDeadline,
  type WfCompanyStats,
  type WfDetail,
  type WfFlow,
  type WfGroup,
  type WfHistoryRow,
  type WfSummary,
  type WfCoatingCandidate,
} from "@/lib/workflow";
import { CoatingSerialPicker } from "@/components/domain/coating-serial-picker";

type T = (k: string, vars?: Record<string, string | number | null | undefined>) => string;

type SpecField = { name: string; label: string; type?: "date" | "textarea" };

const ANODE_SPEC_FIELDS: SpecField[] = [
  { name: "assembly_group", label: "fields.assemblyGroup" },
  { name: "component_nr", label: "fields.componentNr" },
  { name: "customer_drawing_nr", label: "fields.customerDrawingNr" },
  { name: "manufacturer", label: "fields.manufacturer" },
  { name: "manufacturer_order_nr", label: "fields.manufacturerOrderNr" },
  { name: "manufacturer_drawing_nr", label: "fields.manufacturerDrawingNr" },
  { name: "manufacturer_date", label: "fields.manufacturerDate", type: "date" },
  { name: "tank", label: "fields.tank" },
  { name: "contact_strip", label: "fields.contactStrip" },
  { name: "electrode_support", label: "fields.electrodeSupport" },
  { name: "electrode_shape", label: "fields.electrodeShape" },
  { name: "coating", label: "fields.coating" },
  { name: "baffle_plate", label: "fields.bafflePlate" },
  { name: "downcomer", label: "fields.downcomer" },
  { name: "inlet_system", label: "fields.inletSystem" },
  { name: "standpipe_diameter", label: "fields.standpipeDiameter" },
  { name: "flange_width", label: "fields.flangeWidth" },
  { name: "received_date", label: "fields.receivedDate", type: "date" },
  { name: "batch", label: "fields.batch" },
  { name: "generation", label: "fields.generation" },
  { name: "remarks", label: "fields.remarks", type: "textarea" },
];

const CATHODE_SPEC_FIELDS: SpecField[] = ANODE_SPEC_FIELDS.filter((f) => f.name !== "baffle_plate" && f.name !== "downcomer");

function pickSpec(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
}

function SpecGrid({
  fields,
  values,
  onChange,
  t,
}: {
  fields: SpecField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  t: T;
}) {
  return (
    <div className="wh-form-grid wf-spec-grid">
      {fields.map((f) => (
        <label key={f.name} className={f.type === "textarea" ? "wf-spec-span" : undefined}>
          {t(f.label)}
          {f.type === "date" ? (
            <DateInput type="date" value={values[f.name] || ""} onChange={(e) => onChange(f.name, e.target.value)} />
          ) : f.type === "textarea" ? (
            <textarea rows={2} value={values[f.name] || ""} onChange={(e) => onChange(f.name, e.target.value)} />
          ) : (
            <input value={values[f.name] || ""} onChange={(e) => onChange(f.name, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

function PieceSpecCard({
  kind,
  serial,
  fields,
  values,
  onChange,
  t,
}: {
  kind: "anode" | "cathode";
  serial: string;
  fields: SpecField[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  t: T;
}) {
  return (
    <div className="wf-spec-card">
      <h4>{t(kind === "anode" ? "wf.purchase.anodePiece" : "wf.purchase.cathodePiece", { nr: serial })}</h4>
      <p className="wf-spec-nr">
        {t(kind === "anode" ? "fields.anodeNr" : "fields.cathodeNr")}: <strong>{serial}</strong>
      </p>
      <SpecGrid fields={fields} values={values} onChange={onChange} t={t} />
    </div>
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from.slice(0, 10));
  const b = Date.parse(to.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function statusColor(status: string): "emerald" | "rose" | "amber" | "cyan" | "violet" | "slate" {
  if (status === "completed") return "emerald";
  if (status === "cancelled") return "slate";
  if (status === "await_approval" || status === "await_inspection" || status === "await_registration" || status === "await_insp_sign" || status === "await_proc_sign") return "violet";
  if (status === "await_return" || status === "at_coater" || status === "ordered") return "cyan";
  return "amber";
}

export function useWorkflowMeta() {
  return useQuery({ queryKey: ["wf", "meta"], queryFn: workflowApi.meta, staleTime: 60_000 });
}

function DelayBadge({ days, t }: { days: number | null | undefined; t: T }) {
  if (days == null) return <>—</>;
  if (days > 0) return <Badge color="rose">{t("wf.lateDays", { n: days })}</Badge>;
  if (days < 0) return <Badge color="emerald">{t("wf.earlyDays", { n: -days })}</Badge>;
  return <Badge color="emerald">{t("wf.onTime")}</Badge>;
}

function spanText(minutes: number, t: T): string {
  const m = Math.abs(minutes);
  if (m >= 48 * 60) return t("wf.sla.days", { n: Math.floor(m / 1440) });
  if (m >= 60) return t("wf.sla.hours", { n: Math.floor(m / 60) });
  return t("wf.sla.minutes", { n: m });
}

/** Green while on time, amber when the warning share of the window is left, red once the deadline passed. */
export function DeadlineBadge({ row, t }: { row: WfDeadline; t: T }) {
  if (!row.sla_state || row.sla_left_minutes == null) return <>—</>;
  const late = row.sla_state === "late";
  const color = late ? "rose" : row.sla_state === "warn" ? "amber" : "emerald";
  const text = late ? t("wf.sla.late", { d: spanText(row.sla_left_minutes, t) }) : t("wf.sla.left", { d: spanText(row.sla_left_minutes, t) });
  return (
    <span title={row.due_at ? t("wf.sla.dueAt", { d: formatDateTime(row.due_at), h: row.sla_hours ?? "" }) : undefined}>
      <Badge color={color}>
        <Clock size={11} /> {text}
      </Badge>
    </span>
  );
}

function StatusBadge({ row, t }: { row: Pick<WfSummary, "status" | "rejected">; t: T }) {
  return (
    <span className="wf-status-cell">
      <Badge color={statusColor(row.status)}>{t(`wf.status.${row.status}`)}</Badge>
      {row.rejected ? <Badge color="rose">{t("wf.rejectedFlag")}</Badge> : null}
    </span>
  );
}

export function Stepper({ flow, status, t }: { flow: WfFlow; status: string; t: T }) {
  const steps: readonly string[] =
    flow === "coating"
      ? COATING_STEPS
      : flow === "cell"
        ? CELL_STEPS
        : flow === "inspection"
          ? INSPECTION_STEPS
          : flow === "assemble"
            ? ASSEMBLE_STEPS
            : PURCHASE_STEPS;
  const shown = status === "at_coater" || status === "await_report" ? "await_return" : status === "ordered" ? "await_order" : status;
  const at = steps.indexOf(shown);
  return (
    <ol className="wf-stepper">
      {status === "cancelled" ? <li className="wf-step is-cancelled">{t("wf.status.cancelled")}</li> : null}
      {steps.map((s, i) => (
        <li key={s} className={`wf-step${i < at || status === "completed" ? " is-done" : ""}${i === at && status !== "completed" ? " is-current" : ""}`}>
          <span className="wf-step-dot">{i + 1}</span>
          <span className="wf-step-label">{t(`wf.status.${s}`)}</span>
          {s !== "completed" ? <span className="wf-step-group">{t(`wf.stageGroup.${flow}.${s}`)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function summaryColumns(t: T, withFlow: boolean): Column<WfSummary>[] {
  const cols: Column<WfSummary>[] = [
    { key: "title", header: t("wf.col.code"), render: (r) => <strong className="wf-code">{r.title}</strong> },
    { key: "status", header: t("wf.col.status"), render: (r) => <StatusBadge row={r} t={t} />, filterText: (r) => t(`wf.status.${r.status}`) },
    {
      key: "sla_state",
      header: t("wf.col.deadline"),
      render: (r) => <DeadlineBadge row={r} t={t} />,
      filterText: (r) => (r.sla_state ? t(`wf.sla.state.${r.sla_state}`) : ""),
    },
    {
      key: "groups",
      header: t("wf.col.waitingFor"),
      render: (r) => (r.groups.length ? r.groups.map((g) => t(`wf.group.${g}`)).join(" / ") : "—"),
      filterText: (r) => r.groups.map((g) => t(`wf.group.${g}`)).join(" "),
    },
    {
      key: "pieces",
      header: t("wf.col.pieces"),
      render: (r) =>
        r.flow === "cell"
          ? r.reason || "—"
          : r.flow === "inspection" || r.flow === "assemble"
            ? [r.element_nr && t("wf.insp.elementShort", { n: r.element_nr }), r.anode_nr, r.cathode_nr].filter(Boolean).join(" · ") || "—"
            : r.flow === "workorder"
              ? [r.element_nr, r.anode_nr, r.cathode_nr].filter(Boolean).join(" · ") || "—"
              : t("wf.piecesShort", { a: r.anode_count, k: r.cathode_count }),
    },
    { key: "company_name", header: t("wf.col.company"), render: (r) => r.company_name || "—" },
    { key: "indent_no", header: t("wf.col.indent"), render: (r) => r.indent_no || "—" },
    { key: "expected_date", header: t("wf.col.expected"), render: (r) => formatDate(r.expected_date) },
    { key: "delay_days", header: t("wf.col.delay"), render: (r) => <DelayBadge days={r.delay_days} t={t} /> },
    { key: "updated_at", header: t("wf.col.updated"), render: (r) => formatDateTime(r.updated_at) },
  ];
  if (withFlow) cols.unshift({ key: "flow", header: t("wf.col.flow"), render: (r) => t(`wf.flow.${r.flow}`), filterText: (r) => t(`wf.flow.${r.flow}`) });
  return cols;
}

export function matchesCartableQuery(row: WfSummary, query: string, t: T): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const pieces = [row.element_nr, row.anode_nr, row.cathode_nr, row.reason, row.problem, String(row.anode_count ?? ""), String(row.cathode_count ?? "")]
    .filter(Boolean)
    .join(" ");
  const blob = [
    row.title,
    row.code,
    ...(row.codes || []),
    t(`wf.flow.${row.flow}`),
    t(`wf.status.${row.status}`),
    row.groups.map((g) => t(`wf.group.${g}`)).join(" "),
    pieces,
    row.company_name,
    row.indent_no,
    row.last_note,
    row.created_by,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(needle);
}

export function RequestEditForm({
  d,
  t,
}: {
  d: {
    flow: WfFlow;
    id: number;
    remarks?: string | null;
    reason?: string | null;
    problem?: string | null;
    indent_no?: string | null;
    approval_ref?: string | null;
    expected_date?: string | null;
    planned_date?: string | null;
  };
  t: T;
}) {
  const qc = useQueryClient();
  const [remarks, setRemarks] = useState(d.remarks || "");
  const [reason, setReason] = useState(d.reason || "");
  const [problem, setProblem] = useState(d.problem || "");
  const [indent, setIndent] = useState(d.indent_no || "");
  const [approval, setApproval] = useState(d.approval_ref || "");
  const [expected, setExpected] = useState((d.expected_date || d.planned_date || "").slice(0, 10));
  useEffect(() => {
    setRemarks(d.remarks || "");
    setReason(d.reason || "");
    setProblem(d.problem || "");
    setIndent(d.indent_no || "");
    setApproval(d.approval_ref || "");
    setExpected((d.expected_date || d.planned_date || "").slice(0, 10));
  }, [d.id, d.flow, d.remarks, d.reason, d.problem, d.indent_no, d.approval_ref, d.expected_date, d.planned_date]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (d.flow === "coating" || d.flow === "purchase" || d.flow === "assemble") body.remarks = remarks;
      if (d.flow === "cell" || d.flow === "inspection") body.reason = reason;
      if (d.flow === "cell") body.problem = problem;
      if (d.flow === "coating" || d.flow === "purchase") body.indent_no = indent;
      if (d.flow === "purchase") body.approval_ref = approval;
      if (d.flow !== "inspection" && d.flow !== "assemble") body.expected_date = expected || null;
      return workflowApi.update(d.flow, d.id, body);
    },
    onSuccess: (next) => {
      qc.setQueryData(["wf", "detail", next.flow, next.id], next);
      refreshWarehouseData(qc);
    },
  });
  return (
    <div className="wf-edit">
      <h4>{t("wf.editTitle")}</h4>
      {d.flow === "cell" || d.flow === "inspection" ? (
        <label>
          {d.flow === "cell" || d.flow === "inspection" ? t("fields.decommissionReason") : t("wf.editReason")}
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      ) : (
        <label>
          {t("fields.remarks")}
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      )}
      {d.flow === "cell" ? (
        <label>
          {t("wf.editProblem")}
          <input value={problem} onChange={(e) => setProblem(e.target.value)} />
        </label>
      ) : null}
      {d.flow === "coating" || d.flow === "purchase" ? (
        <label>
          {t("wf.col.indent")}
          <input value={indent} onChange={(e) => setIndent(e.target.value)} />
        </label>
      ) : null}
      {d.flow === "purchase" ? (
        <label>
          {t("wf.editApproval")}
          <input value={approval} onChange={(e) => setApproval(e.target.value)} />
        </label>
      ) : null}
      {d.flow !== "inspection" && d.flow !== "assemble" ? (
        <label>
          {t("wf.col.expected")}
          <DateInput type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </label>
      ) : null}
      <button type="button" className="wf-btn is-primary" disabled={save.isPending} onClick={() => save.mutate()}>
        <Check size={14} /> {t("wf.editSave")}
      </button>
      {save.isSuccess ? <span className="wf-info">{t("wf.editSaved")}</span> : null}
      {save.error ? <span className="wf-alert">{(save.error as Error).message}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------ cartable

export function WorkflowCartablePanel({ onOpen }: { onOpen: (flow: WfFlow, id: number) => void }) {
  const { t } = useI18n();
  const meta = useWorkflowMeta();
  const cartable = useQuery({ queryKey: ["wf", "cartable"], queryFn: workflowApi.cartable, refetchInterval: CARTABLE_MS });
  const late = (cartable.data ?? []).filter((r) => r.sla_state === "late").length;
  const groups = meta.data?.groups ?? [];
  const [q, setQ] = useState("");
  const rows = (cartable.data ?? []).filter((r) => matchesCartableQuery(r, q, t));
  return (
    <div className="wh-panel-block">
      <div className="wf-head">
        <h3>
          <Inbox size={16} /> {t("wf.cartableTitle")}
        </h3>
        <span className="wf-groups">
          {groups.length ? groups.map((g) => <Badge key={g} color="cyan">{t(`wf.group.${g}`)}</Badge>) : <span className="wh-muted">{t("wf.noGroup")}</span>}
        </span>
      </div>
      <p className="wh-subdesc">{t("wf.cartableHint")}</p>
      {late ? <div className="wf-alert">{t("wf.sla.lateCount", { n: late })}</div> : null}
      <label className="rcd-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("wf.searchPlaceholder")} />
      </label>
      {cartable.isError ? <ErrorState message={(cartable.error as Error).message} /> : null}
      <DataTable
        columns={summaryColumns(t, true)}
        data={rows.map((r) => ({ ...r, _key: `${r.flow}:${r.id}` }))}
        keyField="_key"
        isLoading={cartable.isLoading}
        onRowClick={(r) => onOpen(r.flow, r.id)}
        emptyTitle={t("wf.cartableEmpty")}
        maxHeight="min(56vh, 620px)"
      />
    </div>
  );
}

// ------------------------------------------------------------------ recoating

export function CoatingWorkflowPanel({ onOpen }: { onOpen: (flow: WfFlow, id: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = useWorkflowMeta();
  const canRequest = (meta.data?.groups ?? []).includes("c90");
  const [openOnly, setOpenOnly] = useState(true);
  const [pieceQ, setPieceQ] = useState("");
  const list = useQuery({
    queryKey: ["wf", "list", "coating", openOnly, pieceQ],
    queryFn: () => workflowApi.list("coating", { open_only: openOnly, q: pieceQ.trim() || undefined }),
    refetchInterval: LIVE_MS,
  });
  const candidates = useQuery({
    queryKey: ["wf", "coating-candidates"],
    queryFn: workflowApi.coatingCandidates,
    enabled: canRequest,
    staleTime: 30_000,
  });
  const anodeOptions = useMemo(() => (candidates.data ?? []).filter((c) => c.kind === "anode"), [candidates.data]);
  const cathodeOptions = useMemo(() => (candidates.data ?? []).filter((c) => c.kind === "cathode"), [candidates.data]);
  const [aPicked, setAPicked] = useState<WfCoatingCandidate[]>([]);
  const [kPicked, setKPicked] = useState<WfCoatingCandidate[]>([]);
  const [palletSize, setPalletSize] = useState(20);
  const [separate, setSeparate] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const aLines = useMemo(() => aPicked.map((c) => ({ serial: c.serial, problem: c.problem })), [aPicked]);
  const kLines = useMemo(() => kPicked.map((c) => ({ serial: c.serial, problem: c.problem })), [kPicked]);
  const pallets = separate
    ? Math.ceil(aLines.length / palletSize) + Math.ceil(kLines.length / palletSize)
    : Math.ceil((aLines.length + kLines.length) / palletSize);
  const create = useMutation({
    mutationFn: () =>
      workflowApi.createCoating({
        anodes: aLines,
        cathodes: kLines,
        pallet_size: palletSize,
        separate_kinds: separate,
        remarks: remarks || undefined,
      }),
    onSuccess: (d) => {
      setAPicked([]);
      setKPicked([]);
      setRemarks("");
      setUnknown([]);
      refreshWarehouseData(qc);
      onOpen("coating", d.id);
    },
    onError: (err: Error) => {
      try {
        const detail = JSON.parse(err.message) as { code?: string; serials?: string[] };
        if (detail.code === "unknown_serials") setUnknown(detail.serials ?? []);
      } catch {
        /* plain message shown below */
      }
    },
  });
  const createError = create.error && !unknown.length ? create.error.message : null;

  return (
    <div className="wh-panel-block">
      <Stepper flow="coating" status="c90_select" t={t} />
      {canRequest ? (
        <form
          className="wh-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>{t("wf.coating.newTitle")}</h3>
          <p className="wh-subdesc">{t("wf.coating.newHint")}</p>
          <div className="wf-two">
            <CoatingSerialPicker
              label={t("wf.coating.anodes", { n: aPicked.length })}
              candidates={anodeOptions}
              picked={aPicked}
              onChange={setAPicked}
              loading={candidates.isLoading}
              t={t}
            />
            <CoatingSerialPicker
              label={t("wf.coating.cathodes", { n: kPicked.length })}
              candidates={cathodeOptions}
              picked={kPicked}
              onChange={setKPicked}
              loading={candidates.isLoading}
              t={t}
            />
          </div>
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {t("wf.coating.palletSize")}
              <input
                type="number"
                min={1}
                max={20}
                value={palletSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setPalletSize(Math.min(20, Math.max(1, Number.isFinite(n) ? n : 20)));
                }}
              />
            </label>
            <label className="wh-check">
              <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
              {t("wf.coating.separate")}
            </label>
            <label className="wh-grow">
              {t("fields.remarks")}
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
          </div>
          <div className="wf-preview">{t("wf.coating.preview", { n: aLines.length + kLines.length, p: pallets || 0 })}</div>
          {unknown.length ? (
            <div className="wf-alert">
              <strong>{t("wf.coating.unknownTitle")}</strong> {unknown.join("، ")}
            </div>
          ) : null}
          {createError ? <div className="wf-alert">{createError}</div> : null}
          <div>
            <button type="submit" className="wf-btn is-primary" disabled={create.isPending || !(aLines.length + kLines.length)}>
              <Plus size={14} /> {t("wf.coating.generate")}
            </button>
          </div>
        </form>
      ) : (
        <p className="wh-subdesc">{t("wf.coating.onlyC90")}</p>
      )}
      <div className="wf-head">
        <h3>{t("wf.coating.listTitle")}</h3>
        <label className="wh-check wf-small">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          {t("wf.openOnly")}
        </label>
      </div>
      <div className="wh-form-inline wf-inline-plain" style={{ marginBottom: "0.5rem" }}>
        <label className="wh-grow">
          {t("wf.coating.searchPiece")}
          <input
            value={pieceQ}
            onChange={(e) => setPieceQ(e.target.value)}
            placeholder={t("wf.coating.searchPieceHint")}
          />
        </label>
      </div>
      <DataTable
        columns={summaryColumns(t, false)}
        data={list.data}
        keyField="id"
        isLoading={list.isLoading}
        onRowClick={(r) => onOpen("coating", r.id)}
        emptyTitle={t("wh.empty")}
        maxHeight="min(48vh, 540px)"
      />
    </div>
  );
}

// ------------------------------------------------------------------ purchase

export function PurchaseWorkflowPanel({ companies, onOpen }: { companies: WhCompany[]; onOpen: (flow: WfFlow, id: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = useWorkflowMeta();
  const canCreate = (meta.data?.groups ?? []).includes("procurement");
  const suppliers = companies.filter((c) => c.is_supplier);
  const [openOnly, setOpenOnly] = useState(true);
  const list = useQuery({ queryKey: ["wf", "list", "purchase", openOnly], queryFn: () => workflowApi.list("purchase", { open_only: openOnly }), refetchInterval: LIVE_MS });
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [anodeCount, setAnodeCount] = useState(0);
  const [cathodeCount, setCathodeCount] = useState(0);
  const [approvalRef, setApprovalRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const create = useMutation({
    mutationFn: async () => {
      const d = await workflowApi.createPurchase({
        supplier_id: Number(supplierId),
        anode_count: anodeCount,
        cathode_count: cathodeCount,
        approval_ref: approvalRef || undefined,
        remarks: remarks || undefined,
      });
      if (files.length) await workflowApi.attach("purchase", d.id, files);
      return d;
    },
    onSuccess: (d) => {
      setAnodeCount(0);
      setCathodeCount(0);
      setApprovalRef("");
      setRemarks("");
      setFiles([]);
      refreshWarehouseData(qc);
      onOpen("purchase", d.id);
    },
  });
  return (
    <div className="wh-panel-block">
      <Stepper flow="purchase" status="purchase_request" t={t} />
      {canCreate ? (
        <form
          className="wh-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>{t("wf.purchase.newTitle")}</h3>
          <p className="wh-subdesc">{t("wf.purchase.newHint")}</p>
          <div className="wh-form-inline wf-inline-plain">
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
              {suppliers.length === 0 ? <small className="wf-muted">{t("wf.noCompanies")}</small> : null}
            </label>
            <label>
              {t("wf.purchase.anodeCount")}
              <input type="number" min={0} value={anodeCount} onChange={(e) => setAnodeCount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label>
              {t("wf.purchase.cathodeCount")}
              <input type="number" min={0} value={cathodeCount} onChange={(e) => setCathodeCount(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label>
              {t("wf.purchase.approvalRef")}
              <input value={approvalRef} onChange={(e) => setApprovalRef(e.target.value)} />
            </label>
          </div>
          <div className="wh-form-inline wf-inline-plain">
            <label className="wh-grow">
              {t("fields.remarks")}
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </label>
            <label>
              {t("wf.attachments")}
              <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </label>
          </div>
          {create.error ? <div className="wf-alert">{create.error.message}</div> : null}
          <div>
            <button type="submit" className="wf-btn is-primary" disabled={create.isPending || !supplierId || anodeCount + cathodeCount <= 0 || files.length === 0}>
              <Plus size={14} /> {t("wf.purchase.create")}
            </button>
          </div>
        </form>
      ) : (
        <p className="wh-subdesc">{t("wf.purchase.onlyProcurement")}</p>
      )}
      <div className="wf-head">
        <h3>{t("wf.purchase.listTitle")}</h3>
        <label className="wh-check wf-small">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          {t("wf.openOnly")}
        </label>
      </div>
      <DataTable
        columns={summaryColumns(t, false)}
        data={list.data}
        keyField="id"
        isLoading={list.isLoading}
        onRowClick={(r) => onOpen("purchase", r.id)}
        emptyTitle={t("wh.empty")}
        maxHeight="min(48vh, 540px)"
      />
    </div>
  );
}

// ------------------------------------------------------------------ detail window + step forms

export function WorkflowDetailModal({
  target,
  companies,
  onClose,
}: {
  target: { flow: WfFlow; id: number } | null;
  companies: WhCompany[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ["wf", "detail", target?.flow, target?.id],
    queryFn: async () => {
      const d = await workflowApi.get(target!.flow, target!.id);
      void workflowApi.markRead({ flow: target!.flow, record_id: target!.id }).catch(() => undefined);
      return d;
    },
    enabled: !!target,
    refetchInterval: LIVE_MS,
  });
  const d = detail.data;
  return (
    <Modal open={!!target} onClose={onClose} title={d ? `${t(`wf.flow.${d.flow}`)} — ${d.title}` : t("wf.title")} wide>
      {detail.isLoading ? <LoadingState /> : null}
      {detail.isError ? <ErrorState message={(detail.error as Error).message} /> : null}
      {d ? <DetailBody d={d} companies={companies} t={t} /> : null}
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

function InspectionCell({ item, t }: { item: NonNullable<WfDetail["packages"]>[number]["items"][number]; t: T }) {
  const form = item.inspection;
  if (form) {
    return (
      <span className="wf-insp-cell">
        <Link className="wf-link" href={`/inspections?id=${form.id}`} target="_blank">
          <ClipboardCheck size={13} /> {formatDate(form.date) || `#${form.id}`}
        </Link>
        <button type="button" className="wf-link" title="PDF" onClick={() => void workflowApi.downloadInspectionPdf(form)}>
          <FileText size={13} />
        </button>
      </span>
    );
  }
  if (item.inspection_request) {
    return <Badge color="amber">{t("wf.insp.asked", { code: item.inspection_request.code })}</Badge>;
  }
  return (
    <Link className="wf-link is-bad" href={inspectionFormHref(item.element_kind === "anode" ? { anode_nr: item.serial } : { cathode_nr: item.serial })} target="_blank">
      {t("wf.insp.missing")}
    </Link>
  );
}

function DetailBody({ d, companies, t }: { d: WfDetail; companies: WhCompany[]; t: T }) {
  const coating = d.flow === "coating";
  const reports = d.files.filter((f) => f.kind === "report");
  const attachments = d.files.filter((f) => f.kind === "attachment");
  return (
    <div className="wf-detail">
      <Stepper flow={d.flow} status={d.status} t={t} />
      {d.rejected ? <div className="wf-alert">{t("wf.rejectedNote", { note: d.last_note || "" })}</div> : null}
      <div className="wh-facts wf-facts">
        <Fact label={t("wf.col.status")}>
          <StatusBadge row={d} t={t} />
        </Fact>
        {d.sla_state ? (
          <Fact label={t("wf.col.deadline")}>
            <DeadlineBadge row={d} t={t} />
          </Fact>
        ) : null}
        {coating && d.inspections_total ? (
          <Fact label={t("wf.insp.formsTitle")}>
            <Badge color={d.inspections_done === d.inspections_total ? "emerald" : "rose"}>
              <ClipboardCheck size={11} /> {t("wf.insp.formsCount", { done: d.inspections_done ?? 0, total: d.inspections_total })}
            </Badge>
          </Fact>
        ) : null}
        <Fact label={t("wf.col.pieces")}>{t("wf.piecesShort", { a: d.anode_count, k: d.cathode_count })}</Fact>
        <Fact label={t("wf.col.company")}>{d.company_name || "—"}</Fact>
        <Fact label={t("wf.col.indent")}>{d.indent_no || "—"}</Fact>
        {d.approval_ref ? <Fact label={t("wf.purchase.approvalRef")}>{d.approval_ref}</Fact> : null}
        <Fact label={coating ? t("wf.col.sent") : t("wf.col.requestDate")}>{formatDate(d.dispatch_date)}</Fact>
        <Fact label={t("wf.col.expected")}>{formatDate(d.expected_date)}</Fact>
        <Fact label={coating ? t("wf.col.returned") : t("wf.col.delivered")}>{formatDate(d.actual_date)}</Fact>
        <Fact label={t("wf.col.delay")}>
          <DelayBadge days={d.delay_days} t={t} />
        </Fact>
        {d.warranty_start ? (
          <Fact label={t("wf.coating.warrantyStart")}>
            {formatDate(d.warranty_start)}
            {d.warranty_months != null ? ` · ${d.warranty_months}` : ""}
          </Fact>
        ) : null}
        {d.delay_party ? <Fact label={t("wf.delayParty")}>{t(`wf.party.${d.delay_party}`)}</Fact> : null}
        {d.delay_reason ? <Fact label={t("wf.delayReason")}>{d.delay_reason}</Fact> : null}
        {coating && d.rework_count ? <Fact label={t("wf.reworks")}>{d.rework_count}</Fact> : null}
        <Fact label={t("wf.col.createdBy")}>
          {d.created_by || "—"} · {formatDateTime(d.created_at)}
        </Fact>
        {d.remarks ? <Fact label={t("fields.remarks")}>{d.remarks}</Fact> : null}
      </div>

      <StepActions key={`${d.flow}-${d.id}-${d.status}`} d={d} companies={companies} t={t} />

      {coating && d.packages ? (
        <section className="wf-section">
          <div className="wf-head">
            <h4>{t("wf.coating.pallets", { n: d.packages.length })}</h4>
            <button type="button" className="wf-btn" onClick={() => void workflowApi.downloadExcel(d.id, `recoating-${d.id}`)}>
              <FileSpreadsheet size={14} /> {t("wf.coating.excelAll")}
            </button>
            <button type="button" className="wf-btn" onClick={() => void workflowApi.downloadDispatchPack(d.id, `recoating-${d.id}`)}>
              <Download size={14} /> {t("wf.coating.dispatchPack")}
            </button>
          </div>
          {d.packages.map((p) => (
            <details key={p.id} className="wf-pallet" open={d.packages!.length === 1}>
              <summary>
                <strong className="wf-code">{p.code}</strong>
                <span>{t("wf.coating.palletLine", { no: p.pallet_no, n: p.items.length })}</span>
                {p.has_report ? <Badge color="emerald">{t("wf.coating.hasReport")}</Badge> : null}
                <button
                  type="button"
                  className="wf-btn wf-btn-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    void workflowApi.downloadExcel(d.id, p.code, p.id);
                  }}
                >
                  <Download size={12} /> Excel
                </button>
              </summary>
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("wh.col.kind")}</th>
                    <th>{t("wh.col.serial")}</th>
                    <th>{t("wf.col.problem")}</th>
                    <th>{t("wf.col.preInspection")}</th>
                    <th>{t("wf.col.finalReport")}</th>
                    <th>{t("wf.col.remark")}</th>
                    <th>{t("wf.insp.formCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.items.map((i) => (
                    <tr key={i.id} className={i.inspection ? undefined : "wf-row-missing"}>
                      <td>{i.line_no}</td>
                      <td>{t(`wf.kind.${i.element_kind}`)}</td>
                      <td className="wf-code">{i.serial}</td>
                      <td>{i.problem || ""}</td>
                      <td>{i.pre_inspection || ""}</td>
                      <td>{i.final_report || ""}</td>
                      <td>{i.remark || ""}</td>
                      <td>
                        <InspectionCell item={i} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      ) : null}

      {!coating && d.items && d.items.length ? (
        <section className="wf-section">
          <h4>{t("wf.purchase.registered", { n: d.items.length, total: d.anode_count + d.cathode_count })}</h4>
          <table className="wf-table">
            <thead>
              <tr>
                <th>{t("wh.col.kind")}</th>
                <th>{t("wh.col.serial")}</th>
                <th>{t("wf.col.coating")}</th>
                <th>{t("wf.col.manufacturer")}</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <td>{t(`wf.kind.${i.element_kind}`)}</td>
                  <td className="wf-code">{i.serial}</td>
                  <td>{i.coating || ""}</td>
                  <td>{i.manufacturer || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {reports.length || attachments.length ? (
        <section className="wf-section">
          <h4>{t("wf.files")}</h4>
          <ul className="wf-files">
            {[...reports, ...attachments].map((f) => (
              <li key={f.id}>
                <button type="button" className="wf-link" onClick={() => void workflowApi.downloadFile(f)}>
                  {f.kind === "report" ? <FileSpreadsheet size={13} /> : <Paperclip size={13} />} {f.name}
                </button>
                <span className="wh-muted">
                  {f.kind === "report" ? t("wf.reportFile") : t("wf.attachmentFile")}
                  {f.package_id && d.packages ? ` · ${d.packages.find((p) => p.id === f.package_id)?.code ?? ""}` : ""} · {f.uploaded_by} · {formatDateTime(f.uploaded_at)}
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
            <li key={e.id}>
              <span className="wh-tl-date">{formatDateTime(e.created_at)}</span>
              <span className="wh-tl-title">
                <strong>{t(`wf.event.${e.action}`)}</strong> — {e.actor}
                {e.to_status && e.to_status !== e.from_status ? ` → ${t(`wf.status.${e.to_status}`)}` : ""}
                {e.note ? <em className="wf-note"> «{e.note}»</em> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StepActions({ d, companies, t }: { d: WfDetail; companies: WhCompany[]; t: T }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const acts = d.actions;
  const [note, setNote] = useState("");
  const [companyId, setCompanyId] = useState<number | "">(d.company_id ?? "");
  const [emailed, setEmailed] = useState(false);
  const [plans, setPlans] = useState<Record<number, { send: string; back: string }>>(() =>
    Object.fromEntries((d.packages ?? []).map((p) => [p.id, { send: p.dispatch_date?.slice(0, 10) || todayIso(), back: p.expected_return_date?.slice(0, 10) || "" }]))
  );
  const [indent, setIndent] = useState("");
  const [date1, setDate1] = useState(todayIso());
  const [date2, setDate2] = useState("");
  const [plansDelivery, setPlansDelivery] = useState(todayIso());
  const [party, setParty] = useState("");
  const [reason, setReason] = useState("");
  const [warrantyMonths, setWarrantyMonths] = useState(d.warranty_months != null ? String(d.warranty_months) : "");
  const [warrantyStart, setWarrantyStart] = useState(d.warranty_start?.slice(0, 10) || todayIso());
  const [files, setFiles] = useState<File[]>([]);
  const [packageId, setPackageId] = useState<number | "">("");
  const [regAnodes, setRegAnodes] = useState("");
  const [regCathodes, setRegCathodes] = useState("");
  const [anodeSpecs, setAnodeSpecs] = useState<Record<string, Record<string, string>>>({});
  const [cathodeSpecs, setCathodeSpecs] = useState<Record<string, Record<string, string>>>({});
  const [info, setInfo] = useState<string | null>(null);

  const done = (next: WfDetail) => {
    qc.setQueryData(["wf", "detail", next.flow, next.id], next);
    refreshWarehouseData(qc);
    setNote("");
    setFiles([]);
  };
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) => workflowApi.step(d.flow, d.id, action, body),
    onSuccess: (next) => {
      setInfo(null);
      done(next);
    },
  });
  const upload = useMutation({
    mutationFn: () => workflowApi.uploadReport(d.id, files, packageId ? Number(packageId) : null, note || undefined),
    onSuccess: (res) => {
      setInfo(t("wf.coating.rowsFilled", { n: res.rows_filled }));
      done(res.detail);
    },
  });
  const attach = useMutation({
    mutationFn: () => workflowApi.attach(d.flow, d.id, files, note || undefined),
    onSuccess: () => {
      setFiles([]);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["wf", "detail", d.flow, d.id] });
    },
  });

  const askForms = useMutation({
    mutationFn: () => workflowApi.coatingRequestInspections(d.id, note || undefined),
    onSuccess: (res) => {
      setInfo(t("wf.insp.askedCount", { n: res.created }));
      done(res.detail);
    },
  });

  const main = acts.filter((a) => a !== "attach" && a !== "cancel" && a !== "request_inspections");
  const formsMissing = (d.inspections_total ?? 0) - (d.inspections_done ?? 0);
  if (!acts.length) {
    if (d.status === "completed" || d.status === "cancelled") return null;
    return <div className="wf-wait">{t("wf.waitingFor", { group: d.groups.map((g: WfGroup) => t(`wf.group.${g}`)).join(" / ") })}</div>;
  }
  const delay = daysBetween(d.expected_date, date1);
  const late = delay != null && delay > 0;
  const error = (run.error || upload.error || attach.error || askForms.error) as Error | null;
  const go = (action: string, body: Record<string, unknown> = {}) => run.mutate({ action, body: { note: note || undefined, ...body } });
  const coatingCos = companies.filter((c) => c.is_coating);

  const anodeLines = parseSerialLines(regAnodes);
  const cathodeLines = parseSerialLines(regCathodes);
  const patchSpec =
    (setter: typeof setAnodeSpecs, serial: string) => (name: string, value: string) =>
      setter((cur) => ({ ...cur, [serial]: { ...(cur[serial] || {}), [name]: value } }));
  const regItems = () => [
    ...anodeLines.map((l) => ({ element_kind: "anode", serial: l.serial, ...pickSpec(anodeSpecs[l.serial] || {}) })),
    ...cathodeLines.map((l) => ({ element_kind: "cathode", serial: l.serial, ...pickSpec(cathodeSpecs[l.serial] || {}) })),
  ];

  const mustReason = isAdmin || acts.includes("edit");
  return (
    <section className="wf-actions">
      <h4>{t("wf.yourStep")}</h4>
      {acts.includes("edit") ? <RequestEditForm d={d} t={t} /> : null}
      {formsMissing > 0 && (acts.includes("request_inspections") || main.includes("dispatch")) ? (
        <div className="wf-alert wf-insp-alert">
          <span>{t("wf.insp.missingAlert", { n: formsMissing, total: d.inspections_total ?? 0 })}</span>
          {acts.includes("request_inspections") ? (
            <button type="button" className="wf-btn" disabled={askForms.isPending} onClick={() => askForms.mutate()}>
              <ClipboardCheck size={14} /> {t("wf.insp.askMissing")}
            </button>
          ) : null}
        </div>
      ) : null}
      {main.includes("company") ? (
        <div className="wf-receive">
          <p className="wh-subdesc">{t("wf.coating.planHint")}</p>
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {t("wf.coatingCompany")}
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">—</option>
                {coatingCos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {coatingCos.length === 0 ? <small className="wf-muted">{t("wf.noCompanies")}</small> : null}
            </label>
            <button type="button" className="wf-btn" onClick={() => void workflowApi.downloadExcel(d.id, d.title || `recoating-${d.id}`)}>
              <FileSpreadsheet size={14} /> {t("wf.coating.excelAll")}
            </button>
          </div>
          {(d.packages ?? []).map((p) => (
            <div key={p.id} className="wh-form-inline wf-inline-plain">
              <strong className="wf-code">{p.code}</strong>
              <label>
                {t("wf.coating.sendDate")}
                <DateInput type="date" value={plans[p.id]?.send || ""} onChange={(e) => setPlans((prev) => ({ ...prev, [p.id]: { send: e.target.value, back: prev[p.id]?.back || "" } }))} />
              </label>
              <label>
                {t("wf.coating.expectedReturn")}
                <DateInput type="date" value={plans[p.id]?.back || ""} onChange={(e) => setPlans((prev) => ({ ...prev, [p.id]: { send: prev[p.id]?.send || todayIso(), back: e.target.value } }))} />
              </label>
            </div>
          ))}
          <label className="wh-check">
            <input type="checkbox" checked={emailed} onChange={(e) => setEmailed(e.target.checked)} />
            {t("wf.coating.emailExcel")}
          </label>
          <button
            type="button"
            className="wf-btn is-primary"
            disabled={!companyId || !emailed || run.isPending || (d.packages ?? []).some((p) => !plans[p.id]?.send || !plans[p.id]?.back)}
            onClick={() =>
              go("company", {
                company_id: companyId,
                excel_emailed: true,
                packages: (d.packages ?? []).map((p) => ({ package_id: p.id, dispatch_date: plans[p.id].send, expected_return_date: plans[p.id].back })),
              })
            }
          >
            <Send size={14} /> {t("wf.action.company")}
          </button>
        </div>
      ) : null}

      {main.includes("indent") ? (
        <div className="wh-form-inline wf-inline-plain">
          <label>
            {t("wf.col.indent")}
            <input value={indent} onChange={(e) => setIndent(e.target.value)} />
          </label>
          <button type="button" className="wf-btn is-primary" disabled={!indent.trim() || run.isPending} onClick={() => go("indent", { indent_no: indent })}>
            <Send size={14} /> {t("wf.action.indent")}
          </button>
        </div>
      ) : null}

      {main.includes("dispatch") ? (
        <div className="wh-form-inline wf-inline-plain">
          <p className="wh-subdesc">{t("wf.coating.dispatchHint", { sent: formatDate(d.dispatch_date), back: formatDate(d.expected_date) })}</p>
          <button
            type="button"
            className="wf-btn is-primary"
            disabled={run.isPending || formsMissing > 0}
            title={formsMissing > 0 ? t("wf.insp.missingAlert", { n: formsMissing, total: d.inspections_total ?? 0 }) : undefined}
            onClick={() => go("dispatch")}
          >
            <Send size={14} /> {t("wf.action.dispatch")}
          </button>
        </div>
      ) : null}

      {main.includes("order") ? (
        <div className="wf-receive">
          <p className="wh-subdesc">{t("wf.purchase.buyHint")}</p>
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {t("wf.col.requestDate")}
              <DateInput type="date" value={date1} onChange={(e) => setDate1(e.target.value)} />
            </label>
            <label>
              {t("wf.col.expected")}
              <DateInput type="date" value={date2} onChange={(e) => setDate2(e.target.value)} />
            </label>
            <label>
              {t("wf.col.delivered")}
              <DateInput type="date" value={plansDelivery} onChange={(e) => setPlansDelivery(e.target.value)} />
            </label>
          </div>
          {daysBetween(date2, plansDelivery) != null && (daysBetween(date2, plansDelivery) as number) > 0 ? (
            <div className="wh-form-inline wf-inline-plain">
              <label>
                {t("wf.delayParty")}
                <select value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="">—</option>
                  {DELAY_PARTIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`wf.party.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wh-grow">
                {t("wf.delayReason")}
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className="wf-btn is-primary"
            disabled={!date2 || !plansDelivery || run.isPending || ((daysBetween(date2, plansDelivery) ?? 0) > 0 && (!party || !reason.trim()))}
            onClick={() =>
              go("order", {
                request_date: date1,
                expected_delivery_date: date2,
                delivery_date: plansDelivery,
                delay_party: (daysBetween(date2, plansDelivery) ?? 0) > 0 ? party : undefined,
                delay_reason: (daysBetween(date2, plansDelivery) ?? 0) > 0 ? reason : undefined,
              })
            }
          >
            <Send size={14} /> {t("wf.action.order")}
          </button>
        </div>
      ) : null}

      {main.includes("rework") ? (
        <div className="wh-form-inline wf-inline-plain">
          <label>
            {t("wf.col.sent")}
            <DateInput type="date" value={date1} onChange={(e) => setDate1(e.target.value)} />
          </label>
          <label>
            {t("wf.col.expected")}
            <DateInput type="date" value={date2} onChange={(e) => setDate2(e.target.value)} />
          </label>
          <button type="button" className="wf-btn" disabled={!date2 || run.isPending} onClick={() => go("rework", { dispatch_date: date1, expected_return_date: date2 })}>
            <RotateCcw size={14} /> {t("wf.action.rework")}
          </button>
        </div>
      ) : null}

      {main.includes("receive") || main.includes("deliver") ? (
        <div className="wf-receive">
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {main.includes("receive") ? t("wf.col.returned") : t("wf.col.delivered")}
              <DateInput type="date" value={date1} onChange={(e) => setDate1(e.target.value)} />
            </label>
            <div className="wf-delay-preview">
              {t("wf.col.expected")}: {formatDate(d.expected_date)} — <DelayBadge days={delay} t={t} />
            </div>
          </div>
          {late ? (
            <div className="wh-form-inline wf-inline-plain">
              <label>
                {t("wf.delayParty")}
                <select value={party} onChange={(e) => setParty(e.target.value)}>
                  <option value="">—</option>
                  {DELAY_PARTIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`wf.party.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wh-grow">
                {t("wf.delayReason")}
                <input value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </div>
          ) : null}
          {main.includes("receive") ? (
            <div className="wh-form-inline wf-inline-plain">
              <label>
                {t("wf.coating.warrantyMonths")}
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={warrantyMonths}
                  onChange={(e) => setWarrantyMonths(e.target.value)}
                />
              </label>
              <label>
                {t("wf.coating.warrantyStart")}
                <DateInput type="date" value={warrantyStart} onChange={(e) => setWarrantyStart(e.target.value)} />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className="wf-btn is-primary"
            disabled={run.isPending || (late && (!party || !reason.trim())) || (main.includes("receive") && !warrantyStart)}
            onClick={() =>
              go(main.includes("receive") ? "receive" : "deliver", {
                actual_date: date1,
                delay_party: late ? party : undefined,
                delay_reason: late ? reason : undefined,
                warranty_months: main.includes("receive") && warrantyMonths !== "" ? Number(warrantyMonths) : undefined,
                warranty_start: main.includes("receive") ? warrantyStart : undefined,
              })
            }
          >
            <Check size={14} /> {t(main.includes("receive") ? "wf.action.receive" : "wf.action.deliver")}
          </button>
        </div>
      ) : null}

      {main.includes("report") ? (
        <div className="wh-form-inline wf-inline-plain">
          <label>
            {t("wf.coating.reportFile")}
            <input type="file" accept=".xlsx,.xlsm,.xls,.pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {d.packages && d.packages.length > 1 ? (
            <label>
              {t("wf.coating.forPallet")}
              <select value={packageId} onChange={(e) => setPackageId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">{t("wf.coating.allPallets")}</option>
                {d.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="wf-btn" disabled={!files.length || upload.isPending} onClick={() => upload.mutate()}>
            <Upload size={14} /> {t("wf.action.report")}
          </button>
        </div>
      ) : null}

      {main.includes("register") ? (
        <div className="wf-register">
          <p className="wh-subdesc">{t("wf.purchase.registerHint", { a: d.anode_count, k: d.cathode_count, done: d.registered ?? 0 })}</p>
          <div className="wf-two">
            <label>
              {t("wf.coating.anodes", { n: anodeLines.length })}
              <textarea rows={4} value={regAnodes} onChange={(e) => setRegAnodes(e.target.value)} disabled={!d.anode_count} />
            </label>
            <label>
              {t("wf.coating.cathodes", { n: cathodeLines.length })}
              <textarea rows={4} value={regCathodes} onChange={(e) => setRegCathodes(e.target.value)} disabled={!d.cathode_count} />
            </label>
          </div>
          {anodeLines.map((l) => (
            <PieceSpecCard
              key={`a-${l.serial}`}
              kind="anode"
              serial={l.serial}
              fields={ANODE_SPEC_FIELDS}
              values={anodeSpecs[l.serial] || {}}
              onChange={patchSpec(setAnodeSpecs, l.serial)}
              t={t}
            />
          ))}
          {cathodeLines.map((l) => (
            <PieceSpecCard
              key={`k-${l.serial}`}
              kind="cathode"
              serial={l.serial}
              fields={CATHODE_SPEC_FIELDS}
              values={cathodeSpecs[l.serial] || {}}
              onChange={patchSpec(setCathodeSpecs, l.serial)}
              t={t}
            />
          ))}
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {t("wf.coating.warrantyStart")}
              <DateInput type="date" value={warrantyStart} onChange={(e) => setWarrantyStart(e.target.value)} />
            </label>
            <label>
              {t("wf.coating.warrantyMonths")}
              <input type="number" min={0} max={240} value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} />
            </label>
            <button
              type="button"
              className="wf-btn is-primary"
              disabled={run.isPending || !regItems().length || !warrantyStart}
              onClick={() =>
                run.mutate(
                  {
                    action: "register",
                    body: {
                      note: note || undefined,
                      items: regItems(),
                      warranty_start: warrantyStart,
                      warranty_months: warrantyMonths !== "" ? Number(warrantyMonths) : undefined,
                    },
                  },
                  {
                    onSuccess: () => {
                      setRegAnodes("");
                      setRegCathodes("");
                      setAnodeSpecs({});
                      setCathodeSpecs({});
                    },
                  }
                )
              }
            >
              <Check size={14} /> {t("wf.action.register")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="wh-form-inline wf-inline-plain">
        <label className="wh-grow">
          {main.includes("reject") || main.includes("inspect_reject") ? t("wf.noteReject") : mustReason && acts.includes("cancel") ? t("wf.cancelReason") : t("wf.note")}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mustReason && acts.includes("cancel") ? t("wf.cancelReason") : undefined} />
        </label>
        {main.includes("submit") ? (
          <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => go("submit")}>
            <Send size={14} /> {t("wf.action.submit")}
          </button>
        ) : null}
        {main.includes("inspect_ok") ? (
          <button type="button" className="wf-btn is-ok" disabled={run.isPending} onClick={() => go("inspect_ok")}>
            <Check size={14} /> {t("wf.action.inspect_ok")}
          </button>
        ) : null}
        {main.includes("inspect_reject") ? (
          <button type="button" className="wf-btn is-bad" disabled={run.isPending || !note.trim()} onClick={() => go("inspect_reject")}>
            <X size={14} /> {t("wf.action.inspect_reject")}
          </button>
        ) : null}
        {main.includes("approve") ? (
          <button type="button" className="wf-btn is-ok" disabled={run.isPending} onClick={() => go("approve")}>
            <Check size={14} /> {t("wf.action.approve")}
          </button>
        ) : null}
        {main.includes("reject") ? (
          <button type="button" className="wf-btn is-bad" disabled={run.isPending || !note.trim()} onClick={() => go("reject")}>
            <X size={14} /> {t("wf.action.reject")}
          </button>
        ) : null}
        {acts.includes("cancel") ? (
          <button
            type="button"
            className="wf-btn is-bad"
            disabled={run.isPending || (mustReason && !note.trim())}
            title={mustReason ? t("wf.cancelReason") : undefined}
            onClick={() => {
              if (mustReason && !note.trim()) return;
              if (window.confirm(t("wf.confirmDelete"))) go("cancel");
            }}
          >
            <Ban size={14} /> {t("wf.action.delete")}
          </button>
        ) : null}
      </div>

      {acts.includes("attach") && !main.includes("report") ? (
        <div className="wh-form-inline wf-inline-plain">
          <label>
            {t("wf.attachments")}
            <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          <button type="button" className="wf-btn" disabled={!files.length || attach.isPending} onClick={() => attach.mutate()}>
            <Paperclip size={14} /> {t("wf.action.attach")}
          </button>
        </div>
      ) : null}
      {info ? <div className="wf-info">{info}</div> : null}
      {error ? <div className="wf-alert">{error.message}</div> : null}
    </section>
  );
}

// ------------------------------------------------------------------ history + company performance

export function WorkflowHistoryPanel({ companies, onOpen }: { companies: WhCompany[]; onOpen: (flow: WfFlow, id: number) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>(() => {
    const r = defaultDateRange();
    return { date_from: r.from, date_to: r.to };
  });
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const history = useQuery({
    queryKey: ["wf", "history", query],
    queryFn: () => workflowApi.history(Object.fromEntries(Object.entries(query ?? {}).filter(([, v]) => v.trim()))),
    enabled: query !== null,
  });
  const period = { date_from: query?.date_from || undefined, date_to: query?.date_to || undefined };
  const report = useQuery({ queryKey: ["wf", "company-report", period], queryFn: () => workflowApi.companyReport(period) });

  const cols: Column<WfHistoryRow & { _key: string }>[] = [
    { key: "flow", header: t("wf.col.flow"), render: (r) => t(`wf.flow.${r.flow}`), filterText: (r) => t(`wf.flow.${r.flow}`) },
    { key: "code", header: t("wf.col.code"), render: (r) => <strong className="wf-code">{r.code}</strong> },
    { key: "serial", header: t("wh.col.serial"), render: (r) => <span className="wf-code">{r.serial}</span> },
    { key: "element_kind", header: t("wh.col.kind"), render: (r) => (r.element_kind ? t(`wf.kind.${r.element_kind}`) : "—") },
    { key: "company_name", header: t("wf.col.company"), render: (r) => r.company_name || "—" },
    { key: "indent_no", header: t("wf.col.indent"), render: (r) => r.indent_no || "—" },
    { key: "sent_date", header: t("wf.col.sentOrOrdered"), render: (r) => formatDate(r.sent_date) },
    { key: "expected_date", header: t("wf.col.expected"), render: (r) => formatDate(r.expected_date) },
    { key: "actual_date", header: t("wf.col.returnedOrDelivered"), render: (r) => formatDate(r.actual_date) },
    { key: "delay_days", header: t("wf.col.delay"), render: (r) => <DelayBadge days={r.delay_days} t={t} /> },
    { key: "status", header: t("wf.col.status"), render: (r) => <Badge color={statusColor(r.status)}>{t(`wf.status.${r.status}`)}</Badge> },
    { key: "final_report", header: t("wf.col.finalReport"), render: (r) => [r.final_report, r.remark].filter(Boolean).join(" — ") || "—" },
  ];
  const rcols: Column<WfCompanyStats>[] = [
    { key: "company_name", header: t("wf.col.company") },
    { key: "coating_pieces", header: t("wf.rep.coatingPieces"), render: (r) => `${r.coating_pieces} (${r.coating_requests})` },
    { key: "at_company", header: t("wf.rep.atCompany") },
    { key: "reworks", header: t("wf.reworks") },
    { key: "purchased", header: t("wf.rep.purchased"), render: (r) => t("wf.piecesShort", { a: r.purchased_anodes, k: r.purchased_cathodes }) },
    { key: "on_time", header: t("wf.rep.onTime"), render: (r) => `${r.on_time} / ${r.deliveries}` },
    { key: "late", header: t("wf.rep.late"), render: (r) => (r.late ? <Badge color="rose">{r.late}</Badge> : "0") },
    { key: "late_company", header: t("wf.rep.lateCompany") },
    { key: "avg_delay", header: t("wf.rep.avgDelay"), render: (r) => (r.avg_delay == null ? "—" : r.avg_delay) },
    { key: "max_delay", header: t("wf.rep.maxDelay"), render: (r) => (r.max_delay == null ? "—" : r.max_delay) },
  ];
  const totals = history.data?.totals;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="wh-panel-block">
      <h3>{t("wf.history.title")}</h3>
      <p className="wh-subdesc">{t("wf.history.hint")}</p>
      <form
        className="wh-form wh-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ ...form });
        }}
      >
        <label>
          {t("wh.col.serial")}
          <input value={form.serial ?? ""} onChange={(e) => set("serial", e.target.value)} />
        </label>
        <label>
          {t("wf.history.codeOrIndent")}
          <input value={form.code ?? ""} onChange={(e) => set("code", e.target.value)} placeholder="CO-… / PO-…" />
        </label>
        <label>
          {t("wf.col.company")}
          <select value={form.company_id ?? ""} onChange={(e) => set("company_id", e.target.value)}>
            <option value="">—</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("wf.col.flow")}
          <select value={form.flow ?? ""} onChange={(e) => set("flow", e.target.value)}>
            <option value="">{t("wf.history.both")}</option>
            <option value="coating">{t("wf.flow.coating")}</option>
            <option value="purchase">{t("wf.flow.purchase")}</option>
            <option value="assemble">{t("wf.flow.assemble")}</option>
          </select>
        </label>
        <label>
          {t("wf.history.from")}
          <DateInput type="date" value={form.date_from ?? ""} onChange={(e) => set("date_from", e.target.value)} />
        </label>
        <label>
          {t("wf.history.to")}
          <DateInput type="date" value={form.date_to ?? ""} onChange={(e) => set("date_to", e.target.value)} />
        </label>
        <button type="submit" className="wf-btn is-primary">
          <Search size={14} /> {t("common.search")}
        </button>
      </form>
      {totals ? (
        <div className="wh-facts wf-facts">
          <Fact label={t("wf.rep.coatingPieces")}>{totals.coating_pieces}</Fact>
          <Fact label={t("wf.rep.codes")}>{totals.coating_codes}</Fact>
          <Fact label={t("wf.rep.requests")}>{totals.coating_requests}</Fact>
          <Fact label={t("wf.rep.purchases")}>{totals.purchases}</Fact>
          <Fact label={t("wf.rep.purchasedPieces")}>{totals.purchased_pieces}</Fact>
        </div>
      ) : null}
      {query !== null ? (
        <DataTable
          columns={cols}
          data={(history.data?.rows ?? []).map((r, i) => ({ ...r, _key: `${r.flow}-${r.record_id}-${r.serial}-${i}` }))}
          keyField="_key"
          isLoading={history.isFetching}
          onRowClick={(r) => onOpen(r.flow, r.record_id)}
          emptyTitle={t("wh.empty")}
          maxHeight="min(46vh, 520px)"
        />
      ) : null}
      <h3>{t("wf.rep.companiesTitle")}</h3>
      <DataTable columns={rcols} data={report.data} keyField="company_id" isLoading={report.isLoading} emptyTitle={t("wh.empty")} maxHeight="min(40vh, 440px)" />
    </div>
  );
}
