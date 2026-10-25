"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { SLA_STAGES, workflowApi, type WfFlow, type WfSlaConfig } from "@/lib/workflow";

const FLOWS: WfFlow[] = ["assemble", "inspection", "cell", "coating", "purchase"];

function SlaForm({ initial }: { initial: WfSlaConfig }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [hours, setHours] = useState(initial.hours);
  const [warn, setWarn] = useState(initial.warn_percent);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => workflowApi.saveSettings({ hours, warn_percent: warn }),
    onSuccess: (data) => {
      qc.setQueryData(["wf", "settings"], data);
      void qc.invalidateQueries({ queryKey: ["wf"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    },
  });
  const set = (flow: string, stage: string, value: number) => setHours((h) => ({ ...h, [flow]: { ...h[flow], [stage]: value } }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("wfSla.hint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wf-warn">{t("wfSla.warnPercent")}</Label>
          <Input id="wf-warn" type="number" min={1} max={90} value={warn} onChange={(e) => setWarn(Math.min(90, Math.max(1, Number(e.target.value) || 25)))} />
        </div>
        <div className="wf-sla-legend">
          <span className="is-ok">{t("wf.sla.state.ok")}</span>
          <span className="is-warn">{t("wfSla.warnLegend", { n: warn })}</span>
          <span className="is-late">{t("wf.sla.state.late")}</span>
        </div>
      </div>
      {FLOWS.map((flow) => (
        <Card key={flow}>
          <CardHeader>
            <CardTitle>{t(`wf.flow.${flow}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="wf-table wf-sla-table">
              <thead>
                <tr>
                  <th>{t("wfSla.stage")}</th>
                  <th>{t("wfSla.owner")}</th>
                  <th>{t("wfSla.hours")}</th>
                  <th>{t("wfSla.days")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {SLA_STAGES[flow].map((stage) => {
                  const value = hours[flow]?.[stage] ?? 0;
                  const def = initial.defaults?.[flow]?.[stage];
                  return (
                    <tr key={stage}>
                      <td>{t(`wf.status.${stage}`)}</td>
                      <td>{t(`wf.stageGroup.${flow}.${stage}`)}</td>
                      <td>
                        <Input type="number" min={1} max={8760} value={value} onChange={(e) => set(flow, stage, Math.max(1, Number(e.target.value) || 1))} />
                      </td>
                      <td>{(value / 24).toFixed(value % 24 ? 1 : 0)}</td>
                      <td>
                        {def != null && def !== value ? (
                          <button type="button" className="wf-link" title={t("wfSla.reset", { n: def })} onClick={() => set(flow, stage, def)}>
                            <RotateCcw size={13} /> {def}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">{t("wfSla.promisedNote")}</p>
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> {t("common.save")}
        </Button>
        {saved ? <span className="text-sm text-emerald-600">{t("wfSla.saved")}</span> : null}
        {save.error ? <span className="text-sm text-rose-600">{(save.error as Error).message}</span> : null}
      </div>
    </div>
  );
}

/** Deadline of every workflow stage (hours) and the share of the window that turns a cartable item amber. */
export function WorkflowSlaTab() {
  const settings = useQuery({ queryKey: ["wf", "settings"], queryFn: workflowApi.settings });
  if (settings.isLoading) return <LoadingState />;
  if (settings.isError) return <ErrorState message={(settings.error as Error).message} />;
  return settings.data ? <SlaForm initial={settings.data} /> : null;
}
