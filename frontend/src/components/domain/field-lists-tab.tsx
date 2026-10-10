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
};

/** Same naming as the form labels: assembly_group -> fields.assemblyGroup */
function fieldKey(field: string): string {
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
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tables = catalog.data || [];
  const table = tables.some((c) => c.table === tableSel) ? tableSel : tables[0]?.table || "";
  const fields = tables.find((c) => c.table === table)?.fields || [];
  const field = fields.includes(fieldSel) ? fieldSel : fields[0] || "";

  const items = useQuery({
    queryKey: ["field-options", "items", table, field],
    queryFn: () => fieldOptionsApi.items(table, field),
    enabled: Boolean(table && field),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["field-options"] });
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
      queryClient.invalidateQueries();
      flash(data.records_updated ? t("fieldLists.renamedRecords", { count: String(data.records_updated) }) : t("fieldLists.renamed"));
    },
    onError: (err) => void appAlert(errText(err)),
  });
  const removeMutation = useMutation({
    mutationFn: (id: number) => fieldOptionsApi.remove(id),
    onSuccess: refresh,
  });

  function submitAdd() {
    const values = draft
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length) addMutation.mutate(values);
  }

  async function saveRename(row: FieldOptionItem) {
    if (!editing || row.id == null) return;
    const value = editing.value.trim();
    if (!value || value === row.value) {
      setEditing(null);
      return;
    }
    let apply = false;
    if (row.count > 0) {
      apply = await appConfirm(t("fieldLists.confirmApply", { count: String(row.count), from: row.value, to: value }));
    }
    renameMutation.mutate({ id: row.id, value, apply });
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
            }}
            className="min-w-[220px]"
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {t(fieldKey(f))}
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

      {items.isLoading ? <LoadingState /> : null}
      {items.isError ? <ErrorState message={errText(items.error)} /> : null}

      {items.data ? (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--win-shadow)]">
                <th className="px-2 py-1 text-start">{t("fieldLists.value")}</th>
                <th className="px-2 py-1 text-start">{t("fieldLists.source")}</th>
                <th className="px-2 py-1 text-start">{t("fieldLists.usedBy")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editing != null && row.id != null && editing.id === row.id;
                return (
                  <tr key={row.value.toLowerCase()} className="border-b border-[var(--win-face-dark)]">
                    <td className="px-2 py-1 font-semibold">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={editing.value}
                          onChange={(e) => setEditing({ id: editing.id, value: e.target.value })}
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
                    <td className="px-2 py-1 text-end">
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
                                onClick={() => setEditing({ id: row.id as number, value: row.value })}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title={t("fieldLists.remove")}
                                className="text-red-700"
                                onClick={async () => {
                                  if (await appConfirm(t("fieldLists.confirmRemove", { value: row.value }))) removeMutation.mutate(row.id as number);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : !row.built_in ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => addMutation.mutate([row.value])}>
                              <Plus className="h-3.5 w-3.5" />
                              {t("fieldLists.pin")}
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-center text-[var(--win-text-dim)]">
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
