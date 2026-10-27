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
import { Tabs } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth/context";
import {
  workOrdersApi,
  type WoLaborLine,
  type WoPerson,
  type WoStage,
  type WorkOrderDetail,
  type WorkOrderSummary,
  type WorkOrderWrite,
} from "@/lib/endpoints";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";
import { refreshWarehouseData } from "@/lib/workflow";
import { ActualRows, JobRows, emptyActual, emptyJob } from "./work-order-labor";

const STAGES: WoStage[] = ["generation", "install", "pickup", "store", "disassemble"];

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
  jobs: Record<WoStage, WoLaborLine[]>;
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
      generation: [emptyActual("generation")],
      install: [emptyActual("install")],
      pickup: [emptyActual("pickup")],
      store: [emptyActual("store")],
      disassemble: [emptyActual("disassemble")],
    },
    jobs: {
      generation: [emptyJob("generation")],
      install: [emptyJob("install")],
      pickup: [emptyJob("pickup")],
      store: [emptyJob("store")],
      disassemble: [emptyJob("disassemble")],
    },
  };
}

function fromDetail(d: WorkOrderDetail): FormState {
  const labors = blankForm().labors;
  const jobs = blankForm().jobs;
  for (const stage of STAGES) {
    const all = d.labors?.[stage] || [];
    const act = all.filter((r) => r.kind !== "job");
    const job = all.filter((r) => r.kind === "job");
    labors[stage] = act.length ? act.map((r) => ({ ...r, stage })) : [emptyActual(stage)];
    jobs[stage] = job.length ? job.map((r) => ({ ...r, stage })) : [emptyJob(stage)];
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
    jobs,
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
    labors: [...flattenLabors(form.jobs), ...flattenLabors(form.labors)],
  };
}

function stageDate(form: FormState, stage: WoStage) {
  if (stage === "generation") return form.generation_date;
  if (stage === "install") return form.install_date;
  if (stage === "pickup") return form.pickup_date;
  if (stage === "store") return form.store_date;
  return form.disassemble_date;
}

function latestStarted(form: FormState): WoStage {
  const started = STAGES.filter((stage) => Boolean(stageDate(form, stage)));
  return started[started.length - 1] || "generation";
}

function StageFields({
  stage,
  form,
  setForm,
  skills,
  people,
  editable,
  t,
  fa,
}: {
  stage: WoStage;
  form: FormState;
  setForm: (f: FormState) => void;
  skills: string[];
  people: WoPerson[];
  editable: boolean;
  t: (k: string, vars?: Record<string, string | number>) => string;
  fa: (fa: string, en: string) => string;
}) {
  const patch = (p: Partial<FormState>) => setForm({ ...form, ...p });
  const started = Boolean(stageDate(form, stage));
  return (
    <section className={`wo-stage${started ? " is-done" : " is-pending"}`}>
      <h3>{t(`wo.stage.${stage}`)}</h3>
      <p className="wo-stage-hint">{started ? t("wo.processOpen") : t("wo.processWait")}</p>
      {stage === "install" ? (
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
      ) : (
        <label className="wo-date">
          <span>{t("wo.date")}</span>
          <DateInput
            type="date"
            value={stageDate(form, stage)}
            disabled={!editable}
            onChange={(e) => {
              const value = e.target.value;
              if (stage === "generation") patch({ generation_date: value });
              else if (stage === "pickup") patch({ pickup_date: value });
              else if (stage === "store") patch({ store_date: value });
              else patch({ disassemble_date: value });
            }}
          />
        </label>
      )}
      <JobRows
        stage={stage}
        rows={form.jobs[stage]}
        skills={skills}
        editable={editable}
        onChange={(rows) => patch({ jobs: { ...form.jobs, [stage]: rows } })}
        fa={fa}
      />
      <ActualRows
        stage={stage}
        rows={form.labors[stage]}
        skills={skills}
        people={people}
        editable={editable}
        onChange={(rows) => patch({ labors: { ...form.labors, [stage]: rows } })}
        fa={fa}
      />
    </section>
  );
}

function WorkOrderForm({
  form,
  setForm,
  skills,
  people,
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
  people: WoPerson[];
  editable: boolean;
  code?: string | null;
  status?: string | null;
  history?: { id: number; code: string; status: string; seq: number; processes: Record<string, string | null> }[];
  t: (k: string, vars?: Record<string, string | number>) => string;
  onOpenHistory?: (id: number) => void;
}) {
  const { locale } = useI18n();
  const fa = (f: string, e: string) => (locale === "fa" ? f : e);
  const patch = (p: Partial<FormState>) => setForm({ ...form, ...p });
  const [tab, setTab] = useState<WoStage>(() => latestStarted(form));
  useEffect(() => {
    setTab(latestStarted(form));
    // Only when switching work orders — typing the element number must not change tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
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

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as WoStage)}
        tabs={STAGES.map((stage) => ({
          key: stage,
          label: `${t(`wo.tab.${stage}`)}${stageDate(form, stage) ? " ✓" : ""}`,
          content: (
            <StageFields
              stage={stage}
              form={form}
              setForm={setForm}
              skills={skills}
              people={people}
              editable={editable}
              t={t}
              fa={fa}
            />
          ),
        }))}
      />

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
  const people = meta.data?.people || [];
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
              people={people}
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
