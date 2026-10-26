"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import {
  workOrdersApi,
  type WoLaborLine,
  type WoStage,
  type WorkOrderDetail,
  type WorkOrderSummary,
  type WorkOrderWrite,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { refreshWarehouseData } from "@/lib/workflow";

const STAGES: WoStage[] = ["generation", "install", "pickup", "store", "disassemble"];

function emptyLabor(stage: WoStage): WoLaborLine {
  return {
    stage,
    person_code: "",
    person_name: "",
    skill: "",
    work_hours: null,
    work_qty: "",
    description: "",
  };
}

function flattenLabors(byStage: Record<string, WoLaborLine[]> | undefined): WoLaborLine[] {
  const out: WoLaborLine[] = [];
  for (const stage of STAGES) {
    for (const row of byStage?.[stage] || []) out.push({ ...row, stage });
  }
  return out;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  report_date: string;
  element_nr: string;
  anode_nr: string;
  cathode_nr: string;
  membrane_nr: string;
  generation_date: string;
  install_date: string;
  install_cell: string;
  pickup_date: string;
  store_date: string;
  disassemble_date: string;
  remarks: string;
  labors: Record<WoStage, WoLaborLine[]>;
};

function blankForm(): FormState {
  return {
    report_date: todayIso(),
    element_nr: "",
    anode_nr: "",
    cathode_nr: "",
    membrane_nr: "",
    generation_date: "",
    install_date: "",
    install_cell: "",
    pickup_date: "",
    store_date: "",
    disassemble_date: "",
    remarks: "",
    labors: {
      generation: [emptyLabor("generation")],
      install: [emptyLabor("install")],
      pickup: [emptyLabor("pickup")],
      store: [emptyLabor("store")],
      disassemble: [emptyLabor("disassemble")],
    },
  };
}

function fromDetail(d: WorkOrderDetail): FormState {
  const labors = blankForm().labors;
  for (const stage of STAGES) {
    const rows = d.labors?.[stage] || [];
    labors[stage] = rows.length ? rows.map((r) => ({ ...r, stage })) : [emptyLabor(stage)];
  }
  return {
    report_date: d.report_date || "",
    element_nr: d.element_nr || "",
    anode_nr: d.anode_nr || "",
    cathode_nr: d.cathode_nr || "",
    membrane_nr: d.membrane_nr || "",
    generation_date: d.generation_date || "",
    install_date: d.install_date || "",
    install_cell: d.install_cell || "",
    pickup_date: d.pickup_date || "",
    store_date: d.store_date || "",
    disassemble_date: d.disassemble_date || "",
    remarks: d.remarks || "",
    labors,
  };
}

function toWrite(form: FormState): WorkOrderWrite {
  return {
    report_date: form.report_date || null,
    element_nr: form.element_nr.trim(),
    anode_nr: form.anode_nr.trim() || null,
    cathode_nr: form.cathode_nr.trim() || null,
    membrane_nr: form.membrane_nr.trim() || null,
    generation_date: form.generation_date || null,
    install_date: form.install_date || null,
    install_cell: form.install_cell.trim() || null,
    pickup_date: form.pickup_date || null,
    store_date: form.store_date || null,
    disassemble_date: form.disassemble_date || null,
    remarks: form.remarks.trim() || null,
    labors: flattenLabors(form.labors),
  };
}

function LaborRows({
  stage,
  rows,
  skills,
  editable,
  onChange,
  t,
}: {
  stage: WoStage;
  rows: WoLaborLine[];
  skills: string[];
  editable: boolean;
  onChange: (rows: WoLaborLine[]) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const setRow = (idx: number, patch: Partial<WoLaborLine>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch, stage } : r)));
  };
  return (
    <div className="wo-labors">
      {rows.map((row, idx) => (
        <div key={`${stage}-${idx}`} className="wo-labor-row">
          <label>
            <span>{t("wo.personCode")}</span>
            <Input
              value={row.person_code || ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { person_code: e.target.value })}
            />
          </label>
          <label>
            <span>{t("wo.personName")}</span>
            <Input
              value={row.person_name || ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { person_name: e.target.value })}
            />
          </label>
          <label>
            <span>{t("wo.skill")}</span>
            <select
              className="ui-input"
              value={row.skill || ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { skill: e.target.value })}
            >
              <option value="">—</option>
              {skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("wo.workHours")}</span>
            <Input
              type="number"
              step="0.25"
              min="0"
              value={row.work_hours ?? ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { work_hours: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            <span>{t("wo.workQty")}</span>
            <Input
              value={row.work_qty || ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { work_qty: e.target.value })}
            />
          </label>
          <label className="wo-span-2">
            <span>{t("wo.description")}</span>
            <Input
              value={row.description || ""}
              disabled={!editable}
              onChange={(e) => setRow(idx, { description: e.target.value })}
            />
          </label>
          {editable ? (
            <button
              type="button"
              className="wo-icon-btn"
              title={t("common.delete")}
              onClick={() => onChange(rows.length <= 1 ? [emptyLabor(stage)] : rows.filter((_, i) => i !== idx))}
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </div>
      ))}
      {editable ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, emptyLabor(stage)])}>
          <Plus size={14} /> {t("wo.addLabor")}
        </Button>
      ) : null}
    </div>
  );
}

