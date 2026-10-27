"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";
import { workflowApi, workflowHref, type ProcessLogRow, type WfFlow } from "@/lib/workflow";

const FLOWS: WfFlow[] = ["coating", "purchase", "cell", "inspection", "assemble", "workorder"];

export function ProcessHistoryPanel() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [flow, setFlow] = useState("");
  const [active, setActive] = useState<ProcessLogRow | null>(null);
  const list = useQuery({
    queryKey: ["wf", "process-log", q, flow],
    queryFn: () => workflowApi.processLog({ q: q.trim() || undefined, flow: flow || undefined }),
  });
  const detail = useQuery({
    queryKey: ["wf", "process-log", active?.flow, active?.id],
    queryFn: () => workflowApi.processLogDetail(active!.flow, active!.id),
    enabled: !!active,
  });

  const columns: Column<ProcessLogRow & { _key: string }>[] = [
    { key: "code", header: t("wf.col.code"), render: (row) => <strong className="en">{row.code}</strong> },
    { key: "flow", header: t("wf.col.flow"), render: (row) => t(`wf.flow.${row.flow}`) },
    { key: "element_nr", header: t("wo.elementNr"), render: (row) => row.element_nr || "—" },
    { key: "status", header: t("wf.col.status"), render: (row) => t(`wf.status.${row.status}`) },
    { key: "summary", header: t("wf.plog.work"), render: (row) => row.summary || "—" },
    { key: "updated_at", header: t("wo.updated"), render: (row) => formatDateTime(row.updated_at) },
  ];

  const open = detail.data;
  return (
    <div className="plog">
      <header className="wo-hero">
        <div>
          <h2>{t("wf.plog.title")}</h2>
          <p>{t("wf.plog.hint")}</p>
        </div>
      </header>
      <div className="wo-toolbar">
        <Input value={q} placeholder={t("wf.plog.search")} onChange={(event) => setQ(event.target.value)} />
        <select className="ui-input" value={flow} onChange={(event) => setFlow(event.target.value)}>
          <option value="">{t("wf.plog.allFlows")}</option>
          {FLOWS.map((key) => (
            <option key={key} value={key}>
              {t(`wf.flow.${key}`)}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={columns}
        data={(list.data || []).map((row) => ({ ...row, _key: `${row.flow}-${row.code}-${row.id}` }))}
        keyField="_key"
        isLoading={list.isLoading}
        emptyTitle={t("wf.plog.empty")}
        onRowClick={(row) => setActive(row)}
      />
      {active ? (
        <section className="plog-detail">
          <div className="plog-detail-head">
            <div>
              <strong className="en">{active.code}</strong>
              <span>{t(`wf.flow.${active.flow}`)}</span>
              <span>{t(`wf.status.${open?.status || active.status}`)}</span>
            </div>
            <Link href={workflowHref(active.flow, active.id)}>{t("wf.plog.open")}</Link>
          </div>
          {open?.codes && open.codes.length > 1 ? <p className="en">{open.codes.join(" · ")}</p> : null}
          <h3>{t("wf.plog.steps")}</h3>
          {detail.isLoading ? <p>{t("common.loading")}</p> : null}
          {(open?.events || []).length === 0 && !detail.isLoading ? <p>{t("wf.plog.noSteps")}</p> : null}
          <ol className="plog-steps">
            {(open?.events || []).map((event) => (
              <li key={event.id}>
                <strong>{event.action}</strong>
                <span>
                  {event.from_status || "—"} → {event.to_status || "—"}
                </span>
                <span>{event.actor || "—"}</span>
                <span>{formatDateTime(event.created_at)}</span>
                {event.note ? <em>{event.note}</em> : null}
              </li>
            ))}
          </ol>
          {(open?.work || []).length ? (
            <>
              <h3>{t("wf.plog.work")}</h3>
              <ul className="plog-work">
                {open!.work.map((row, index) => (
                  <li key={index}>
                    {Object.entries(row)
                      .filter(([, value]) => value != null && value !== "")
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
