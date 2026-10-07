"use client";

/**
 * Access-parity Data Input for Current Efficiency (Anodische Bilanz → CE from NaOH Production).
 * Maps Access tables into unified current_efficiency_entries:
 *   tblEingabeCEGesamtanlageNaOH  → scope=plant
 *   tblEingabeCETeilanlageNaOH    → scope=sub_plant + scope_ref=Train
 *   tblEingabeCEElektrolyseurNaOH → scope=electrolyzer + scope_ref
 *   tblEingabeCEGruppeNaOH        → scope=group + scope_ref
 *   tblEingabeCEElementNaOH       → scope=element + scope_ref + position
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  currentEfficiencyEntriesApi,
  groupDefinitionsApi,
  subPlantsApi,
} from "@/lib/endpoints";
import { useCrudResource } from "@/lib/use-resource";
import type { CurrentEfficiencyEntry } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import {
  ElectrolyzerCombo,
  electrolyzerFieldOptions,
  useElectrolyzerNames,
} from "@/components/ui/electrolyzer-combo";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/input";
import { formatDate, formatNumber } from "@/lib/utils";
import { formatElectrolyzer } from "@/lib/plant-topology";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { ExportButtons } from "@/components/domain/export-buttons";
import { appConfirm } from "@/lib/dialog";

const L = {
  date: "Date",
  datum: "Datum",
  train: "Train",
  electrolyzer: "Electrolyzer",
  group: "Group",
  position: "Position",
  ce: "CE [%]",
} as const;

export type CeInputMode = "plant" | "train" | "electrolyzer" | "group" | "element";

const SCOPE_OF: Record<CeInputMode, string> = {
  plant: "plant",
  train: "sub_plant",
  electrolyzer: "electrolyzer",
  group: "group",
  element: "element",
};

function dayOf(value: string | null | undefined): string {
  return (value || "").slice(0, 10);
}

export function CurrentEfficiencyDataInput({ mode }: { mode: CeInputMode }) {
  const { t } = useI18n();
  const caption =
    mode === "plant"
      ? t("ce.inputPlantTitle")
      : mode === "train"
        ? t("ce.inputTrainTitle")
        : mode === "electrolyzer"
          ? t("ce.inputElectrolyzerTitle")
          : mode === "group"
            ? t("ce.inputGroupTitle")
            : t("ce.inputElementTitle");

  return (
    <AccessFormWindow
      caption={caption}
      helpKey="currentEfficiency"
      backHref="/current-efficiency"
      backLabel={t("mainMenu.currentEfficiency")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/current-efficiency"
          className="access-toolbar-btn inline-flex h-[22px] items-center px-2 text-[11px]"
        >
          {t("mainMenu.currentEfficiency")}
        </Link>
        <span className="text-[11px] text-[var(--win-muted)]">{t("ce.basisNaoh")}</span>
      </div>
      <CeScopeInput mode={mode} />
    </AccessFormWindow>
  );
}

function CeScopeInput({ mode }: { mode: CeInputMode }) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("voltage");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CurrentEfficiencyEntry | null>(null);
  const [filterDay, setFilterDay] = useState("");
  const [filterRef, setFilterRef] = useState("");
  const elNames = useElectrolyzerNames();
  const scope = SCOPE_OF[mode];

  const trains = useQuery({
    queryKey: ["sub-plants"],
    queryFn: () => subPlantsApi.list(),
    enabled: mode === "train",
  });
  const groups = useQuery({
    queryKey: ["group-definitions"],
    queryFn: () => groupDefinitionsApi.list(),
    enabled: mode === "group",
  });

  const trainOptions = useMemo(() => {
    const names = (trains.data || []).map((p) => p.name || String(p.nr)).filter(Boolean);
    const opts = names.length ? names : ["1", "2"];
    return opts.map((value) => ({ label: value, value }));
  }, [trains.data]);

  const groupOptions = useMemo(
    () =>
      (groups.data || [])
        .map((g) => String(g.group_nr || "").trim())
        .filter(Boolean)
        .map((value) => ({ label: value, value })),
    [groups.data]
  );

  const fields = useMemo((): FieldDef[] => {
    const dateField: FieldDef = { name: "date", label: `${L.datum}:`, type: "date", required: true };
    const ceField: FieldDef = { name: "value_pct", label: L.ce, type: "number", step: "0.01", required: true };
    if (mode === "plant") return [dateField, ceField];
    if (mode === "train") {
      return [
        dateField,
        { name: "scope_ref", label: `${L.train}:`, type: "combo", required: true, options: trainOptions },
        ceField,
      ];
    }
    if (mode === "electrolyzer") {
      return [
        dateField,
        {
          name: "scope_ref",
          label: `${L.electrolyzer}:`,
          type: "combo",
          required: true,
          options: electrolyzerFieldOptions(elNames),
        },
        ceField,
      ];
    }
    if (mode === "group") {
      return [
        dateField,
        {
          name: "scope_ref",
          label: `${L.group}:`,
          type: groupOptions.length ? "combo" : "text",
          required: true,
          options: groupOptions,
        },
        ceField,
      ];
    }
    return [
      dateField,
      {
        name: "scope_ref",
        label: `${L.electrolyzer}:`,
        type: "combo",
        required: true,
        options: electrolyzerFieldOptions(elNames),
      },
      { name: "position", label: `${L.position}:`, required: true },
      ceField,
    ];
  }, [mode, elNames, trainOptions, groupOptions]);

  const { listQuery, createMutation, updateMutation, removeMutation } = useCrudResource<CurrentEfficiencyEntry>(
    "current-efficiency-entries",
    currentEfficiencyEntriesApi,
    { limit: 5000 }
  );

  const rows = useMemo(() => {
    let data = (listQuery.data || []).filter((r) => r.scope === scope);
    if (filterDay) data = data.filter((r) => dayOf(r.date) === filterDay);
    if (filterRef) {
      const want = mode === "electrolyzer" || mode === "element" ? formatElectrolyzer(filterRef) || filterRef : filterRef;
      data = data.filter((r) => {
        const ref = mode === "electrolyzer" || mode === "element" ? formatElectrolyzer(r.scope_ref) || r.scope_ref || "" : r.scope_ref || "";
        return ref === want;
      });
    }
    return data;
  }, [listQuery.data, scope, filterDay, filterRef, mode]);

  const columns: Column<CurrentEfficiencyEntry>[] = useMemo(() => {
    const cols: Column<CurrentEfficiencyEntry>[] = [
      { key: "date", header: L.datum, render: (r) => formatDate(r.date) },
    ];
    if (mode === "train") {
      cols.push({ key: "scope_ref", header: L.train });
    } else if (mode === "electrolyzer") {
      cols.push({
        key: "scope_ref",
        header: L.electrolyzer,
        render: (r) => formatElectrolyzer(r.scope_ref) || r.scope_ref || "—",
      });
    } else if (mode === "group") {
      cols.push({ key: "scope_ref", header: L.group });
    } else if (mode === "element") {
      cols.push({
        key: "scope_ref",
        header: L.electrolyzer,
        render: (r) => formatElectrolyzer(r.scope_ref) || r.scope_ref || "—",
      });
      cols.push({ key: "position", header: L.position });
    }
    cols.push({ key: "value_pct", header: L.ce, render: (r) => formatNumber(r.value_pct) });
    return cols;
  }, [mode]);

  const title =
    mode === "plant"
      ? t("ce.inputPlantTitle")
      : mode === "train"
        ? t("ce.inputTrainTitle")
        : mode === "electrolyzer"
          ? t("ce.inputElectrolyzerTitle")
          : mode === "group"
            ? t("ce.inputGroupTitle")
            : t("ce.inputElementTitle");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[var(--win-face-dark)] pb-2">
        <div>
          <h3 className="m-0 text-[13px] font-bold text-[var(--win-navy)]">{title}</h3>
          <p className="m-0 mt-1 text-[10px] text-[var(--win-muted)]">{t("ce.basisNaoh")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons prefix="/current-efficiency-entries" filenameBase={`ce-input-${mode}`} />
          {editable ? (
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              <Plus size={16} /> {t("access.newRecord")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        {mode === "electrolyzer" || mode === "element" ? (
          <div className="min-w-[140px]">
            <Label>{L.electrolyzer}</Label>
            <ElectrolyzerCombo value={filterRef} onChange={setFilterRef} placeholder="—" />
          </div>
        ) : null}
        {mode === "train" ? (
          <div className="min-w-[100px]">
            <Label>{L.train}</Label>
            <select className="access-inset-field w-full" value={filterRef} onChange={(e) => setFilterRef(e.target.value)}>
              <option value="">—</option>
              {trainOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {mode === "group" ? (
          <div className="min-w-[100px]">
            <Label>{L.group}</Label>
            <select className="access-inset-field w-full" value={filterRef} onChange={(e) => setFilterRef(e.target.value)}>
              <option value="">—</option>
              {groupOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <Label>{L.datum}</Label>
          <DateInput type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} />
        </div>
        {(filterDay || filterRef) && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFilterDay("");
              setFilterRef("");
            }}
          >
            {t("storage.clearFilters")}
          </Button>
        )}
      </div>

      {listQuery.isError ? <ErrorState message={(listQuery.error as Error).message} /> : null}
      <DataTable
        columns={columns}
        data={rows}
        keyField="id"
        isLoading={listQuery.isLoading}
        emptyTitle={t("voltage.noCeEntries")}
        actions={
          editable
            ? (row) => (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row);
                      setShowForm(true);
                    }}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void appConfirm(t("ce.confirmDelete")).then((ok) => {
                        if (ok) removeMutation.mutate(row.id);
                      });
                    }}
                  >
                    <Trash2 size={14} className="text-[var(--win-danger)]" />
                  </Button>
                </>
              )
            : undefined
        }
      />

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t("ce.editEntry") : t("ce.newEntry")}
      >
        <ResourceForm
          fields={fields}
          initialValues={
            editing
              ? {
                  ...editing,
                  date: dayOf(editing.date),
                  scope_ref:
                    mode === "electrolyzer" || mode === "element"
                      ? formatElectrolyzer(editing.scope_ref) || editing.scope_ref
                      : editing.scope_ref,
                }
              : undefined
          }
          submitting={createMutation.isPending || updateMutation.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(values) => {
            const payload: Partial<CurrentEfficiencyEntry> = {
              scope,
              date: (values.date as string) || null,
              value_pct:
                values.value_pct === "" || values.value_pct == null ? null : Number(values.value_pct),
              scope_ref: mode === "plant" ? null : ((values.scope_ref as string) || null),
              position: mode === "element" ? ((values.position as string) || null) : null,
            };
            if (editing) {
              updateMutation.mutate({ id: editing.id, payload }, { onSuccess: () => setShowForm(false) });
            } else {
              createMutation.mutate(payload as never, { onSuccess: () => setShowForm(false) });
            }
          }}
        />
      </Modal>
    </div>
  );
}
