"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Ban, Check, ClipboardCheck, FileText, MessageSquare, Paperclip, Plus } from "lucide-react";
import { DeadlineBadge, RequestEditForm, Stepper, useWorkflowMeta } from "@/components/domain/warehouse-workflow";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { PositionCombo } from "@/components/ui/position-combo";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { elementsApi, relationsApi } from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  CARTABLE_MS,
  refreshWarehouseData,
  membraneStockApi,
  workflowApi,
  type AssembleRequest,
  type AssembleRequestDetail,
  type AssemblyPoolRow,
  type WfGroup,
} from "@/lib/workflow";

type T = (k: string, vars?: Record<string, string | number | null | undefined>) => string;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function statusColor(status: string): "emerald" | "slate" | "violet" | "amber" {
  if (status === "completed") return "emerald";
  if (status === "cancelled") return "slate";
  if (status === "await_insp_sign" || status === "await_proc_sign") return "violet";
  return "amber";
}

function pieces(r: AssembleRequest, t: T) {
  return [r.element_nr && t("wf.insp.elementShort", { n: r.element_nr }), r.anode_nr, r.cathode_nr].filter(Boolean).join(" · ") || "—";
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <b>{children}</b>
    </div>
  );
}

function PoolSelect({
  kind,
  value,
  rows,
  t,
  onChange,
}: {
  kind: "anode" | "cathode";
  value: string;
  rows: AssemblyPoolRow[];
  t: T;
  onChange: (v: string) => void;
}) {
  const groups = useMemo(() => {
    const by: Record<string, AssemblyPoolRow[]> = { reusable: [], purchased: [], recoated: [] };
    for (const row of rows.filter((r) => r.kind === kind)) by[row.source]?.push(row);
    return by;
  }, [rows, kind]);
  return (
    <label>
      {t(`wf.kind.${kind}`)}
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">—</option>
        {(["reusable", "purchased", "recoated"] as const).map((source) =>
          groups[source].length ? (
            <optgroup key={source} label={t(`wf.asm.source.${source}`)}>
              {groups[source].map((row) => (
                <option key={`${row.source}-${row.serial}`} value={row.serial}>
                  {row.serial}
                  {row.company ? ` · ${row.company}` : ""}
                  {row.quality ? ` · ${row.quality}` : ""}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
      </select>
    </label>
  );
}

export function AssembleStartForm({
  compact,
  onCreated,
}: {
  compact?: boolean;
  onCreated?: (id: number) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = useWorkflowMeta();
  const can = !!meta.data?.can_request_assemble;
  const pool = useQuery({ queryKey: ["wf", "assembly-pool"], queryFn: workflowApi.assemblyPool, staleTime: 20_000 });
  const nextNr = useQuery({
    queryKey: ["elements", "next-nr"],
    queryFn: elementsApi.nextNumber,
    enabled: can,
  });
  const membranes = useQuery({
    queryKey: ["relations", "lookups", "membrane-numbers"],
    queryFn: () => relationsApi.lookup("membrane-numbers"),
    enabled: can,
    staleTime: 60_000,
  });
  const stock = [...(pool.data?.reusable ?? []), ...(pool.data?.purchased ?? []), ...(pool.data?.recoated ?? [])];
  const memTypes = useQuery({
    queryKey: ["membrane-stock", "types"],
    queryFn: membraneStockApi.types,
    enabled: can,
    staleTime: 5_000,
  });
  const memStock = useQuery({ queryKey: ["membrane-stock", "overview"], queryFn: membraneStockApi.overview, enabled: can, staleTime: 5_000 });
  const [form, setForm] = useState({ anode_nr: "", cathode_nr: "", membrane_type: "", membrane_nr: "", element_nr: "", note: "" });
  const pickedType = (memTypes.data ?? []).find((row) => row.type === form.membrane_type);
  const serialChoices = Array.from(
    new Set([
      ...(memStock.data?.items ?? []).filter((row) => row.serial && row.type === form.membrane_type).map((row) => row.serial as string),
      ...(form.membrane_type ? [] : (membranes.data ?? [])),
    ]),
  );
  const create = useMutation({
    mutationFn: () =>
      workflowApi.assembleCreate({
        anode_nr: form.anode_nr,
        cathode_nr: form.cathode_nr,
        membrane_type: form.membrane_type,
        membrane_nr: form.membrane_nr.trim(),
        element_nr: form.element_nr.trim() || undefined,
        note: form.note.trim() || undefined,
      }),
    onSuccess: (d) => {
      setForm({ anode_nr: "", cathode_nr: "", membrane_type: "", membrane_nr: "", element_nr: "", note: "" });
      refreshWarehouseData(qc);
      onCreated?.(d.id);
    },
  });
  if (!can) return compact ? null : <p className="wh-muted">{t("wf.asm.c90Only")}</p>;
  return (
    <form
      className={compact ? "ewc-start-form" : "wh-form"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.membrane_nr.trim() || !form.membrane_type) return;
        create.mutate();
      }}
    >
      {!compact ? <h3>{t("wf.asm.newTitle")}</h3> : null}
      <p className="wh-subdesc">{t("wf.asm.hint")}</p>
      <div className={compact ? "ewc-start-grid" : "wh-form-inline"}>
        <PoolSelect kind="anode" value={form.anode_nr} rows={stock} t={t} onChange={(v) => setForm({ ...form, anode_nr: v })} />
        <PoolSelect kind="cathode" value={form.cathode_nr} rows={stock} t={t} onChange={(v) => setForm({ ...form, cathode_nr: v })} />
        <label>
          {t("wf.asm.membraneType")}
          <select
            value={form.membrane_type}
            onChange={(e) => setForm({ ...form, membrane_type: e.target.value, membrane_nr: "" })}
            required
          >
            <option value="">—</option>
            {(memTypes.data ?? []).map((row) => (
              <option key={row.type} value={row.type}>
                {row.type}
                {row.tracked ? ` (${row.in_stock})` : ""}
              </option>
            ))}
          </select>
          {pickedType ? (
            <small className="wh-muted">
              {pickedType.tracked ? t("wf.asm.membraneStockLeft", { n: pickedType.in_stock }) : t("wf.asm.membraneNoStock")}
            </small>
          ) : null}
        </label>
        <label>
          {t("wf.asm.membraneNr")}
          <input
            list="asm-membrane-serials"
            value={form.membrane_nr}
            onChange={(e) => setForm({ ...form, membrane_nr: e.target.value })}
            required
          />
          <datalist id="asm-membrane-serials">
            {serialChoices.map((nr) => (
              <option key={nr} value={nr} />
            ))}
          </datalist>
        </label>
        <label>
          {t("wf.insp.element")}
          <input
            value={form.element_nr}
            onChange={(e) => setForm({ ...form, element_nr: e.target.value })}
            placeholder={nextNr.data?.element_nr || t("wf.asm.nextNr")}
          />
        </label>
        <label className="wh-grow">
          {t("wf.note")}
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
      </div>
      <button type="submit" className="wf-btn is-primary" disabled={create.isPending || !form.anode_nr || !form.cathode_nr || !form.membrane_type || !form.membrane_nr.trim()}>
        <Plus size={14} /> {t("wf.asm.create")}
      </button>
      {create.error ? <div className="wf-alert">{(create.error as Error).message}</div> : null}
    </form>
  );
}

export function AssembleRequestsPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useI18n();
  const [openOnly, setOpenOnly] = useState(true);
  const list = useQuery({
    queryKey: ["wf", "list", "assemble", openOnly],
    queryFn: () => workflowApi.assembleList({ open_only: openOnly }),
    refetchInterval: CARTABLE_MS,
  });
  const cols: Column<AssembleRequest>[] = [
    { key: "code", header: t("wf.col.code"), render: (r) => <strong className="wf-code">{r.code}</strong> },
    {
      key: "status",
      header: t("wf.col.status"),
      render: (r) => <Badge color={statusColor(r.status)}>{t(`wf.status.${r.status}`)}</Badge>,
      filterText: (r) => t(`wf.status.${r.status}`),
    },
    { key: "sla_state", header: t("wf.col.deadline"), render: (r) => <DeadlineBadge row={r} t={t} /> },
    { key: "pieces", header: t("wf.insp.pieces"), render: (r) => pieces(r, t), filterText: (r) => pieces(r, t) },
    { key: "assembly_date", header: t("wf.asm.assemblyDate"), render: (r) => formatDate(r.assembly_date) },
    { key: "cell", header: t("wf.insp.position"), render: (r) => [r.electrolyzer, r.position].filter(Boolean).join(" / ") || "—" },
    { key: "updated_at", header: t("wf.col.updated"), render: (r) => formatDateTime(r.updated_at) },
  ];
  return (
    <div className="wh-panel-block">
      <AssembleStartForm onCreated={onOpen} />
      <div className="wh-toolbar">
        <h3>{t("wf.asm.listTitle")}</h3>
        <label className="wh-check">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          {t("wf.openOnly")}
        </label>
      </div>
      {list.isLoading ? <LoadingState /> : null}
      {list.isError ? <ErrorState message={(list.error as Error).message} /> : null}
      {list.data ? <DataTable data={list.data} columns={cols} keyField="id" onRowClick={(r) => onOpen(r.id)} /> : null}
    </div>
  );
}

function airHref(d: AssembleRequestDetail) {
  const params = new URLSearchParams();
  params.set("view", "form");
  if (d.air?.id) params.set("id", String(d.air.id));
  const nr = d.air?.element_nr || d.element_nr;
  if (nr) params.set("element_nr", nr);
  return `/assembly-inspection?${params.toString()}`;
}

function SignRejectBox({
  d,
  t,
  signAction,
  rejectAction,
  signLabel,
  onDone,
}: {
  d: AssembleRequestDetail;
  t: T;
  signAction: string;
  rejectAction: string;
  signLabel: string;
  onDone: (next: AssembleRequestDetail) => void;
}) {
  const [rejectNote, setRejectNote] = useState("");
  const [failNote, setFailNote] = useState("");
  const run = useMutation({
    mutationFn: ({ action, note }: { action: string; note?: string }) => workflowApi.assembleStep(d.id, action, { note }),
    onSuccess: onDone,
  });
  return (
    <div className="wf-section">
      <p className="wh-subdesc">{t("wf.asm.signHint")}</p>
      <div className="wh-form-inline">
        <Link className="wf-btn" href={airHref(d)} target="_blank">
          <FileText size={14} /> {t("wf.asm.openAir")}
        </Link>
        <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => run.mutate({ action: signAction })}>
          <Check size={14} /> {signLabel}
        </button>
      </div>
      <div className="wh-form-inline">
        <label className="wh-grow">
          {t("wf.asm.rejectHint")}
          <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </label>
        <button
          type="button"
          className="wf-btn is-bad"
          disabled={run.isPending || !rejectNote.trim()}
          onClick={() => run.mutate({ action: rejectAction, note: rejectNote.trim() })}
        >
          <Ban size={14} /> {t("wf.asm.rejectBack")}
        </button>
      </div>
      {d.actions.includes("fail_test") ? (
        <>
          <p className="wh-subdesc">{t("wf.asm.failHint")}</p>
          <div className="wh-form-inline">
            <label className="wh-grow">
              {t("wf.asm.failNote")}
              <input value={failNote} onChange={(e) => setFailNote(e.target.value)} />
            </label>
            <button
              type="button"
              className="wf-btn is-bad"
              disabled={run.isPending || !failNote.trim()}
              onClick={() => {
                if (window.confirm(t("wf.asm.failTest"))) run.mutate({ action: "fail_test", note: failNote.trim() });
              }}
            >
              <Ban size={14} /> {t("wf.asm.failTest")}
            </button>
          </div>
        </>
      ) : null}
      {run.error ? <div className="wf-alert">{(run.error as Error).message}</div> : null}
    </div>
  );
}

function AssembleBody({ d, t }: { d: AssembleRequestDetail; t: T }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [day, setDay] = useState(todayIso());
  const [electrolyzer, setElectrolyzer] = useState(d.electrolyzer || "");
  const [position, setPosition] = useState(d.position || "");
  const acts = d.actions;
  const done = (next: AssembleRequestDetail) => {
    qc.setQueryData(["wf", "detail", "assemble", next.id], next);
    refreshWarehouseData(qc);
    setNote("");
    setFiles([]);
  };
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) => workflowApi.assembleStep(d.id, action, body),
    onSuccess: done,
  });
  const attach = useMutation({
    mutationFn: () => workflowApi.attach("assemble", d.id, files, note || undefined),
    onSuccess: () => {
      setFiles([]);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["wf", "detail", "assemble", d.id] });
    },
  });
  const go = (action: string, body: Record<string, unknown> = {}) => run.mutate({ action, body: { note: note || undefined, ...body } });
  const rawError = (run.error || attach.error) as Error | null;
  const errorMessage = rawError?.message?.includes("Fill and save the Assembly Inspection Report")
    ? t("wf.asm.fillAirFirst")
    : rawError?.message;
  const open = d.status !== "completed" && d.status !== "cancelled";
  const air = d.air;

  return (
    <div className="wf-detail">
      <Stepper flow="assemble" status={d.status} t={t} />
      <div className="wh-facts wf-facts">
        <Fact label={t("wf.col.status")}>
          <Badge color={statusColor(d.status)}>{t(`wf.status.${d.status}`)}</Badge>
        </Fact>
        {d.sla_state ? (
          <Fact label={t("wf.col.deadline")}>
            <DeadlineBadge row={d} t={t} />
          </Fact>
        ) : null}
        <Fact label={t("wf.insp.element")}>{d.element_nr || "—"}</Fact>
        <Fact label={t("wf.kind.anode")}>
          {d.anode_nr || "—"}
          {d.anode_source ? ` · ${t(`wf.asm.source.${d.anode_source}`)}` : ""}
        </Fact>
        <Fact label={t("wf.kind.cathode")}>
          {d.cathode_nr || "—"}
          {d.cathode_source ? ` · ${t(`wf.asm.source.${d.cathode_source}`)}` : ""}
        </Fact>
        {d.membrane_nr ? (
          <Fact label={t("wf.insp.membrane")}>
            {d.membrane_nr}
            {d.membrane_type ? ` · ${d.membrane_type}` : ""}
          </Fact>
        ) : null}
        <Fact label={t("wf.asm.assemblyDate")}>{formatDate(d.assembly_date)}</Fact>
        <Fact label={t("wf.insp.position")}>{[d.electrolyzer, d.position].filter(Boolean).join(" / ") || "—"}</Fact>
        <Fact label={t("wf.col.createdBy")}>
          {d.created_by || "—"} · {formatDateTime(d.created_at)}
        </Fact>
      </div>

      {d.decisions && Object.values(d.decisions).some((x) => x?.result === "test_failed") ? (
        <div className="wf-alert">
          {t("wf.asm.failedBanner")}
          {Object.values(d.decisions)
            .filter((x) => x?.result === "test_failed" && x.note)
            .map((x) => ` — ${x?.note}`)
            .join("")}
        </div>
      ) : null}

      {d.element_nr ? (
        <Link className="wf-link" href={`/elements/assembly?element_nr=${encodeURIComponent(d.element_nr)}`} target="_blank">
          {t("wf.asm.openAssembly")}
        </Link>
      ) : null}

      {d.status !== "await_assembly" ? (
        <section className="wf-section">
          <h4>{t("wf.asm.airTitle")}</h4>
          <p className="wh-subdesc">{t("wf.asm.airHint")}</p>
          <div className="wh-facts wf-facts">
            <Fact label={t("assemblyInspection.activities")}>
              {air ? `${air.checks_done}/${air.checks_total}` : "—"}
            </Fact>
            <Fact label={t("wf.group.c90")}>{air?.sign_maint ? air.sign_maint_name || t("wf.asm.signed") : t("wf.asm.pending")}</Fact>
            <Fact label={t("wf.group.inspection")}>{air?.sign_insp ? air.sign_insp_name || t("wf.asm.signed") : t("wf.asm.pending")}</Fact>
            <Fact label={t("wf.group.process")}>{air?.sign_proc ? air.sign_proc_name || t("wf.asm.signed") : t("wf.asm.pending")}</Fact>
          </div>
          <Link className="wf-link" href={airHref(d)} target="_blank">
            {t("wf.asm.openAir")}
          </Link>
        </section>
      ) : null}

      {open && acts.includes("sign_insp") ? (
        <SignRejectBox d={d} t={t} signAction="sign_insp" rejectAction="reject_insp" signLabel={t("wf.asm.confirmInspSign")} onDone={done} />
      ) : null}
      {open && acts.includes("sign_proc") ? (
        <SignRejectBox d={d} t={t} signAction="sign_proc" rejectAction="reject_proc" signLabel={t("wf.asm.confirmProcSign")} onDone={done} />
      ) : null}

      {open ? (
        <section className="wf-actions">
          <h4>{t("wf.yourStep")}</h4>
          {!acts.length ? <div className="wf-wait">{t("wf.waitingFor", { group: d.groups.map((g: WfGroup) => t(`wf.group.${g}`)).join(" / ") })}</div> : null}
          {acts.includes("assemble") ? (
            <div className="wh-form-inline">
              <label>
                {t("wf.asm.assemblyDate")}
                <DateInput type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
              </label>
              <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => go("assemble", { assembly_date: day })}>
                <Check size={14} /> {t("wf.asm.stamp")}
              </button>
            </div>
          ) : null}
          {acts.includes("submit_air") ? (
            <div className="wh-form-inline">
              <Link className="wf-btn" href={airHref(d)} target="_blank">
                <ClipboardCheck size={14} /> {t("wf.asm.openAir")}
              </Link>
              <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => go("submit_air")}>
                <Check size={14} /> {t("wf.asm.submitAir")}
              </button>
            </div>
          ) : null}
          {acts.includes("disassemble") ? (
            <div className="wh-form-inline">
              <p className="wh-subdesc wh-grow">{t("wf.asm.disassembleHint")}</p>
              <label>
                {t("elDash.cartable.disassemblyDate")}
                <DateInput type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
              </label>
              <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => go("disassemble", { assembly_date: day })}>
                <Check size={14} /> {t("wf.asm.disassembleDo")}
              </button>
            </div>
          ) : null}
          {acts.includes("position") ? (
            <div className="wh-form-inline">
              <label>
                {t("fields.electrolyzer")}
                <ElectrolyzerCombo value={electrolyzer} onChange={setElectrolyzer} required />
              </label>
              <label>
                {t("fields.position")}
                <PositionCombo electrolyzer={electrolyzer} value={position} onChange={setPosition} excludeId={d.element_id} required />
              </label>
              <button
                type="button"
                className="wf-btn is-primary"
                disabled={run.isPending || !electrolyzer || !position.trim()}
                onClick={() => go("position", { electrolyzer, position })}
              >
                <Check size={14} /> {t("wf.asm.setCell")}
              </button>
            </div>
          ) : null}
          {acts.includes("edit") ? <RequestEditForm d={d as never} t={t} /> : null}
          <div className="wh-form-inline wf-inline-plain">
            <label className="wh-grow">
              {t("wf.note")}
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {acts.includes("comment") ? (
              <button type="button" className="wf-btn" disabled={run.isPending || !note.trim()} onClick={() => go("comment")}>
                <MessageSquare size={14} /> {t("wf.action.comment")}
              </button>
            ) : null}
            {acts.includes("cancel") ? (
              <button
                type="button"
                className="wf-btn is-bad"
                disabled={run.isPending || !note.trim()}
                onClick={() => {
                  if (window.confirm(t("wf.confirmDelete"))) go("cancel");
                }}
              >
                <Ban size={14} /> {t("wf.action.cancel")}
              </button>
            ) : null}
          </div>
          {acts.includes("attach") ? (
            <div className="wh-form-inline">
              <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              <button type="button" className="wf-btn" disabled={attach.isPending || !files.length} onClick={() => attach.mutate()}>
                <Paperclip size={14} /> {t("wf.action.attach")}
              </button>
            </div>
          ) : null}
          {errorMessage ? <div className="wf-alert">{errorMessage}</div> : null}
        </section>
      ) : null}

      {d.events?.length ? (
        <section className="wf-section">
          <h4>{t("wf.log")}</h4>
          <ul className="wf-files">
            {d.events.map((ev) => (
              <li key={ev.id}>
                {formatDateTime(ev.created_at)} · {ev.actor} · {t(`wf.event.${ev.action}`)}
                {ev.note ? ` — ${ev.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function AssembleRequestModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ["wf", "detail", "assemble", id],
    queryFn: () => workflowApi.assembleGet(id!),
    enabled: id != null,
  });
  return (
    <Modal open={id != null} onClose={onClose} title={detail.data?.code || t("wf.asm.listTitle")}>
      {detail.isLoading ? <LoadingState /> : null}
      {detail.isError ? <ErrorState message={(detail.error as Error).message} /> : null}
      {detail.data ? <AssembleBody d={detail.data} t={t} /> : null}
    </Modal>
  );
}
