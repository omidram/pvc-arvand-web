"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { fieldOptionsApi, type FieldOptionItem } from "@/lib/endpoints";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { appAlert, appConfirm } from "@/lib/dialog";

const TABLE_LABEL: Record<string, string> = {
  anodes: "menus.anodeDetails",
  cathodes: "menus.cathodeDetails",
  membranes: "menus.membraneDetails",
  elements: "menus.assemblyData",
  group_definitions: "menus.groupDefinition",
  segregations: "segregation.title",
};

/** Fields whose label lives outside the shared `fields.*` group. */
const FIELD_LABEL: Record<string, string> = {
  company: "segregation.company",
  voltage_quality: "segregation.voltageQuality",
  warranty: "segregation.warranty",
  coating_quality: "segregation.coatingQuality",
  decision: "segregation.decision",
};

/** Same naming as the form labels: assembly_group -> fields.assemblyGroup */
function fieldKey(field: string, table?: string): string {
  if (table === "segregations" && FIELD_LABEL[field]) return FIELD_LABEL[field];
  return "fields." + field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function errText(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return err instanceof Error ? err.message : "";
}

/**
 * Settings -> Field lists: define the values offered in the dropdowns of the data-entry forms
 * (Anode / Cathode / Membrane details, Assembly Data). Anything typed into a record is offered
 * automatically as well; this is where values are added before they are used, renamed or removed.
 */
export function FieldListsTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("settings") || canEdit("elements") || canEdit("anodes") || canEdit("cathodes") || canEdit("membranes");
  const queryClient = useQueryClient();

  const catalog = useQuery({ queryKey: ["field-options", "catalog"], queryFn: fieldOptionsApi.catalog });
  const [tableSel, setTable] = useState("");
  const [fieldSel, setField] = useState("");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<{ id: number; from: string; value: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [into, setInto] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const tables = catalog.data || [];
  const table = tables.some((c) => c.table === tableSel) ? tableSel : tables[0]?.table || "";
  const fields = tables.find((c) => c.table === table)?.fields || [];
  const field = fields.includes(fieldSel) ? fieldSel : fields[0] || "";

  const items = useQuery({
    queryKey: ["field-options", "items", table, field],
    queryFn: () => fieldOptionsApi.items(table, field),
    enabled: Boolean(table && field),
    staleTime: 0,
    refetchOnMount: "always",
  });

  function refresh() {
    setPicked([]);
    queryClient.invalidateQueries({ queryKey: ["field-options"] });
    queryClient.invalidateQueries({ queryKey: ["membrane-stock"] });
    queryClient.invalidateQueries({ queryKey: ["element-dashboard"] });
  }
  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  }

  const addMutation = useMutation({
    mutationFn: async (values: string[]) => {
      let added = 0;
      const skipped: string[] = [];
      for (const value of values) {
        try {
          await fieldOptionsApi.add(table, field, value);
          added += 1;
        } catch {
          skipped.push(value);
        }
      }
      return { added, skipped };
    },
    onSuccess: ({ added, skipped }) => {
      setDraft("");
      refresh();
      flash(t("fieldLists.added", { count: String(added) }) + (skipped.length ? " " + t("fieldLists.skipped", { list: skipped.join(", ") }) : ""));
    },
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, value, apply }: { id: number; value: string; apply: boolean }) => fieldOptionsApi.rename(id, value, apply),
    onSuccess: (data) => {
      setEditing(null);
      refresh();
      flash(data.records_updated ? t("fieldLists.renamedRecords", { count: String(data.records_updated) }) : t("fieldLists.renamed"));
    },
    onError: (err) => void appAlert(errText(err)),
  });
  const mergeMutation = useMutation({
    mutationFn: (name: string) => fieldOptionsApi.merge(table, field, picked, name),
    onSuccess: (data) => {
      setInto("");
      refresh();
      flash(t("fieldLists.merged", { value: data.value, count: String(data.records_updated) }));
    },
    onError: (err) => void appAlert(errText(err)),
  });
  const purgeMutation = useMutation({
    mutationFn: (values: string[]) => fieldOptionsApi.purge(table, field, values),
    onSuccess: (data, values) => {
      refresh();
      flash(values.length ? t("fieldLists.purged", { count: String(data.records_updated) }) : t("fieldLists.deletedList", { count: String(data.records_updated) }));
    },
    onError: (err) => void appAlert(errText(err)),
  });

  function submitAdd() {
    const values = draft
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length) addMutation.mutate(values);
  }

  async function saveRename(row: FieldOptionItem) {
    if (!editing) return;
    const value = editing.value.trim();
    if (!value || value === row.value) {
      setEditing(null);
      return;
    }
    if (row.id == null) {
      const ok = await appConfirm(t("fieldLists.confirmApply", { count: String(row.count), from: row.value, to: value }));
      if (!ok) {
        setEditing(null);
        return;
      }
      try {
        const data = await fieldOptionsApi.merge(table, field, [row.value], value);
        setEditing(null);
        refresh();
        flash(t("fieldLists.renamedRecords", { count: String(data.records_updated) }));
      } catch (err) {
        void appAlert(errText(err));
      }
      return;
    }
    const apply = await appConfirm(t("fieldLists.confirmApply", { count: String(row.count), from: row.value, to: value }));
    if (!apply) {
      setEditing(null);
      return;
    }
    renameMutation.mutate({ id: row.id, value, apply: true });
  }

  function toggle(value: string) {
    setPicked((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  }

  const needle = filter.trim().toLowerCase();
  const rows = (items.data || []).filter((r) => !needle || r.value.toLowerCase().includes(needle));

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--win-text-dim)]">{t("fieldLists.help")}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t("fieldLists.form")}</span>
          <Select
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setField("");
              setEditing(null);
              setPicked([]);
              setInto("");
            }}
            className="min-w-[200px]"
          >
            {tables.map((c) => (
              <option key={c.table} value={c.table}>
                {t(TABLE_LABEL[c.table] || c.table)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t("fieldLists.field")}</span>
          <Select
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setEditing(null);
              setPicked([]);
              setInto("");
            }}
            className="min-w-[220px]"
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {t(fieldKey(f, table))}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">{t("fieldLists.search")}</span>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48" />
        </label>
        {message ? <span className="text-sm font-semibold text-green-700">{message}</span> : null}
      </div>

      {editable ? (
        <div className="space-y-2 rounded border border-[var(--win-shadow)] p-3">
          <div className="text-sm font-semibold">{t("fieldLists.addTitle")}</div>
          <Textarea
            rows={3}
            value={draft}
            placeholder={t("fieldLists.addPlaceholder")}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="button" size="sm" disabled={!draft.trim() || !field || addMutation.isPending} onClick={submitAdd}>
            <Plus className="h-3.5 w-3.5" />
            {t("fieldLists.add")}
          </Button>
          {addMutation.isError ? <ErrorState message={errText(addMutation.error)} /> : null}
        </div>
      ) : null}

      {editable && field ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">{t("fieldLists.mergeInto")}</span>
            <Input value={into} onChange={(e) => setInto(e.target.value)} placeholder={picked[0] || ""} className="w-52" />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={picked.length < 1 || mergeMutation.isPending || (!(into.trim() || picked[0]) || (picked.length === 1 && !(into.trim() && into.trim() !== picked[0])))}
            onClick={async () => {
              const name = (into.trim() || picked[0] || "").trim();
              if (!picked.length || !name) return;
              if (picked.length === 1 && name === picked[0]) return;
              if (!(await appConfirm(t("fieldLists.confirmMerge", { count: String(picked.length), value: name })))) return;
              mergeMutation.mutate(name);
            }}
          >
            {t("fieldLists.merge")} ({picked.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-red-700"
            disabled={purgeMutation.isPending}
            onClick={async () => {
              const label = t(fieldKey(field, table));
              if (await appConfirm(t("fieldLists.confirmDeleteList", { field: label }))) purgeMutation.mutate([]);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("fieldLists.deleteList")}
          </Button>
          {picked.length < 2 ? <span className="text-sm text-[var(--win-text-dim)]">{t("fieldLists.mergeNeed")}</span> : null}
        </div>
      ) : null}

      {items.isLoading ? <LoadingState /> : null}
      {items.isError ? <ErrorState message={errText(items.error)} /> : null}

      {items.data ? (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--win-shadow)]">
                <th className="px-2 py-1" />
                <th className="px-2 py-1 text-start">{t("fieldLists.value")}</th>
                <th className="px-2 py-1 text-start">{t("fieldLists.source")}</th>
                <th className="px-2 py-1 text-start">{t("fieldLists.usedBy")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editing != null && editing.from === row.value && (row.id != null ? editing.id === row.id : editing.id < 0);
                return (
                  <tr
                    key={`${row.id ?? "u"}:${row.value}`}
                    className={`border-b border-[var(--win-face-dark)] ${picked.includes(row.value) ? "bg-[var(--win-sel)]/20" : ""}`}
                    onClick={() => {
                      if (!isEditing) toggle(row.value);
                    }}
                  >
                    <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={picked.includes(row.value)} onChange={() => toggle(row.value)} />
                    </td>
                    <td className="px-2 py-1 font-semibold">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ id: editing.id, from: editing.from, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename(row);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="h-7"
                        />
                      ) : (
                        row.value
                      )}
                    </td>
                    <td className="px-2 py-1 text-[var(--win-text-dim)]">
                      {row.managed ? t("fieldLists.sourceDefined") : row.built_in ? t("fieldLists.sourceBuiltIn") : t("fieldLists.sourceInUse")}
                    </td>
                    <td className="px-2 py-1">{row.count || ""}</td>
                    <td className="px-2 py-1 text-end" onClick={(e) => e.stopPropagation()}>
                      {editable ? (
                        <span className="inline-flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button type="button" title={t("common.save")} onClick={() => void saveRename(row)}>
                                <Check className="h-4 w-4 text-green-700" />
                              </button>
                              <button type="button" title={t("common.cancel")} onClick={() => setEditing(null)}>
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          ) : row.managed && row.id != null ? (
                            <>
                              <button
                                type="button"
                                title={t("fieldLists.rename")}
                                onClick={() => setEditing({ id: row.id as number, from: row.value, value: row.value })}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title={t("fieldLists.remove")}
                                className="text-red-700"
                                onClick={async () => {
                                  if (await appConfirm(t("fieldLists.confirmRemove", { value: row.value, count: String(row.count) }))) {
                                    purgeMutation.mutate([row.value]);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              {!row.built_in ? (
                                <button type="button" title={t("fieldLists.rename")} onClick={() => setEditing({ id: -1, from: row.value, value: row.value })}>
                                  <Pencil className="h-4 w-4" />
                                </button>
                              ) : null}
                              {!row.built_in && !row.managed ? (
                                <Button type="button" size="sm" variant="ghost" onClick={() => addMutation.mutate([row.value])}>
                                  <Plus className="h-3.5 w-3.5" />
                                  {t("fieldLists.pin")}
                                </Button>
                              ) : null}
                              {!row.built_in ? (
                                <button
                                  type="button"
                                  title={t("fieldLists.remove")}
                                  className="text-red-700"
                                  onClick={async () => {
                                    if (await appConfirm(t("fieldLists.confirmRemove", { value: row.value, count: String(row.count) }))) {
                                      purgeMutation.mutate([row.value]);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : null}
                            </>
                          )}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-[var(--win-text-dim)]">
                    {t("fieldLists.empty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