function WorkOrderForm({
  form,
  setForm,
  skills,
  editable,
  code,
  status,
  history,
  t,
  onOpenHistory,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  skills: string[];
  editable: boolean;
  code?: string | null;
  status?: string | null;
  history?: { id: number; code: string; status: string; seq: number; processes: Record<string, string | null> }[];
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpenHistory?: (id: number) => void;
}) {
  const patch = (p: Partial<FormState>) => setForm({ ...form, ...p });
  const stageDone = (stage: WoStage) => {
    if (stage === "generation") return Boolean(form.generation_date);
    if (stage === "install") return Boolean(form.install_date);
    if (stage === "pickup") return Boolean(form.pickup_date);
    if (stage === "store") return Boolean(form.store_date);
    return Boolean(form.disassemble_date);
  };
  return (
    <div className="wo-form">
      <div className="wo-head">
        {code ? (
          <div className="wo-code">
            <span className="wo-kicker">{t("wo.code")}</span>
            <strong className="en">{code}</strong>
            {status ? <span className="wo-status">{t(`wo.status.${status}`)}</span> : null}
          </div>
        ) : null}
        {history && history.length > 1 ? (
          <div className="wo-history">
            <span className="wo-kicker">{t("wo.history")}</span>
            <div className="wo-history-list">
              {history.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`wo-history-item${code === row.code ? " is-current" : ""}`}
                  onClick={() => onOpenHistory?.(row.id)}
                >
                  <strong className="en">{row.code}</strong>
                  <span>{t(`wo.status.${row.status}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="wo-grid-4">
          <label>
            <span>{t("wo.reportDate")}</span>
            <DateInput type="date" value={form.report_date} disabled={!editable} onChange={(e) => patch({ report_date: e.target.value })} />
          </label>
          <label>
            <span>{t("wo.elementNr")}</span>
            <Input
              value={form.element_nr}
              disabled={!editable || !!code}
              onChange={(e) => patch({ element_nr: e.target.value })}
              required
            />
          </label>
          <label>
            <span>{t("wo.anodeNr")}</span>
            <Input value={form.anode_nr} disabled={!editable} onChange={(e) => patch({ anode_nr: e.target.value })} />
          </label>
          <label>
            <span>{t("wo.cathodeNr")}</span>
            <Input value={form.cathode_nr} disabled={!editable} onChange={(e) => patch({ cathode_nr: e.target.value })} />
          </label>
          <label>
            <span>{t("wo.membraneNr")}</span>
            <Input value={form.membrane_nr} disabled={!editable} onChange={(e) => patch({ membrane_nr: e.target.value })} />
          </label>
        </div>
      </div>

      <section className={`wo-stage${stageDone("generation") ? " is-done" : " is-pending"}`}>
        <h3>{t("wo.stage.generation")}</h3>
        <label className="wo-date">
          <span>{t("wo.date")}</span>
          <DateInput type="date" value={form.generation_date} disabled={!editable} onChange={(e) => patch({ generation_date: e.target.value })} />
        </label>
        <LaborRows
          stage="generation"
          rows={form.labors.generation}
          skills={skills}
          editable={editable}
          onChange={(rows) => patch({ labors: { ...form.labors, generation: rows } })}
          t={t}
        />
      </section>

      <section className={`wo-stage${stageDone("install") ? " is-done" : " is-pending"}`}>
        <h3>{t("wo.stage.install")}</h3>
        <div className="wo-grid-2">
          <label>
            <span>{t("wo.installCell")}</span>
            <Input value={form.install_cell} disabled={!editable} onChange={(e) => patch({ install_cell: e.target.value })} />
          </label>
          <label>
            <span>{t("wo.date")}</span>
            <DateInput type="date" value={form.install_date} disabled={!editable} onChange={(e) => patch({ install_date: e.target.value })} />
          </label>
        </div>
        <LaborRows
          stage="install"
          rows={form.labors.install}
          skills={skills}
          editable={editable}
          onChange={(rows) => patch({ labors: { ...form.labors, install: rows } })}
          t={t}
        />
      </section>

      <section className={`wo-stage${stageDone("pickup") ? " is-done" : " is-pending"}`}>
        <h3>{t("wo.stage.pickup")}</h3>
        <label className="wo-date">
          <span>{t("wo.date")}</span>
          <DateInput type="date" value={form.pickup_date} disabled={!editable} onChange={(e) => patch({ pickup_date: e.target.value })} />
        </label>
        <LaborRows
          stage="pickup"
          rows={form.labors.pickup}
          skills={skills}
          editable={editable}
          onChange={(rows) => patch({ labors: { ...form.labors, pickup: rows } })}
          t={t}
        />
      </section>

      <section className={`wo-stage${stageDone("store") ? " is-done" : " is-pending"}`}>
        <h3>{t("wo.stage.store")}</h3>
        <label className="wo-date">
          <span>{t("wo.date")}</span>
          <DateInput type="date" value={form.store_date} disabled={!editable} onChange={(e) => patch({ store_date: e.target.value })} />
        </label>
        <LaborRows
          stage="store"
          rows={form.labors.store}
          skills={skills}
          editable={editable}
          onChange={(rows) => patch({ labors: { ...form.labors, store: rows } })}
          t={t}
        />
      </section>

      <section className={`wo-stage${stageDone("disassemble") ? " is-done" : " is-pending"}`}>
        <h3>{t("wo.stage.disassemble")}</h3>
        <label className="wo-date">
          <span>{t("wo.date")}</span>
          <DateInput type="date" value={form.disassemble_date} disabled={!editable} onChange={(e) => patch({ disassemble_date: e.target.value })} />
        </label>
        <LaborRows
          stage="disassemble"
          rows={form.labors.disassemble}
          skills={skills}
          editable={editable}
          onChange={(rows) => patch({ labors: { ...form.labors, disassemble: rows } })}
          t={t}
        />
      </section>

      <label className="wo-remarks">
        <span>{t("fields.remarks")}</span>
        <textarea
          className="ui-input"
          rows={3}
          value={form.remarks}
          disabled={!editable}
          onChange={(e) => patch({ remarks: e.target.value })}
        />
      </label>
    </div>
  );
}

export function WorkOrderPanel() {
  const { t } = useI18n();
  const { canEdit, canView, isAdmin } = useAuth();
  const allowed = isAdmin || canView("wf_planner") || canView("wf_c90") || canView("wf_cellshop") || canView("elements");
  const editable = isAdmin || canEdit("wf_planner");
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const openId = Number(params.get("id") || 0) || null;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [activeId, setActiveId] = useState<number | null>(openId);

  const meta = useQuery({ queryKey: ["wo", "meta"], queryFn: workOrdersApi.meta, enabled: allowed });
  const list = useQuery({
    queryKey: ["wo", "list", q, status],
    queryFn: () => workOrdersApi.list({ q: q || undefined, status: status || undefined }),
    enabled: allowed,
  });
  const detail = useQuery({
    queryKey: ["wo", "detail", activeId],
    queryFn: () => workOrdersApi.get(activeId!),
    enabled: allowed && !!activeId,
  });

  useEffect(() => {
    setActiveId(openId);
  }, [openId]);

  useEffect(() => {
    if (detail.data) setForm(fromDetail(detail.data));
  }, [detail.data]);

  const skills = meta.data?.skills || [];
  const canWrite = editable && (meta.data?.can_edit ?? editable);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = toWrite(form);
      if (!payload.element_nr) throw new Error(t("wo.needElement"));
      if (activeId) return workOrdersApi.update(activeId, payload);
      return workOrdersApi.create(payload);
    },
    onSuccess: (row) => {
      refreshWarehouseData(qc);
      void qc.invalidateQueries({ queryKey: ["wo"] });
      setCreating(false);
      setActiveId(row.id);
      router.replace(`/work-orders?id=${row.id}`);
    },
  });

  const completeMut = useMutation({
    mutationFn: () => workOrdersApi.complete(activeId!),
    onSuccess: () => {
      refreshWarehouseData(qc);
      void qc.invalidateQueries({ queryKey: ["wo"] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: () => workOrdersApi.cancel(activeId!),
    onSuccess: () => {
      refreshWarehouseData(qc);
      void qc.invalidateQueries({ queryKey: ["wo"] });
    },
  });

  const columns: Column<WorkOrderSummary>[] = useMemo(
    () => [
      { key: "code", header: t("wo.code"), render: (r) => <span className="en">{r.code}</span> },
      { key: "element_nr", header: t("wo.elementNr") },
      { key: "anode_nr", header: t("wo.anodeNr"), render: (r) => r.anode_nr || "—" },
      { key: "cathode_nr", header: t("wo.cathodeNr"), render: (r) => r.cathode_nr || "—" },
      {
        key: "status",
        header: t("wo.statusLabel"),
        render: (r) => t(`wo.status.${r.status}`),
      },
      {
        key: "processes",
        header: t("wo.processes"),
        render: (r) => (
          <span className="wo-pills">
            {STAGES.map((stage) => (
              <span key={stage} className={`wo-pill${r.processes?.[stage] ? " is-on" : ""}`} title={t(`wo.stage.${stage}`)}>
                {t(`wo.stage.${stage}`)}
              </span>
            ))}
          </span>
        ),
        filterText: (r) => (r.process_keys || []).join(" "),
      },
      {
        key: "actual_date",
        header: t("wo.date"),
        render: (r) => formatDate(r.actual_date),
      },
      { key: "updated_at", header: t("wo.updated"), render: (r) => formatDate(r.updated_at) },
    ],
    [t]
  );

  if (!allowed) return <ErrorState message={t("wo.noAccess")} />;
  if (list.isLoading || meta.isLoading) return <LoadingState />;
  if (list.isError) return <ErrorState message={(list.error as Error).message} />;

  const open = creating || !!activeId;
  const closed = detail.data?.status === "completed" || detail.data?.status === "cancelled";
  const formEditable = canWrite && !closed && (creating || !!activeId);

  return (
    <div className="wo">
      <header className="wo-hero">
        <div>
          <div className="wo-kicker">{t("wo.kicker")}</div>
          <h2>{t("wo.title")}</h2>
          <p>{t("wo.subtitle")}</p>
        </div>
        {canWrite ? (
          <Button
            type="button"
            onClick={() => {
              setCreating(true);
              setActiveId(null);
              setForm(blankForm());
              router.replace("/work-orders");
            }}
          >
            <Plus size={16} /> {t("wo.new")}
          </Button>
        ) : null}
      </header>

      <div className="wo-toolbar">
        <Input placeholder={t("wo.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="ui-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("wo.allStatuses")}</option>
          <option value="open">{t("wo.status.open")}</option>
          <option value="completed">{t("wo.status.completed")}</option>
          <option value="cancelled">{t("wo.status.cancelled")}</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={list.data || []}
        keyField="id"
        onRowClick={(r) => {
          setCreating(false);
          setActiveId(r.id);
          router.replace(`/work-orders?id=${r.id}`);
        }}
      />

      <Modal
        open={open}
        onClose={() => {
          setCreating(false);
          setActiveId(null);
          router.replace("/work-orders");
        }}
        title={creating ? t("wo.new") : detail.data?.code || t("wo.title")}
        wide
      >
        {activeId && detail.isLoading ? <LoadingState /> : null}
        {activeId && detail.isError ? <ErrorState message={(detail.error as Error).message} /> : null}
        {(creating || detail.data) && (
          <>
            <WorkOrderForm
              form={form}
              setForm={setForm}
              skills={skills}
              editable={!!formEditable}
              code={creating ? null : detail.data?.code}
              status={creating ? "open" : detail.data?.status}
              history={creating ? [] : detail.data?.element_history}
              t={t}
              onOpenHistory={(id) => {
                setCreating(false);
                setActiveId(id);
                router.replace(`/work-orders?id=${id}`);
              }}
            />
            {formEditable ? (
              <div className="wo-actions">
                <Button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  {t("common.save")}
                </Button>
                {activeId && !closed ? (
                  <>
                    <Button type="button" variant="secondary" onClick={() => completeMut.mutate()} disabled={completeMut.isPending}>
                      {t("wo.complete")}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
                      {t("wo.cancel")}
                    </Button>
                  </>
                ) : null}
                {saveMut.isError ? <ErrorState message={(saveMut.error as Error).message} /> : null}
              </div>
            ) : null}
          </>
        )}
      </Modal>
    </div>
  );
}
