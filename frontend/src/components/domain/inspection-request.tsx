"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Ban, ClipboardCheck, FileText, Link2, MessageSquare, Paperclip, Plus, Send } from "lucide-react";
import { DeadlineBadge, Stepper, useWorkflowMeta } from "@/components/domain/warehouse-workflow";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  CARTABLE_MS,
  inspectionFormHref,
  refreshWarehouseData,
  workflowApi,
  type InspectionRequest,
  type InspectionRequestDetail,
  type PieceVerdict,
  type WfGroup,
} from "@/lib/workflow";

type T = (k: string, vars?: Record<string, string | number | null | undefined>) => string;

function statusColor(status: string): "emerald" | "slate" | "violet" | "amber" {
  if (status === "completed") return "emerald";
  if (status === "cancelled") return "slate";
  if (status === "await_inspection") return "violet";
  return "amber";
}

function pieces(r: InspectionRequest, t: T) {
  return [r.element_nr && t("wf.insp.elementShort", { n: r.element_nr }), r.anode_nr, r.cathode_nr].filter(Boolean).join(" · ") || "—";
}

/** C-90 asks inspection for Element Inspection forms; dismantled elements land here on their own. */
export function InspectionRequestsPanel({ onOpen }: { onOpen: (id: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const meta = useWorkflowMeta();
  const canRequest = !!meta.data?.can_request_inspection;
  const [openOnly, setOpenOnly] = useState(true);
  const list = useQuery({
    queryKey: ["wf", "list", "inspection", openOnly],
    queryFn: () => workflowApi.inspectionList({ open_only: openOnly }),
    refetchInterval: CARTABLE_MS,
  });
  const [form, setForm] = useState({ element_nr: "", anode_nr: "", cathode_nr: "", reason: "" });
  const create = useMutation({
    mutationFn: () =>
      workflowApi.inspectionCreate({
        element_nr: form.element_nr.trim() || undefined,
        anode_nr: form.anode_nr.trim() || undefined,
        cathode_nr: form.cathode_nr.trim() || undefined,
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: (d) => {
      setForm({ element_nr: "", anode_nr: "", cathode_nr: "", reason: "" });
      refreshWarehouseData(qc);
      onOpen(d.id);
    },
  });
  const cols: Column<InspectionRequest>[] = [
    { key: "code", header: t("wf.col.code"), render: (r) => <strong className="wf-code">{r.code}</strong> },
    {
      key: "status",
      header: t("wf.col.status"),
      render: (r) => <Badge color={statusColor(r.status)}>{t(`wf.status.${r.status}`)}</Badge>,
      filterText: (r) => t(`wf.status.${r.status}`),
    },
    { key: "sla_state", header: t("wf.col.deadline"), render: (r) => <DeadlineBadge row={r} t={t} /> },
    { key: "pieces", header: t("wf.insp.pieces"), render: (r) => pieces(r, t), filterText: (r) => pieces(r, t) },
    { key: "electrolyzer", header: t("wf.insp.position"), render: (r) => [r.electrolyzer, r.position].filter(Boolean).join(" / ") || "—" },
    { key: "disassembly_date", header: t("wf.insp.dismantled"), render: (r) => formatDate(r.disassembly_date) },
    { key: "reason", header: t("wf.insp.reason"), render: (r) => r.reason || "—" },
    { key: "updated_at", header: t("wf.col.updated"), render: (r) => formatDateTime(r.updated_at) },
  ];
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const filled = form.element_nr.trim() || form.anode_nr.trim() || form.cathode_nr.trim();
  return (
    <div className="wh-panel-block">
      <Stepper flow="inspection" status="" t={t} />
      <p className="wh-subdesc">{t("wf.insp.hint")}</p>
      {canRequest ? (
        <form
          className="wh-form"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <h3>{t("wf.insp.newTitle")}</h3>
          <div className="wh-form-inline wf-inline-plain">
            <label>
              {t("wf.insp.element")}
              <input value={form.element_nr} onChange={(e) => set("element_nr", e.target.value)} />
            </label>
            <label>
              {t("wf.kind.anode")}
              <input value={form.anode_nr} onChange={(e) => set("anode_nr", e.target.value)} />
            </label>
            <label>
              {t("wf.kind.cathode")}
              <input value={form.cathode_nr} onChange={(e) => set("cathode_nr", e.target.value)} />
            </label>
            <label className="wh-grow">
              {t("wf.insp.reason")}
              <input value={form.reason} onChange={(e) => set("reason", e.target.value)} />
            </label>
            <button type="submit" className="wf-btn is-primary" disabled={!filled || create.isPending}>
              <Plus size={14} /> {t("wf.insp.create")}
            </button>
          </div>
          {create.error ? <div className="wf-alert">{(create.error as Error).message}</div> : null}
        </form>
      ) : null}
      <div className="wf-head">
        <h3>{t("wf.insp.listTitle")}</h3>
        <label className="wh-check wf-small">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          {t("wf.openOnly")}
        </label>
      </div>
      {list.isError ? <ErrorState message={(list.error as Error).message} /> : null}
      <DataTable
        columns={cols}
        data={list.data}
        keyField="id"
        isLoading={list.isLoading}
        onRowClick={(r) => onOpen(r.id)}
        emptyTitle={t("wh.empty")}
        maxHeight="min(52vh, 580px)"
      />
    </div>
  );
}

export function InspectionRequestModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t } = useI18n();
  const detail = useQuery({
    queryKey: ["wf", "detail", "inspection", id],
    queryFn: async () => {
      const d = await workflowApi.inspectionGet(id!);
      void workflowApi.markRead({ flow: "inspection", record_id: id! }).catch(() => undefined);
      return d;
    },
    enabled: id != null,
    refetchInterval: CARTABLE_MS,
  });
  const d = detail.data;
  return (
    <Modal open={id != null} onClose={onClose} title={d ? `${t("wf.flow.inspection")} — ${d.title}` : t("wf.flow.inspection")} wide>
      {detail.isLoading ? <LoadingState /> : null}
      {detail.isError ? <ErrorState message={(detail.error as Error).message} /> : null}
      {d ? <InspectionBody d={d} t={t} /> : null}
    </Modal>
  );
}

function verdictText(item: PieceVerdict, t: T) {
  if (item.usable === true || item.quality) {
    const quality = item.quality === "medium" ? t("wf.insp.qualityMedium") : item.quality === "good" ? t("wf.insp.qualityGood") : "";
    return [t("wf.insp.usable"), quality].filter(Boolean).join(" · ");
  }
  if (item.usable === false || item.problem) {
    const problem =
      item.problem === "mechanical"
        ? t("wf.insp.problemMechanical")
        : item.problem === "coating"
          ? t("wf.insp.problemCoating")
          : item.problem === "rate_off"
            ? t("wf.insp.problemRateOff")
            : "";
    const warranty = item.warranty === true ? t("wf.insp.underWarranty") : item.warranty === false ? t("wf.insp.noWarranty") : "";
    return [t("wf.insp.notUsable"), problem, warranty].filter(Boolean).join(" · ");
  }
  if (item.result) return `${item.healthy ? t("wf.insp.healthy") : t("wf.insp.notHealthy")} — ${item.result}`;
  return "";
}

function sideLabel(d: InspectionRequestDetail, side: "inspection" | "process", t: T) {
  const block = d.decisions?.[side];
  const bits = (["anode", "cathode"] as const)
    .map((kind) => {
      const item = block?.[kind];
      const text = item ? verdictText(item, t) : "";
      if (!text) return null;
      return `${t(kind === "anode" ? "wf.kind.anode" : "wf.kind.cathode")}: ${text}`;
    })
    .filter(Boolean);
  return bits.length ? bits.join(" · ") : t("wf.insp.waitingSide");
}

type PieceDraft = {
  usable: "" | "yes" | "no";
  quality: "" | "good" | "medium";
  problem: "" | "coating" | "mechanical" | "rate_off";
  warranty: "" | "yes" | "no";
  problems: string;
};

function draftFrom(saved?: PieceVerdict): PieceDraft {
  if (saved?.usable === false || saved?.problem) {
    return {
      usable: "no",
      quality: "",
      problem: saved.problem || "",
      warranty: saved.warranty === true ? "yes" : saved.warranty === false ? "no" : "",
      problems: saved.problems || "",
    };
  }
  if (saved?.usable === true || saved?.quality) {
    return {
      usable: "yes",
      quality: saved.quality || "",
      problem: "",
      warranty: "",
      problems: saved.problems || "",
    };
  }
  return { usable: "", quality: "", problem: "", warranty: "", problems: saved?.problems || "" };
}

function draftReady(draft: PieceDraft) {
  if (draft.usable === "yes") return draft.quality === "good" || draft.quality === "medium";
  if (draft.usable !== "no") return false;
  if (draft.problem === "rate_off") return true;
  return (draft.problem === "coating" || draft.problem === "mechanical") && (draft.warranty === "yes" || draft.warranty === "no");
}

function draftPayload(draft: PieceDraft) {
  return {
    usable: draft.usable === "yes",
    quality: draft.usable === "yes" ? draft.quality : null,
    problem: draft.usable === "no" ? draft.problem : null,
    warranty: draft.usable === "no" && draft.problem !== "rate_off" && draft.warranty ? draft.warranty === "yes" : null,
    problems: draft.problems,
  };
}

function PieceDecision({
  d,
  side,
  t,
  onDone,
}: {
  d: InspectionRequestDetail;
  side: "inspection" | "process";
  t: T;
  onDone: (next: InspectionRequestDetail) => void;
}) {
  const saved = d.decisions?.[side];
  const [anode, setAnode] = useState<PieceDraft>(() => draftFrom(saved?.anode));
  const [cathode, setCathode] = useState<PieceDraft>(() => draftFrom(saved?.cathode));
  const run = useMutation({
    mutationFn: () =>
      workflowApi.inspectionStep(d.id, "decide", {
        side,
        anode: d.anode_nr ? draftPayload(anode) : undefined,
        cathode: d.cathode_nr ? draftPayload(cathode) : undefined,
      }),
    onSuccess: onDone,
  });
  const ready = (!d.anode_nr || draftReady(anode)) && (!d.cathode_nr || draftReady(cathode));
  const field = (kind: "anode" | "cathode", serial: string, value: PieceDraft, set: (v: PieceDraft) => void) => (
    <div className="wf-piece">
      <strong>
        {t(kind === "anode" ? "wf.kind.anode" : "wf.kind.cathode")} {serial}
      </strong>
      <label>
        {t("wf.insp.chooseStatus")}
        <select value={value.usable} onChange={(e) => set({ ...value, usable: e.target.value as PieceDraft["usable"] })}>
          <option value="">{t("wf.insp.chooseStatus")}</option>
          <option value="yes">{t("wf.insp.usable")}</option>
          <option value="no">{t("wf.insp.notUsable")}</option>
        </select>
      </label>
      {value.usable === "yes" ? (
        <label>
          {t("wf.insp.quality")}
          <select value={value.quality} onChange={(e) => set({ ...value, quality: e.target.value as PieceDraft["quality"] })}>
            <option value="">{t("wf.insp.quality")}</option>
            <option value="good">{t("wf.insp.qualityGood")}</option>
            <option value="medium">{t("wf.insp.qualityMedium")}</option>
          </select>
        </label>
      ) : null}
      {value.usable === "no" ? (
        <label>
          {t("wf.insp.problem")}
          <select value={value.problem} onChange={(e) => set({ ...value, problem: e.target.value as PieceDraft["problem"] })}>
            <option value="">{t("wf.insp.problem")}</option>
            <option value="mechanical">{t("wf.insp.problemMechanical")}</option>
            <option value="coating">{t("wf.insp.problemCoating")}</option>
            <option value="rate_off">{t("wf.insp.problemRateOff")}</option>
          </select>
        </label>
      ) : null}
      {value.usable === "no" && (value.problem === "mechanical" || value.problem === "coating") ? (
        <label>
          {t("wf.insp.warranty")}
          <select value={value.warranty} onChange={(e) => set({ ...value, warranty: e.target.value as PieceDraft["warranty"] })}>
            <option value="">{t("wf.insp.warranty")}</option>
            <option value="yes">{t("wf.insp.underWarranty")}</option>
            <option value="no">{t("wf.insp.noWarranty")}</option>
          </select>
        </label>
      ) : null}
      <label>
        {t("wf.insp.problems")}
        <textarea value={value.problems} onChange={(e) => set({ ...value, problems: e.target.value })} />
      </label>
    </div>
  );
  return (
    <div className="wf-section">
      <h4>{t(side === "inspection" ? "wf.group.inspection" : "wf.group.process")}</h4>
      {d.anode_nr ? field("anode", d.anode_nr, anode, setAnode) : null}
      {d.cathode_nr ? field("cathode", d.cathode_nr, cathode, setCathode) : null}
      <button type="button" className="wf-btn is-primary" disabled={run.isPending || !ready} onClick={() => run.mutate()}>
        {t("wf.insp.confirmSide")}
      </button>
      {run.error ? <div className="wf-alert">{(run.error as Error).message}</div> : null}
    </div>
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

function InspectionBody({ d, t }: { d: InspectionRequestDetail; t: T }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const acts = d.actions;
  const done = (next: InspectionRequestDetail) => {
    qc.setQueryData(["wf", "detail", "inspection", next.id], next);
    refreshWarehouseData(qc);
    setNote("");
    setFiles([]);
  };
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown> }) => workflowApi.inspectionStep(d.id, action, body),
    onSuccess: done,
  });
  const attach = useMutation({
    mutationFn: () => workflowApi.attach("inspection", d.id, files, note || undefined),
    onSuccess: () => {
      setFiles([]);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["wf", "detail", "inspection", d.id] });
    },
  });
  const go = (action: string, body: Record<string, unknown> = {}) => run.mutate({ action, body: { note: note || undefined, ...body } });
  const error = (run.error || attach.error) as Error | null;
  const open = d.status !== "completed" && d.status !== "cancelled";

  return (
    <div className="wf-detail">
      <Stepper flow="inspection" status={d.status} t={t} />
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
        <Fact label={t("wf.insp.position")}>{[d.electrolyzer, d.position].filter(Boolean).join(" / ") || "—"}</Fact>
        <Fact label={t("wf.kind.anode")}>{d.anode_nr || "—"}</Fact>
        <Fact label={t("wf.kind.cathode")}>{d.cathode_nr || "—"}</Fact>
        {d.membrane_nr ? <Fact label={t("wf.insp.membrane")}>{d.membrane_nr}</Fact> : null}
        <Fact label={t("wf.insp.dismantled")}>{formatDate(d.disassembly_date)}</Fact>
        {d.reason ? <Fact label={t("wf.insp.reason")}>{d.reason}</Fact> : null}
        <Fact label={t("wf.col.createdBy")}>
          {d.created_by || "—"} · {formatDateTime(d.created_at)}
        </Fact>
      </div>

      {d.cell ? (
        <section className="wf-section">
          <h4>{t("wf.insp.cellTitle")}</h4>
          <div className="wh-facts wf-facts">
            <Fact label={t("wf.insp.assembly")}>{formatDate(d.cell.assembly_date)}</Fact>
            <Fact label={t("wf.insp.commission")}>{formatDate(d.cell.commissioning_date)}</Fact>
            <Fact label={t("wf.insp.gap")}>{d.cell.gap_mm || "—"}</Fact>
            <Fact label={t("wf.insp.membrane")}>{d.cell.membrane_type || d.membrane_nr || "—"}</Fact>
            <Fact label={t("wf.insp.anodeCoat")}>{d.cell.anode_coating || "—"}</Fact>
            <Fact label={t("wf.insp.cathodeCoat")}>{d.cell.cathode_coating || "—"}</Fact>
            <Fact label={t("wf.insp.dol")}>{d.cell.dol_days ?? "—"}</Fact>
            {d.cell.decommission_reason ? <Fact label={t("wf.insp.reason")}>{d.cell.decommission_reason}</Fact> : null}
          </div>
          <div className="wh-form-inline wf-inline-plain">
            {d.anode_nr ? (
              <Link className="wf-link" href={`/segregation?serial_nr=${encodeURIComponent(d.anode_nr)}`} target="_blank">
                {t("wf.kind.anode")} {d.anode_nr}
              </Link>
            ) : null}
            {d.cathode_nr ? (
              <Link className="wf-link" href={`/segregation?serial_nr=${encodeURIComponent(d.cathode_nr)}`} target="_blank">
                {t("wf.kind.cathode")} {d.cathode_nr}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {open || d.decisions?.inspection || d.decisions?.process ? (
        <section className="wf-section">
          <h4>{t("wf.insp.parallelTitle")}</h4>
          <p className="wh-subdesc">{t("wf.insp.parallelHint")}</p>
          <div className="wh-facts wf-facts">
            <Fact label={t("wf.group.inspection")}>{sideLabel(d, "inspection", t)}</Fact>
            <Fact label={t("wf.group.process")}>{sideLabel(d, "process", t)}</Fact>
          </div>
          {acts.includes("decide_inspection") ? <PieceDecision d={d} side="inspection" t={t} onDone={done} /> : null}
          {acts.includes("decide_process") ? <PieceDecision d={d} side="process" t={t} onDone={done} /> : null}
        </section>
      ) : null}

      {d.report ? (
        <section className="wf-section">
          <h4>{t("wf.insp.formTitle")}</h4>
          <div className="wf-insp-cell">
            <Link className="wf-link" href={`/inspections?id=${d.report.id}`} target="_blank">
              <ClipboardCheck size={14} /> {d.report.element_nr || `#${d.report.id}`} · {formatDate(d.report.date)} · {d.report.inspector || "—"}
            </Link>
            <button type="button" className="wf-link" onClick={() => void workflowApi.downloadInspectionPdf(d.report!)}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </section>
      ) : null}

      {open ? (
        <section className="wf-actions">
          <h4>{t("wf.yourStep")}</h4>
          {!acts.length ? (
            <div className="wf-wait">{t("wf.waitingFor", { group: d.groups.map((g: WfGroup) => t(`wf.group.${g}`)).join(" / ") })}</div>
          ) : null}
          {acts.includes("fill") ? (
            <div className="wh-form-inline wf-inline-plain">
              <Link className="wf-btn is-primary" href={inspectionFormHref(d)} target="_blank">
                <ClipboardCheck size={14} /> {t("wf.insp.fill")}
              </Link>
              <span className="wh-muted">{t("wf.insp.fillHint")}</span>
            </div>
          ) : null}
          {acts.includes("link") && d.candidates.length ? (
            <div className="wf-section">
              <p className="wh-subdesc">{t("wf.insp.candidates")}</p>
              <ul className="wf-files">
                {d.candidates.map((c) => (
                  <li key={c.id}>
                    <Link className="wf-link" href={`/inspections?id=${c.id}`} target="_blank">
                      #{c.id} · {c.element_nr || "—"} · {formatDate(c.date)} · {c.inspector || "—"}
                    </Link>
                    <button type="button" className="wf-btn wf-btn-sm" disabled={run.isPending} onClick={() => go("link", { report_id: c.id })}>
                      <Link2 size={12} /> {t("wf.insp.link")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="wh-form-inline wf-inline-plain">
            <label className="wh-grow">
              {acts.includes("cancel") ? t("wf.insp.noteOrReason") : t("wf.note")}
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {acts.includes("send") ? (
              <button type="button" className="wf-btn is-primary" disabled={run.isPending} onClick={() => go("send")}>
                <Send size={14} /> {t("wf.insp.send")}
              </button>
            ) : null}
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
                  if (window.confirm(t("wf.confirmCancel"))) go("cancel");
                }}
              >
                <Ban size={14} /> {t("wf.action.cancel")}
              </button>
            ) : null}
          </div>
          {acts.includes("attach") ? (
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
          {error ? <div className="wf-alert">{error.message}</div> : null}
        </section>
      ) : null}

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
