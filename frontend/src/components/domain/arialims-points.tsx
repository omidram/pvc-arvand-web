"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Search, Trash2 } from "lucide-react";
import { ariaLimsSyncApi } from "@/lib/endpoints";
import type { AriaLimsPreview, AriaLimsSamplingPoint } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/spinner";
import { appConfirm } from "@/lib/dialog";
import { useI18n } from "@/lib/i18n/context";

const TYPES = ["anolyte", "catholyte", "pure_brine", "chlorine_gas", "hydrogen", "hcl", "demin_water", "caustic_feed"];
const SCOPES: [string, string][] = [
  ["total_plant", "scopeTotalPlant"],
  ["sub_plant", "scopeSubPlant"],
  ["electrolyzer", "scopeElectrolyzer"],
  ["group", "scopeGroup"],
  ["element", "scopeElement"],
];

type Draft = {
  id: number | null;
  scid: string;
  name: string;
  analysis_type: string;
  scope: string;
  electrolyzer: string;
  position: string;
  group_nr: string;
  sub_plant: string;
  parameter_map: Record<string, string>;
  enabled: boolean;
};

const EMPTY: Draft = {
  id: null,
  scid: "",
  name: "",
  analysis_type: "anolyte",
  scope: "total_plant",
  electrolyzer: "",
  position: "",
  group_nr: "",
  sub_plant: "",
  parameter_map: {},
  enabled: true,
};

function fromPoint(p: AriaLimsSamplingPoint): Draft {
  return {
    id: p.id,
    scid: String(p.scid),
    name: p.name || "",
    analysis_type: p.analysis_type,
    scope: p.scope,
    electrolyzer: p.electrolyzer || "",
    position: p.position || "",
    group_nr: p.group_nr || "",
    sub_plant: p.sub_plant || "",
    parameter_map: p.parameter_map || {},
    enabled: p.enabled,
  };
}

function targetLabel(p: AriaLimsSamplingPoint): string {
  if (p.scope === "element") return [p.electrolyzer, p.position].filter(Boolean).join(" / ");
  if (p.scope === "electrolyzer") return p.electrolyzer || "";
  if (p.scope === "group") return p.group_nr || "";
  if (p.scope === "sub_plant") return p.sub_plant || "";
  return "";
}

