"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Eraser, FileUp, GitBranch, History } from "lucide-react";
import { elementDashboardApi } from "@/lib/endpoints";
import type { ElementStage, ManualElementStage, PipelineItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { appAlert } from "@/lib/dialog";
import { useI18n } from "@/lib/i18n/context";
import type { ImportProgress } from "@/lib/endpoints";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ImportProgressBar } from "./import-progress";
import { Chips, ExportButton, StageBadge } from "./element-dashboard-ui";
import { ElementShopCartable } from "./element-shop-cartable";

const MANUAL: ManualElementStage[] = ["awaiting_disassembly", "awaiting_assembly", "assembling", "awaiting_qc", "ready"];
const FILTERS: (ElementStage | "shop" | "all")[] = [
  "shop",
  "decommissioned",
  "awaiting_disassembly",
  "disassembled",
  "awaiting_assembly",
  "assembling",
  "awaiting_qc",
  "ready",
  "installed",
  "in_service",
  "all",
];

function History_({ elementNr, onClose }: { elementNr: string; onClose: () => void }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ["element-dashboard", "events", elementNr], queryFn: () => elementDashboardApi.events(elementNr) });
  return (
    <div className="mon-panel">
      <div className="mon-panel-head">
        <h3 className="mon-panel-title">{t("elDash.historyOf", { nr: elementNr })}</h3>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
      {q.isLoading ? (
        <LoadingState />
      ) : !q.data?.length ? (
        <div className="mon-empty">{t("elDash.noMoves")}</div>
      ) : (
        <table className="ed-table">
          <tbody>
            {q.data.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.at)}</td>
                <td>
                  {e.from_stage ? `${t(`elDash.stage.${e.from_stage}`)} → ` : ""}
                  {e.to_stage === "clear" ? t("elDash.cleared") : t(`elDash.stage.${e.to_stage}`)}
                </td>
                <td>{e.user || "—"}</td>
                <td>{e.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ElementShopTab({ initialStage }: { initialStage?: string }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const editable = canEdit("elements");
  const operator = canEdit("wf_operation");
  const cellshop = canEdit("wf_cellshop");
  const moveTargets = MANUAL.filter((s) => (s === "awaiting_disassembly" ? operator : cellshop));
  const [stage, setStage] = useState<string>(initialStage || "shop");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<ManualElementStage>("awaiting_disassembly");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [history, setHistory] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const excelRef = useRef<HTMLInputElement>(null);

  const query = useQuery({
    queryKey: ["element-dashboard", "shop", stage, search],
    queryFn: () => elementDashboardApi.shop({ state: stage, q: search.trim() || undefined, limit: 600 }),
  });
  const counts = query.data?.counts;

  const startWf = useMutation({
    mutationFn: (nrs: string[]) =>
      elementDashboardApi.startProcess({ element_nrs: nrs, note: note.trim() || null, reason: note.trim() || null }),
    onSuccess: async (res) => {
      const failed = res.errors.length ? ` ${t("elDash.skipped", { count: res.errors.length })}: ${res.errors.map((e) => e.error).join("; ")}` : "";
      const text = `${t("elDash.processStarted", { count: res.started.length })}${failed}`;
      setMessage({ ok: res.errors.length === 0, text });
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["element-dashboard"] });
      void qc.invalidateQueries({ queryKey: ["wf"] });
      await appAlert(text);
      if (res.started.length === 1 && res.started[0].href) router.push(res.started[0].href);
    },
    onError: (err: Error) => setMessage({ ok: false, text: err.message }),
  });

  const move = useMutation({
    mutationFn: (payload: { nrs: string[]; stage: ManualElementStage | "clear" }) =>
      elementDashboardApi.move({ element_nrs: payload.nrs, stage: payload.stage, note: note.trim() || null }),
    onSuccess: (res) => {
      const failed = res.errors.length ? ` ${t("elDash.skipped", { count: res.errors.length })}: ${res.errors.map((e) => e.error).join("; ")}` : "";
      setMessage({ ok: res.errors.length === 0, text: `${t("elDash.moved", { count: res.moved.length })}${failed}` });
      setSelected(new Set());
      setTyped("");
      qc.invalidateQueries({ queryKey: ["element-dashboard"] });
    },
    onError: (err: Error) => setMessage({ ok: false, text: err.message }),
  });

  const rows = query.data?.items ?? [];
  const typedNrs = typed
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  function toggle(nr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nr)) next.delete(nr);
      else next.add(nr);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.element_nr))));
  }

  const chips = FILTERS.map((key) => ({
    key,
    label: t(key === "shop" ? "elDash.filter.shop" : key === "all" ? "elDash.filter.all" : `elDash.stage.${key}`),
    count: key === "shop" ? (counts ? counts.decommissioned + counts.awaiting_disassembly + counts.awaiting_assembly + counts.assembling + counts.awaiting_qc + counts.ready + counts.installed : undefined) : key === "all" ? counts?.total : counts?.[key],
  }));

  return (
    <div className="mon-page">
      <ElementShopCartable editable={editable} onPickStage={(k) => { setStage(k); setSelected(new Set()); }} />
      <p className="mon-help">{t("elDash.shopHelp")}</p>
      <Chips value={stage} options={chips} onChange={(k) => { setStage(k); setSelected(new Set()); }} />

      <div className="ed-filters">
        <label>
          {t("elDash.search")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("elDash.searchElementsHint")} />
        </label>
        <ExportButton
          filename={`elements-${stage}`}
          disabled={!rows.length}
          header={[t("elDash.col.element"), t("elDash.col.stage"), t("elDash.col.cell"), t("elDash.col.group"), t("elDash.col.anode"), t("elDash.col.cathode"), t("elDash.col.membrane"), t("elDash.col.membraneType"), t("elDash.col.since"), t("elDash.col.days"), t("elDash.col.note")]}
          rows={() =>
            rows.map((r) => [r.element_nr, t(`elDash.stage.${r.state}`), r.electrolyzer ? `${r.electrolyzer}-${r.position ?? ""}` : "", r.group_nr, r.anode_nr, r.cathode_nr, r.membrane_nr, r.membrane_type, r.since, r.days_in_state, r.note])
          }
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => elementDashboardApi.exportShopExcel({ state: stage, q: search.trim() || undefined }, `elements-${stage}`)}
        >
          {t("elDash.exportExcel")}
        </Button>
        {editable ? (
          <>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setProgress({ percent: 0, processed: 0, total: 0 });
                setMessage({ ok: true, text: t("elDash.importing", { name: file.name }) });
                elementDashboardApi
                  .importShopExcel(file, stage, setProgress)
                  .then(async (res) => {
                    await qc.invalidateQueries({ queryKey: ["element-dashboard"] });
                    const text = t("elDash.imported", {
                      updated: res.updated ?? 0,
                      created: res.created ?? 0,
                      moved: res.moved ?? 0,
                    });
                    setMessage({ ok: true, text });
                    await appAlert(text);
                  })
                  .catch(async (err: Error) => {
                    setMessage({ ok: false, text: err.message });
                    await appAlert(err.message);
                  })
                  .finally(() => {
                    setProgress(null);
                    if (excelRef.current) excelRef.current.value = "";
                  });
              }}
            />
            <Button type="button" variant="secondary" onClick={() => excelRef.current?.click()}>
              <FileUp className="h-4 w-4" />
              {t("elDash.importExcel")}
            </Button>
          </>
        ) : null}
      </div>

      <div className="ed-actionbar">
        <Button type="button" disabled={!selected.size || startWf.isPending} onClick={() => startWf.mutate([...selected])}>
          <GitBranch className="h-4 w-4" />
          {t("elDash.startProcess", { count: selected.size })}
          {" — "}
          {t(`elDash.process.${FILTERS.includes(stage as ElementStage | "shop" | "all") ? stage : "shop"}`)}
        </Button>
        <span className="text-xs text-[var(--win-muted)]">{t("elDash.startProcessHint")}</span>
      </div>
      {moveTargets.length ? (
        <div className="ed-actionbar">
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.moveTo")}</span>
            <select className="mon-select" value={moveTargets.includes(target) ? target : moveTargets[0]} onChange={(e) => setTarget(e.target.value as ManualElementStage)}>
              {moveTargets.map((s) => (
                <option key={s} value={s}>
                  {t(`elDash.stage.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("elDash.noteHint")} />
          </label>
          <Button type="button" disabled={!selected.size || move.isPending} onClick={() => move.mutate({ nrs: [...selected], stage: moveTargets.includes(target) ? target : moveTargets[0] })}>
            <ArrowRightLeft className="h-4 w-4" />
            {t("elDash.moveSelected", { count: selected.size })}
          </Button>
          <Button type="button" variant="secondary" disabled={!selected.size || move.isPending} onClick={() => move.mutate({ nrs: [...selected], stage: "clear" })}>
            <Eraser className="h-4 w-4" />
            {t("elDash.clearStage")}
          </Button>
          <label className="ed-filters">
            <span className="text-xs font-bold">{t("elDash.byNumbers")}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("elDash.byNumbersHint")} style={{ minWidth: "16rem" }} />
          </label>
          <Button type="button" variant="secondary" disabled={!typedNrs.length || move.isPending} onClick={() => move.mutate({ nrs: typedNrs, stage: moveTargets.includes(target) ? target : moveTargets[0] })}>
            {t("elDash.moveTyped", { count: typedNrs.length })}
          </Button>
        </div>
      ) : null}
      {progress ? <ImportProgressBar progress={progress} /> : null}
      {message ? <p className={`ed-note ${message.ok ? "is-ok" : "is-danger"}`}>{message.text}</p> : null}

      {query.isLoading ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={(query.error as Error).message} />
      ) : rows.length === 0 ? (
        <div className="mon-empty">{t("elDash.noElementsHere")}</div>
      ) : (
        <>
          <div className="ed-table-wrap">
            <table className="ed-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} aria-label={t("elDash.selectAll")} />
                  </th>
                  <th>{t("elDash.col.element")}</th>
                  <th>{t("elDash.col.stage")}</th>
                  <th>{t("elDash.col.cell")}</th>
                  <th>{t("elDash.col.group")}</th>
                  <th>{t("elDash.col.anode")}</th>
                  <th>{t("elDash.col.cathode")}</th>
                  <th>{t("elDash.col.membrane")}</th>
                  <th>{t("elDash.col.since")}</th>
                  <th>{t("elDash.col.days")}</th>
                  <th>{t("elDash.col.note")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r: PipelineItem) => (
                  <tr key={r.key} className={selected.has(r.element_nr) ? "is-selected" : undefined}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.element_nr)} onChange={() => toggle(r.element_nr)} aria-label={r.element_nr} />
                    </td>
                    <td>
                      <strong>{r.element_nr}</strong>
                    </td>
                    <td>
                      <StageBadge stage={r.state} />
                      {r.source === "inspection" ? <span className="ed-mute ms-1 text-[10px]">{t("elDash.fromInspection")}</span> : null}
                      {r.source === "auto" ? <span className="ed-mute ms-1 text-[10px]">{t("elDash.cartable.auto")}</span> : null}
                    </td>
                    <td>{r.electrolyzer ? `${r.electrolyzer}-${r.position ?? ""}` : "—"}</td>
                    <td>{r.group_nr || "—"}</td>
                    <td>{r.anode_nr || "—"}</td>
                    <td>{r.cathode_nr || "—"}</td>
                    <td>{r.membrane_nr || "—"}</td>
                    <td>{formatDate(r.since)}</td>
                    <td className="ed-num">{r.days_in_state ?? "—"}</td>
                    <td title={r.updated_by ? `${t("elDash.col.user")}: ${r.updated_by}` : undefined}>{r.note || ""}</td>
                    <td>
                      <button type="button" className="mon-history-link" onClick={() => setHistory(r.element_nr)} title={t("elDash.history")}>
                        <History className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data?.truncated ? <p className="mon-sub">{t("elDash.truncated", { count: rows.length })}</p> : null}
        </>
      )}
      {history ? <History_ elementNr={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}
