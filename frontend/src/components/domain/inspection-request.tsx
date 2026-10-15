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