export function AriaLimsPoints() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState<AriaLimsPreview | null>(null);
  const [saved, setSaved] = useState(false);

  const points = useQuery({ queryKey: ["arialims-points"], queryFn: () => ariaLimsSyncApi.listPoints() });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const previewMutation = useMutation({
    mutationFn: () => ariaLimsSyncApi.preview(Number(draft.scid), 7),
    onSuccess: (data) => {
      setPreview(data);
      setDraft((d) => ({ ...d, name: d.name || data.name || "" }));
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        scid: Number(draft.scid),
        name: draft.name || null,
        analysis_type: draft.analysis_type,
        scope: draft.scope,
        electrolyzer: draft.scope === "electrolyzer" || draft.scope === "element" ? draft.electrolyzer || null : null,
        position: draft.scope === "element" ? draft.position || null : null,
        group_nr: draft.scope === "group" ? draft.group_nr || null : null,
        sub_plant: draft.scope === "sub_plant" ? draft.sub_plant || null : null,
        parameter_map: draft.parameter_map,
        enabled: draft.enabled,
      };
      return draft.id ? ariaLimsSyncApi.updatePoint(draft.id, payload) : ariaLimsSyncApi.createPoint(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["arialims-points"] });
      setDraft(EMPTY);
      setPreview(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ariaLimsSyncApi.deletePoint(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["arialims-points"] }),
  });

  const scidOk = Number.isInteger(Number(draft.scid)) && Number(draft.scid) > 0;
  const analysisNames = Array.from(
    new Set([...(preview?.analyses || []).map((a) => a.name), ...Object.keys(draft.parameter_map)])
  );
  const unitOf = (name: string) => preview?.analyses.find((a) => a.name === name)?.unit || "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--win-text-dim)]">{t("ariaLimsSync.pointsHelp")}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--win-shadow)] text-start">
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.scid")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointName")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointType")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointScope")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointTarget")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointMapped")}</th>
              <th className="px-2 py-1 text-start">{t("ariaLimsSync.pointEnabled")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(points.data || []).map((p) => (
              <tr
                key={p.id}
                className={`cursor-pointer border-b border-[var(--win-face-dark)] hover:bg-[var(--win-face-hi)] ${draft.id === p.id ? "bg-[var(--win-face-hi)]" : ""}`}
                onClick={() => {
                  setDraft(fromPoint(p));
                  setPreview(null);
                }}
              >
                <td className="px-2 py-1 font-semibold">{p.scid}</td>
                <td className="px-2 py-1">{p.name}</td>
                <td className="px-2 py-1">{p.analysis_type}</td>
                <td className="px-2 py-1">{t(`ariaLimsSync.${SCOPES.find(([k]) => k === p.scope)?.[1] ?? "scopeTotalPlant"}`)}</td>
                <td className="px-2 py-1">{targetLabel(p)}</td>
                <td className="px-2 py-1">{Object.keys(p.parameter_map || {}).length || ""}</td>
                <td className="px-2 py-1">{p.enabled ? "✓" : ""}</td>
                <td className="px-2 py-1 text-end">
                  <button
                    type="button"
                    title={t("ariaLimsSync.deletePoint")}
                    className="text-red-700"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await appConfirm(t("ariaLimsSync.confirmDeletePoint", { scid: String(p.scid) }))) {
                        deleteMutation.mutate(p.id);
                        if (draft.id === p.id) setDraft(EMPTY);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {points.data && points.data.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-3 text-[var(--win-text-dim)]">
                  {t("ariaLimsSync.pointsEmpty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 rounded border border-[var(--win-shadow)] p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label>{t("ariaLimsSync.scid")}</Label>
            <Input
              type="number"
              min={1}
              value={draft.scid}
              onChange={(e) => set({ scid: e.target.value })}
              placeholder="242"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>{t("ariaLimsSync.pointName")}</Label>
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <Label>{t("ariaLimsSync.pointType")}</Label>
            <Select value={draft.analysis_type} onChange={(e) => set({ analysis_type: e.target.value })}>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>{t("ariaLimsSync.pointScope")}</Label>
            <Select value={draft.scope} onChange={(e) => set({ scope: e.target.value })}>
              {SCOPES.map(([value, key]) => (
                <option key={value} value={value}>
                  {t(`ariaLimsSync.${key}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end gap-3">
            {draft.scope === "sub_plant" ? (
              <div className="flex-1">
                <Label>{t("fields.subPlant")}</Label>
                <Input value={draft.sub_plant} onChange={(e) => set({ sub_plant: e.target.value })} />
              </div>
            ) : null}
            {draft.scope === "group" ? (
              <div className="flex-1">
                <Label>{t("fields.groupNr")}</Label>
                <Input value={draft.group_nr} onChange={(e) => set({ group_nr: e.target.value })} />
              </div>
            ) : null}
            {draft.scope === "electrolyzer" || draft.scope === "element" ? (
              <div className="flex-1">
                <Label>{t("fields.electrolyzer")}</Label>
                <Input value={draft.electrolyzer} onChange={(e) => set({ electrolyzer: e.target.value })} />
              </div>
            ) : null}
            {draft.scope === "element" ? (
              <div className="flex-1">
                <Label>{t("fields.position")}</Label>
                <Input value={draft.position} onChange={(e) => set({ position: e.target.value })} />
              </div>
            ) : null}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {t("ariaLimsSync.pointEnabled")}
        </label>

        {analysisNames.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs text-[var(--win-text-dim)]">{t("ariaLimsSync.previewAnalyses")}</div>
            {analysisNames.map((name) => (
              <div key={name} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
                <span className="text-sm">
                  {name}
                  {unitOf(name) ? <span className="text-[var(--win-text-dim)]"> [{unitOf(name)}]</span> : null}
                </span>
                <Input
                  value={draft.parameter_map[name] ?? ""}
                  placeholder={name}
                  onChange={(e) => set({ parameter_map: { ...draft.parameter_map, [name]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        ) : null}

        {preview ? (
          <div className="text-xs text-[var(--win-text-dim)]">
            {t("ariaLimsSync.previewSummary", { n: String(preview.received), days: "7" })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!scidOk || previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            <Search className="h-4 w-4" />
            {previewMutation.isPending ? t("ariaLimsSync.previewing") : t("ariaLimsSync.previewBtn")}
          </Button>
          <Button type="button" disabled={!scidOk || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="h-4 w-4" />
            {draft.id ? t("ariaLimsSync.updatePoint") : t("ariaLimsSync.addPoint")}
          </Button>
          {draft.id ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                setPreview(null);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("ariaLimsSync.newPoint")}
            </Button>
          ) : null}
          {saved ? <span className="text-sm font-semibold text-green-700">{t("ariaLimsSync.pointSaved")}</span> : null}
        </div>
        {previewMutation.isError ? <ErrorState message={(previewMutation.error as Error).message} /> : null}
        {saveMutation.isError ? <ErrorState message={(saveMutation.error as Error).message} /> : null}
      </div>
    </div>
  );
}
