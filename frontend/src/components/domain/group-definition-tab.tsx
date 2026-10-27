"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LayoutList, Plus, Trash2 } from "lucide-react";
import { groupDefinitionsApi } from "@/lib/endpoints";
import type { GroupDefinition } from "@/lib/types";
import { useCrudResource } from "@/lib/use-resource";
import { useFieldOptions } from "@/lib/use-field-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { GroupOverviewPanel } from "@/components/domain/group-overview-panel";
import { ExportButtons } from "@/components/domain/export-buttons";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { appConfirm } from "@/lib/dialog";

type Draft = Partial<Record<keyof GroupDefinition, string>>;

/** Fields that are picked from a list (combo) - "All" means: valid for every value of that field. */
const COMBO_FIELDS = ["anode_coating", "cathode_coating", "membrane_type", "gap_mm"] as const;
const ALL_VALUE = "All";

function errText(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return err instanceof Error ? err.message : "";
}

/**
 * Settings -> Group Definition, laid out like the Access form "Gruppenmerkmale": one line per group
 * (Group, Anode coating, Cathode coating, Membrane type, Electrode gap, Remarks), the coatings, membrane
 * type and gap picked from combos, and a "Group Overview" button showing all cell elements per group.
 */
export function GroupDefinitionTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const editable = canEdit("settings");
  const searchParams = useSearchParams();
  const [view, setView] = useState<"definition" | "overview">(searchParams.get("view") === "overview" ? "overview" : "definition");
  const { opts } = useFieldOptions("group_definitions");
  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<GroupDefinition>(
    "group-definitions",
    groupDefinitionsApi,
    { limit: 5000 }
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fresh, setFresh] = useState<Draft>({});
  const [error, setError] = useState("");

  const rows = listQuery.data || [];

  function refreshDependents() {
    void queryClient.invalidateQueries({ queryKey: ["group-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["field-options"] });
    void queryClient.invalidateQueries({ queryKey: ["element-dashboard"] });
  }

  function cell(row: GroupDefinition, name: keyof GroupDefinition): string {
    const draft = drafts[row.group_nr]?.[name];
    return draft !== undefined ? draft : String(row[name] ?? "");
  }
  function setDraft(group: string, name: keyof GroupDefinition, value: string) {
    setDrafts((cur) => ({ ...cur, [group]: { ...cur[group], [name]: value } }));
  }

  function save(row: GroupDefinition) {
    setError("");
    const draft = drafts[row.group_nr] || {};
    const payload = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
    updateMutation.mutate(
      { id: row.group_nr, payload: payload as Partial<GroupDefinition> },
      {
        onSuccess: () => {
          setDrafts((cur) => {
            const next = { ...cur };
            delete next[row.group_nr];
            return next;
          });
          refreshDependents();
        },
        onError: (err) => setError(errText(err)),
      }
    );
  }

  function add() {
    setError("");
    const nr = (fresh.group_nr || "").trim();
    if (!nr) {
      setError(t("groups.groupRequired"));
      return;
    }
    const payload = Object.fromEntries(
      Object.entries({ ...fresh, group_nr: nr }).map(([k, v]) => [k, String(v).trim() === "" ? null : String(v).trim()])
    );
    createMutation.mutate(payload as Partial<GroupDefinition>, {
      onSuccess: () => {
        setFresh({});
        refreshDependents();
      },
      onError: (err) => setError(errText(err)),
    });
  }

  function remove(row: GroupDefinition) {
    void appConfirm(t("common.confirmDeleteNamed", { item: `${t("settings.group")} ${row.group_nr}` })).then((ok) => {
      if (!ok) return;
      setError("");
      removeMutation.mutate(row.group_nr, { onSuccess: refreshDependents, onError: (err) => setError(errText(err)) });
    });
  }

  const label: Record<string, string> = {
    group_nr: t("fields.groupNr"),
    anode_coating: t("fields.anodeCoating"),
    cathode_coating: t("fields.cathodeCoating"),
    membrane_type: t("fields.membraneType"),
    gap_mm: t("fields.gapMm"),
    remarks: t("fields.remarks"),
  };
  const columns: (keyof GroupDefinition)[] = ["group_nr", "anode_coating", "cathode_coating", "membrane_type", "gap_mm", "remarks"];
  const inputClass = "h-7 w-full px-1 py-0 text-xs";

  function field(name: keyof GroupDefinition, value: string, onChange: (v: string) => void, disabled = false) {
    const combo = (COMBO_FIELDS as readonly string[]).includes(name);
    return (
      <Input
        className={inputClass}
        value={value}
        disabled={disabled}
        list={combo ? `gd-${name}` : undefined}
        placeholder={combo ? ALL_VALUE : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={view === "definition" ? "primary" : "secondary"} onClick={() => setView("definition")}>
          {t("groups.definition")}
        </Button>
        <Button size="sm" variant={view === "overview" ? "primary" : "secondary"} onClick={() => setView("overview")}>
          <LayoutList size={14} /> {t("groups.overview")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => router.push("/elements")}>
          {t("elements.title")}
        </Button>
        {view === "definition" ? (
          <div className="ms-auto">
            <ExportButtons prefix="/group-definitions" filenameBase="group-definitions" />
          </div>
        ) : null}
      </div>

      {view === "overview" ? (
        <GroupOverviewPanel />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--win-muted)]">{t("groups.definitionHint")}</p>
          {error ? <ErrorState message={error} /> : null}
          {COMBO_FIELDS.map((name) => (
            <datalist key={name} id={`gd-${name}`}>
              <option value={ALL_VALUE} />
              {opts(name).map((o) => (
                <option key={o.value} value={o.value} />
              ))}
            </datalist>
          ))}
          {listQuery.isLoading ? (
            <LoadingState />
          ) : (
            <div className="max-h-[65vh] overflow-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)]">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--win-face)]">
                    {columns.map((name) => (
                      <th key={name} className="sticky top-0 z-[2] whitespace-nowrap border border-[var(--win-border-shadow)] bg-[var(--win-face)] px-2 py-1.5 text-start font-bold">
                        {label[name]}
                        {name === "group_nr" ? <span className="text-[var(--win-danger)]"> *</span> : null}
                      </th>
                    ))}
                    <th className="sticky top-0 z-[2] w-20 border border-[var(--win-border-shadow)] bg-[var(--win-face)]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const dirty = Boolean(drafts[row.group_nr] && Object.keys(drafts[row.group_nr]).length);
                    return (
                      <tr key={row.group_nr} className={dirty ? "bg-[#fff8d6]" : undefined}>
                        {columns.map((name) => (
                          <td key={name} className="border border-[var(--win-face-dark)] p-0.5">
                            {name === "group_nr" ? (
                              <span className="block px-2 font-bold">{row.group_nr}</span>
                            ) : (
                              field(name, cell(row, name), (v) => setDraft(row.group_nr, name, v), !editable)
                            )}
                          </td>
                        ))}
                        <td className="border border-[var(--win-face-dark)] px-1">
                          {editable ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" disabled={!dirty || updateMutation.isPending} onClick={() => save(row)} title={t("common.save")}>
                                <Check size={13} className={dirty ? "text-green-700" : undefined} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => remove(row)} title={t("common.delete")}>
                                <Trash2 size={13} className="text-[var(--win-danger)]" />
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {editable ? (
                    <tr className="bg-[var(--win-face)]">
                      {columns.map((name) => (
                        <td key={name} className="border border-[var(--win-face-dark)] p-0.5">
                          {field(name, fresh[name] ?? "", (v) => setFresh((cur) => ({ ...cur, [name]: v })))}
                        </td>
                      ))}
                      <td className="border border-[var(--win-face-dark)] px-1">
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" disabled={createMutation.isPending} onClick={add} title={t("groups.addGroup")}>
                            <Plus size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
