"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  anodeCoatingChecksApi,
  anodeMaintenanceApi,
  anodeRecoatingApi,
  anodesApi,
  arrangementBoardApi,
  cathodeCoatingChecksApi,
  cathodeMaintenanceApi,
  cathodeRecoatingApi,
  cathodesApi,
  currentEfficiencyEntriesApi,
  electrodeSegregationsApi,
  inspectionsApi,
  inspectionGridsApi,
  membraneMaintenanceApi,
  membranesApi,
  relationsApi,
  voltageReadingsApi,
  elementsApi,
} from "@/lib/endpoints";
import { AccessFields, accessPayload, valuesFromRecord } from "@/components/ui/access-fields";
import type { FieldDef } from "@/components/ui/resource-form";
import { Button } from "@/components/ui/button";
import { InspectionDefectGrid } from "@/components/domain/inspection-defect-grid";
import { ErrorState, Spinner } from "@/components/ui/spinner";
import type { Element } from "@/lib/types";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { formatDate } from "@/lib/utils";

const INSPECTION_BOOLS = [
  "sample_anode",
  "sample_cathode",
  "sample_membrane",
  "anode_tube_ok",
  "cathode_tube_ok",
  "anode_spacer_ok",
  "cathode_spacer_ok",
  "frame_gasket_ok",
] as const;

const GRID_TYPES = ["anode_half", "cathode_half", "membrane_as", "membrane_ks", "membrane_lt"] as const;

function yn(t: (key: string) => string): { label: string; value: string }[] {
  return [
    { label: t("common.yes"), value: "true" },
    { label: t("common.no"), value: "false" },
  ];
}

function asOptions(values?: string[]) {
  return (values || []).map((value) => ({ label: value, value }));
}

function BoundForm({
  fields,
  record,
  locked,
  canEdit,
  onSubmit,
  coerceBools,
}: {
  fields: FieldDef[];
  record: object | null;
  locked?: Record<string, unknown>;
  canEdit: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  coerceBools?: boolean;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(() => valuesFromRecord(fields, record));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setError("");
    setSaved(false);
    const payload = { ...accessPayload(fields, values), ...locked };
    if (coerceBools) {
      for (const name of INSPECTION_BOOLS) {
        if (name in payload) payload[name] = payload[name] === true || payload[name] === "true";
      }
    }
    try {
      await onSubmit(payload);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.import"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <AccessFields
        fields={fields}
        values={values}
        onChange={(name, value) => {
          setSaved(false);
          setValues((current) => ({ ...current, [name]: value }));
        }}
        readOnly={!canEdit}
      />
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? t("common.saving") : t("common.save")}
          </Button>
          {saved ? <span className="text-[11px] font-semibold text-[#0d5c0d]">{t("common.saved")}</span> : null}
        </div>
      ) : null}
      {error ? <p className="text-[11px] font-semibold text-[var(--win-danger)]">{error}</p> : null}
    </div>
  );
}

function Section({
  title,
  hint,
  count,
  children,
  open,
}: {
  title: string;
  hint?: string;
  count?: number;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="border-2 border-[var(--win-border-shadow)] [border-style:outset] bg-[var(--win-face)]">
      <summary className="cursor-pointer select-none px-2 py-1 text-[12px] font-bold text-[var(--win-navy)]">
        {title}
        {count != null ? <span className="ml-2 font-normal text-[var(--win-muted)]">({count})</span> : null}
      </summary>
      <div className="border-t border-[var(--win-border-shadow)] px-2 py-2">
        {hint ? <p className="mb-2 text-[11px] text-[var(--win-muted)]">{hint}</p> : null}
        {children}
      </div>
    </details>
  );
}

function RowList({
  rows,
  fields,
  canEdit,
  seed,
  addLabel,
  emptyLabel,
  onCreate,
  onUpdate,
}: {
  rows: object[];
  fields: FieldDef[];
  canEdit: boolean;
  seed: Record<string, unknown>;
  addLabel: string;
  emptyLabel: string;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (id: number, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      {rows.length === 0 && !adding ? <p className="text-[11px] text-[var(--win-muted)]">{emptyLabel}</p> : null}
      {rows.map((row) => {
        const id = Number((row as { id?: number }).id);
        return (
          <div key={id} className="border border-[var(--win-border-shadow)] bg-[var(--win-panel)] p-2">
            <BoundForm
              key={JSON.stringify(row)}
              fields={fields}
              record={row}
              canEdit={canEdit}
              onSubmit={(payload) => onUpdate(id, payload)}
            />
          </div>
        );
      })}
      {canEdit && adding ? (
        <div className="border border-[#6a9a6a] bg-[#f4fff4] p-2">
          <BoundForm
            fields={fields}
            record={seed}
            canEdit
            onSubmit={async (payload) => {
              await onCreate(payload);
              setAdding(false);
            }}
          />
        </div>
      ) : null}
      {canEdit ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => setAdding((value) => !value)}>
          {adding ? "×" : addLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function CellArrangementEditor({
  electrolyzer,
  position,
  onChanged,
}: {
  electrolyzer: string;
  position: number;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const queryClient = useQueryClient();
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [gridDrafts, setGridDrafts] = useState<Record<string, Record<string, unknown>>>({});

  const editElements = canEdit("elements");
  const editAnodes = canEdit("anodes");
  const editCathodes = canEdit("cathodes");
  const editMembranes = canEdit("membranes");
  const editInspections = canEdit("inspections");
  const editVoltage = canEdit("voltage");

  const cellQuery = useQuery({
    queryKey: ["arrangement-cell", electrolyzer, position, installationId],
    queryFn: () => arrangementBoardApi.cell(electrolyzer, position, installationId),
  });

  const groups = useQuery({ queryKey: ["relations", "groups"], queryFn: () => relationsApi.lookup("groups") });
  const reasons = useQuery({
    queryKey: ["relations", "inspection-reasons"],
    queryFn: () => relationsApi.lookup("inspection-reasons"),
  });

  const dossier = cellQuery.data;
  const element = creating ? null : dossier?.element || null;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["arrangement-cell", electrolyzer, position] });
    onChanged();
  }

  const assemblyFields = useMemo<FieldDef[]>(
    () => [
      { name: "element_nr", label: t("fields.elementNr"), required: true },
      { name: "group_nr", label: t("fields.groupNr"), type: "select", options: asOptions(groups.data) },
      { name: "generation", label: t("fields.generation") },
      { name: "anode_nr", label: t("fields.anodeNr") },
      { name: "cathode_nr", label: t("fields.cathodeNr") },
      { name: "membrane_nr", label: t("fields.membraneNr") },
      { name: "membrane_type", label: t("fields.membraneType") },
      { name: "gap_mm", label: t("fields.gapMm") },
      { name: "assembly_date", label: t("fields.assemblyDate"), type: "date" },
      { name: "commissioning_date", label: t("fields.commissioningDate"), type: "date" },
      { name: "decommissioning_date", label: t("fields.decommissioningDate"), type: "date" },
      { name: "disassembly_date", label: t("fields.disassemblyDate"), type: "date" },
      { name: "dol_days", label: t("fields.dolDaysOverride"), type: "number" },
      { name: "decommission_reason", label: t("fields.decommissionReason") },
      { name: "ispb", label: t("fields.ispb") },
      { name: "anode_coating", label: t("fields.anodeCoating") },
      { name: "anode_electrode", label: t("fields.anodeElectrode") },
      { name: "anode_shell", label: t("fields.anodeShell") },
      { name: "cathode_coating", label: t("fields.cathodeCoating") },
      { name: "cathode_electrode", label: t("fields.cathodeElectrode") },
      { name: "cathode_shell", label: t("fields.cathodeShell") },
      { name: "membrane_info", label: t("fields.membraneInfo"), span: 2 },
      { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
    ],
    [t, groups.data]
  );

  const anodeFields = useMemo<FieldDef[]>(
    () => [
      { name: "assembly_group", label: t("fields.assemblyGroup") },
      { name: "component_nr", label: t("fields.componentNr") },
      { name: "customer_drawing_nr", label: t("fields.customerDrawingNr") },
      { name: "manufacturer", label: t("fields.manufacturer") },
      { name: "manufacturer_order_nr", label: t("fields.manufacturerOrderNr") },
      { name: "manufacturer_drawing_nr", label: t("fields.manufacturerDrawingNr") },
      { name: "manufacturer_date", label: t("fields.manufacturerDate"), type: "date" },
      { name: "tank", label: t("fields.tank") },
      { name: "contact_strip", label: t("fields.contactStrip") },
      { name: "electrode_support", label: t("fields.electrodeSupport") },
      { name: "electrode_shape", label: t("fields.electrodeShape") },
      { name: "coating", label: t("fields.coating") },
      { name: "baffle_plate", label: t("fields.bafflePlate") },
      { name: "downcomer", label: t("fields.downcomer") },
      { name: "inlet_system", label: t("fields.inletSystem") },
      { name: "standpipe_diameter", label: t("fields.standpipeDiameter") },
      { name: "flange_width", label: t("fields.flangeWidth") },
      { name: "received_date", label: t("fields.receivedDate"), type: "date" },
      { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
      { name: "batch", label: t("fields.batch") },
      { name: "generation", label: t("fields.generation") },
      { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
    ],
    [t]
  );

  const cathodeFields = useMemo<FieldDef[]>(
    () => anodeFields.filter((field) => field.name !== "baffle_plate" && field.name !== "downcomer"),
    [anodeFields]
  );

  const membraneFields = useMemo<FieldDef[]>(
    () => [
      { name: "membrane_type", label: t("fields.membraneType") },
      { name: "received_date", label: t("fields.receivedDate"), type: "date" },
      { name: "decommission_date", label: t("fields.decommissionDate"), type: "date" },
      { name: "batch", label: t("fields.batch") },
      { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
    ],
    [t]
  );

  const maintenanceFields = useMemo<FieldDef[]>(
    () => [
      { name: "date", label: t("fields.date"), type: "date" },
      { name: "finding", label: t("fields.finding") },
      { name: "action", label: t("fields.action") },
      { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
      { name: "return_date", label: t("fields.returnDate"), type: "date" },
    ],
    [t]
  );

  const anodeRecoatFields = useMemo<FieldDef[]>(
    () => [
      { name: "coating_nr", label: t("fields.coatingNr") },
      { name: "recoating_number", label: t("fields.recoatingNumber") },
      { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
      { name: "return_date", label: t("fields.returnDate"), type: "date" },
      { name: "manufacturer", label: t("fields.manufacturer") },
      { name: "remarks", label: t("fields.remarks"), span: 2 },
    ],
    [t]
  );

  const cathodeRecoatFields = useMemo<FieldDef[]>(
    () => anodeRecoatFields.filter((field) => field.name !== "coating_nr" && field.name !== "recoating_number"),
    [anodeRecoatFields]
  );

  const coatingFields = useMemo<FieldDef[]>(
    () => [
      { name: "coating_nr", label: t("fields.coatingNr") },
      { name: "check_date", label: t("fields.checkDate"), type: "date" },
      { name: "inspector", label: t("fields.inspector") },
      { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
      { name: "potential", label: t("fields.potential"), type: "number", step: "0.001" },
      { name: "dol_days", label: t("fields.dolDays"), type: "number" },
      { name: "remarks", label: t("fields.remarks"), span: 2 },
    ],
    [t]
  );

  const cathodeCoatingFields = useMemo<FieldDef[]>(
    () => coatingFields.filter((field) => field.name !== "coating_nr" && field.name !== "dol_days"),
    [coatingFields]
  );

  const repairFields = useMemo<FieldDef[]>(
    () => [
      { name: "date", label: t("fields.date"), type: "date" },
      { name: "repair_work", label: t("fields.repairWork"), span: 2 },
    ],
    [t]
  );

  const segregationFields = useMemo<FieldDef[]>(
    () => [
      { name: "company", label: t("fields.manufacturer") },
      { name: "service_life", label: t("fields.dolDays") },
      { name: "install_date", label: t("fields.assemblyDate"), type: "date" },
      { name: "dismantle_date", label: t("fields.disassemblyDate"), type: "date" },
      { name: "inspection_date", label: t("fields.inspectionDate"), type: "date" },
      { name: "warranty", label: t("arrangement.warranty") },
      { name: "decision", label: t("arrangement.decision"), span: 2 },
      { name: "problems", label: t("arrangement.problems"), type: "textarea", span: 2 },
      { name: "segregation", label: t("arrangement.segregation"), type: "textarea", span: 2 },
      { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
    ],
    [t]
  );

  const inspectionFields = useMemo<FieldDef[]>(
    () => [
      { name: "inspection_reason", label: t("fields.inspectionReason"), type: "select", options: asOptions(reasons.data) },
      { name: "inspector_name", label: t("fields.inspectorName") },
      { name: "inspection_date", label: t("fields.inspectionDate"), type: "date" },
      { name: "blister_anode_area", label: t("fields.blisterAnodeArea") },
      { name: "blister_periphery_top", label: t("fields.blisterPeripheryTop") },
      { name: "blister_periphery_bottom", label: t("fields.blisterPeripheryBottom") },
      { name: "blister_periphery_side", label: t("fields.blisterPeripherySide") },
      { name: "blister_corners", label: t("fields.blisterCorners") },
      { name: "folds", label: t("fields.folds") },
      { name: "pressure_marks", label: t("fields.pressureMarks") },
      { name: "visible_holes", label: t("fields.visibleHoles") },
      { name: "cracks", label: t("fields.cracks") },
      { name: "blister_remarks", label: t("fields.blisterRemarks"), type: "textarea", span: 2 },
      { name: "sample_anode", label: t("fields.sampleAnode"), type: "select", options: yn(t) },
      { name: "sample_cathode", label: t("fields.sampleCathode"), type: "select", options: yn(t) },
      { name: "sample_membrane", label: t("fields.sampleMembrane"), type: "select", options: yn(t) },
      { name: "anode_tube_ok", label: t("fields.anodeTubeOk"), type: "select", options: yn(t) },
      { name: "anode_tube_remark", label: t("fields.anodeTubeRemark") },
      { name: "cathode_tube_ok", label: t("fields.cathodeTubeOk"), type: "select", options: yn(t) },
      { name: "cathode_tube_remark", label: t("fields.cathodeTubeRemark") },
      { name: "anode_spacer_ok", label: t("fields.anodeSpacerOk"), type: "select", options: yn(t) },
      { name: "anode_spacer_remark", label: t("fields.anodeSpacerRemark") },
      { name: "cathode_spacer_ok", label: t("fields.cathodeSpacerOk"), type: "select", options: yn(t) },
      { name: "cathode_spacer_remark", label: t("fields.cathodeSpacerRemark") },
      { name: "frame_gasket_ok", label: t("fields.frameGasketOk"), type: "select", options: yn(t) },
      { name: "frame_gasket_remark", label: t("fields.frameGasketRemark") },
      { name: "general_remarks", label: t("fields.generalRemarks"), type: "textarea", span: 2 },
    ],
    [t, reasons.data]
  );

  const voltageFields = useMemo<FieldDef[]>(
    () => [
      { name: "date", label: t("fields.date"), type: "date" },
      { name: "time", label: t("fields.time") },
      { name: "voltage", label: t("fields.voltage"), type: "number", step: "0.001" },
      { name: "voltage_prev", label: t("fields.voltagePrev"), type: "number", step: "0.001" },
      { name: "standardized_voltage", label: t("fields.standardizedVoltage"), type: "number", step: "0.001" },
      { name: "element_nr", label: t("fields.elementNr") },
    ],
    [t]
  );

  const efficiencyFields = useMemo<FieldDef[]>(
    () => [
      { name: "date", label: t("fields.date"), type: "date" },
      { name: "value_pct", label: t("fields.currentEfficiencyPct"), type: "number", step: "0.01" },
    ],
    [t]
  );

  if (cellQuery.isLoading) {
    return (
      <div className="mt-3 flex justify-center border-2 border-[var(--win-border-shadow)] bg-[var(--win-face)] py-6">
        <Spinner />
      </div>
    );
  }
  if (cellQuery.isError || !dossier) {
    return <ErrorState message={(cellQuery.error as Error)?.message || t("common.accessDenied")} />;
  }

  const anodeNr = element?.anode_nr || "";
  const cathodeNr = element?.cathode_nr || "";
  const membraneNr = element?.membrane_nr || "";
  const elementNr = element?.element_nr || "";
  const inspectionId = dossier.inspections[0]?.id;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[13px] font-bold text-[var(--win-navy)]">
            {t("arrangement.editingCell", { electrolyzer, position })}
          </div>
          <p className="text-[11px] text-[var(--win-muted)]">{t("arrangement.editingHelp")}</p>
        </div>
        {editElements ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setInstallationId(null);
            }}
          >
            {t("arrangement.newInstallation")}
          </Button>
        ) : null}
      </div>

      {(dossier.history || []).length > 0 ? (
        <label className="block text-[11px] font-bold">
          {t("arrangement.history")}
          <select
            className="ml-2 h-[22px] border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-white px-1 text-[11px]"
            value={creating ? "" : String(element?.id || "")}
            onChange={(event) => {
              setCreating(false);
              setInstallationId(event.target.value ? Number(event.target.value) : null);
            }}
          >
            <option value="">{t("arrangement.activeInstallation")}</option>
            {dossier.history.map((row) => (
              <option key={row.id} value={row.id}>
                {formatDate(row.assembly_date)} · {row.element_nr || "—"} · {row.anode_nr || "—"} / {row.cathode_nr || "—"} ·{" "}
                {row.status || "—"}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <Section title={t("menus.assemblyData")} hint={t("arrangement.assemblyHint")} open>
        {dossier.links && element?.group_nr && !dossier.links.group_catalog ? (
          <p className="mb-2 text-[11px] font-semibold text-[var(--win-danger)]">
            {t("arrangement.groupMissing", { nr: element.group_nr })}
          </p>
        ) : null}
        <BoundForm
          key={creating ? `new-${position}` : `el-${element?.id || "empty"}`}
          fields={assemblyFields}
          record={creating ? null : element}
          locked={{ electrolyzer, position: String(position) }}
          canEdit={editElements}
          onSubmit={async (payload) => {
            if (!String(payload.element_nr || "").trim()) {
              throw new Error(t("arrangement.elementNrRequired"));
            }
            if (creating || !element) {
              const created = await elementsApi.create(payload as Partial<Element>);
              setCreating(false);
              setInstallationId(created.id);
            } else {
              await elementsApi.update(element.id, payload as Partial<Element>);
            }
            await refresh();
          }}
        />
      </Section>

      {element ? (
        <>
          <CatalogSection
            title={t("arrangement.anodeDetails")}
            hint={t("arrangement.linkedBy", { field: t("fields.anodeNr"), nr: anodeNr || "—" })}
            number={anodeNr}
            record={dossier.anode}
            fields={anodeFields}
            canEdit={editAnodes}
            missing={t("arrangement.missingRecord", { name: t("fields.anode"), nr: anodeNr })}
            onCreate={async (payload) => {
              await anodesApi.create({ ...payload, anode_nr: anodeNr });
              await refresh();
            }}
            onUpdate={async (payload) => {
              await anodesApi.update(anodeNr, { ...payload, anode_nr: anodeNr });
              await refresh();
            }}
          />
          {anodeNr ? (
            <>
              <Section title={t("arrangement.anodeMaintenance")} count={dossier.anode_maintenance.length} open={dossier.anode_maintenance.length > 0}>
                <RowList
                  rows={dossier.anode_maintenance}
                  fields={maintenanceFields}
                  canEdit={editAnodes}
                  seed={{ anode_nr: anodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await anodeMaintenanceApi.create({ ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await anodeMaintenanceApi.update(id, { ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.anodeRecoating")} count={dossier.anode_recoating.length} open={dossier.anode_recoating.length > 0}>
                <RowList
                  rows={dossier.anode_recoating}
                  fields={anodeRecoatFields}
                  canEdit={editAnodes}
                  seed={{ anode_nr: anodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await anodeRecoatingApi.create({ ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await anodeRecoatingApi.update(id, { ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.anodeCoating")} count={dossier.anode_coating.length} open={dossier.anode_coating.length > 0}>
                <RowList
                  rows={dossier.anode_coating}
                  fields={coatingFields}
                  canEdit={editAnodes}
                  seed={{ anode_nr: anodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await anodeCoatingChecksApi.create({ ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await anodeCoatingChecksApi.update(id, { ...payload, anode_nr: anodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.segregation")} count={dossier.anode_segregation.length} open={dossier.anode_segregation.length > 0}>
                <RowList
                  rows={dossier.anode_segregation}
                  fields={segregationFields}
                  canEdit={editAnodes}
                  seed={{ serial_nr: anodeNr, electrode_kind: "anode" }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await electrodeSegregationsApi.create({ ...payload, serial_nr: anodeNr, electrode_kind: "anode" });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await electrodeSegregationsApi.update(id, { ...payload, serial_nr: anodeNr, electrode_kind: "anode" });
                    await refresh();
                  }}
                />
              </Section>
            </>
          ) : null}

          <CatalogSection
            title={t("arrangement.cathodeDetails")}
            hint={t("arrangement.linkedBy", { field: t("fields.cathodeNr"), nr: cathodeNr || "—" })}
            number={cathodeNr}
            record={dossier.cathode}
            fields={cathodeFields}
            canEdit={editCathodes}
            missing={t("arrangement.missingRecord", { name: t("fields.cathode"), nr: cathodeNr })}
            onCreate={async (payload) => {
              await cathodesApi.create({ ...payload, cathode_nr: cathodeNr });
              await refresh();
            }}
            onUpdate={async (payload) => {
              await cathodesApi.update(cathodeNr, { ...payload, cathode_nr: cathodeNr });
              await refresh();
            }}
          />
          {cathodeNr ? (
            <>
              <Section title={t("arrangement.cathodeMaintenance")} count={dossier.cathode_maintenance.length} open={dossier.cathode_maintenance.length > 0}>
                <RowList
                  rows={dossier.cathode_maintenance}
                  fields={maintenanceFields}
                  canEdit={editCathodes}
                  seed={{ cathode_nr: cathodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await cathodeMaintenanceApi.create({ ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await cathodeMaintenanceApi.update(id, { ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.cathodeRecoating")} count={dossier.cathode_recoating.length} open={dossier.cathode_recoating.length > 0}>
                <RowList
                  rows={dossier.cathode_recoating}
                  fields={cathodeRecoatFields}
                  canEdit={editCathodes}
                  seed={{ cathode_nr: cathodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await cathodeRecoatingApi.create({ ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await cathodeRecoatingApi.update(id, { ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.cathodeCoating")} count={dossier.cathode_coating.length} open={dossier.cathode_coating.length > 0}>
                <RowList
                  rows={dossier.cathode_coating}
                  fields={cathodeCoatingFields}
                  canEdit={editCathodes}
                  seed={{ cathode_nr: cathodeNr }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await cathodeCoatingChecksApi.create({ ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await cathodeCoatingChecksApi.update(id, { ...payload, cathode_nr: cathodeNr });
                    await refresh();
                  }}
                />
              </Section>
              <Section title={t("arrangement.segregation")} count={dossier.cathode_segregation.length} open={dossier.cathode_segregation.length > 0}>
                <RowList
                  rows={dossier.cathode_segregation}
                  fields={segregationFields}
                  canEdit={editCathodes}
                  seed={{ serial_nr: cathodeNr, electrode_kind: "cathode" }}
                  addLabel={t("common.add")}
                  emptyLabel={t("arrangement.noRows")}
                  onCreate={async (payload) => {
                    await electrodeSegregationsApi.create({ ...payload, serial_nr: cathodeNr, electrode_kind: "cathode" });
                    await refresh();
                  }}
                  onUpdate={async (id, payload) => {
                    await electrodeSegregationsApi.update(id, { ...payload, serial_nr: cathodeNr, electrode_kind: "cathode" });
                    await refresh();
                  }}
                />
              </Section>
            </>
          ) : null}

          <CatalogSection
            title={t("arrangement.membraneDetails")}
            hint={t("arrangement.linkedBy", { field: t("fields.membraneNr"), nr: membraneNr || "—" })}
            number={membraneNr}
            record={dossier.membrane}
            fields={membraneFields}
            canEdit={editMembranes}
            missing={t("arrangement.missingRecord", { name: t("fields.membrane"), nr: membraneNr })}
            onCreate={async (payload) => {
              await membranesApi.create({ ...payload, membrane_nr: membraneNr });
              await refresh();
            }}
            onUpdate={async (payload) => {
              await membranesApi.update(membraneNr, { ...payload, membrane_nr: membraneNr });
              await refresh();
            }}
          />
          {membraneNr ? (
            <Section title={t("arrangement.membraneRepair")} count={dossier.membrane_maintenance.length} open={dossier.membrane_maintenance.length > 0}>
              <RowList
                rows={dossier.membrane_maintenance}
                fields={repairFields}
                canEdit={editMembranes}
                seed={{ membrane_nr: membraneNr }}
                addLabel={t("common.add")}
                emptyLabel={t("arrangement.noRows")}
                onCreate={async (payload) => {
                  await membraneMaintenanceApi.create({ ...payload, membrane_nr: membraneNr });
                  await refresh();
                }}
                onUpdate={async (id, payload) => {
                  await membraneMaintenanceApi.update(id, { ...payload, membrane_nr: membraneNr });
                  await refresh();
                }}
              />
            </Section>
          ) : null}

          <Section title={t("menus.elementInspection")} hint={t("arrangement.linkedBy", { field: t("fields.elementNr"), nr: elementNr || "—" })} count={dossier.inspections.length} open={dossier.inspections.length > 0}>
            <RowList
              rows={dossier.inspections}
              fields={inspectionFields}
              canEdit={editInspections}
              seed={{ element_nr: elementNr }}
              addLabel={t("common.add")}
              emptyLabel={t("arrangement.noRows")}
              onCreate={async (payload) => {
                for (const name of INSPECTION_BOOLS) {
                  if (name in payload) payload[name] = payload[name] === true || payload[name] === "true";
                }
                await inspectionsApi.create({ ...payload, element_nr: elementNr });
                await refresh();
              }}
              onUpdate={async (id, payload) => {
                for (const name of INSPECTION_BOOLS) {
                  if (name in payload) payload[name] = payload[name] === true || payload[name] === "true";
                }
                await inspectionsApi.update(id, { ...payload, element_nr: elementNr });
                await refresh();
              }}
            />
            <div className="mt-3 space-y-2">
              <div className="text-[12px] font-bold">{t("arrangement.halfshells")}</div>
              {inspectionId ? (
                GRID_TYPES.map((gridType) => {
                  const existing = dossier.halfshells.find((grid) => grid.grid_type === gridType);
                  const value = gridDrafts[gridType] || existing?.grid_data || {};
                  return (
                    <div key={gridType}>
                      <InspectionDefectGrid
                        title={t(`arrangement.grid.${gridType}`)}
                        value={value}
                        disabled={!editInspections}
                        onChange={(next) => setGridDrafts((current) => ({ ...current, [gridType]: next }))}
                      />
                      {editInspections ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="mt-1"
                          onClick={async () => {
                            await inspectionGridsApi.upsert(inspectionId, gridType, gridDrafts[gridType] || existing?.grid_data || {});
                            await refresh();
                          }}
                        >
                          {t("common.save")}
                        </Button>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-[11px] text-[var(--win-muted)]">{t("arrangement.halfshellNeedsInspection")}</p>
              )}
            </div>
          </Section>
        </>
      ) : null}

      <Section title={t("arrangement.voltage")} hint={t("arrangement.voltageHint")} count={dossier.voltage.length} open={dossier.voltage.length > 0}>
        <RowList
          rows={dossier.voltage}
          fields={voltageFields}
          canEdit={editVoltage}
          seed={{ electrolyzer, position: String(position), element_nr: elementNr }}
          addLabel={t("common.add")}
          emptyLabel={t("arrangement.noRows")}
          onCreate={async (payload) => {
            await voltageReadingsApi.create({ ...payload, electrolyzer, position: String(position) });
            await refresh();
          }}
          onUpdate={async (id, payload) => {
            await voltageReadingsApi.update(id, { ...payload, electrolyzer, position: String(position) });
            await refresh();
          }}
        />
      </Section>

      <Section
        title={t("arrangement.currentEfficiency")}
        count={dossier.current_efficiency.length}
        open={dossier.current_efficiency.length > 0}
      >
        <RowList
          rows={dossier.current_efficiency}
          fields={efficiencyFields}
          canEdit={editVoltage}
          seed={{ scope: "element", scope_ref: electrolyzer, position: String(position) }}
          addLabel={t("common.add")}
          emptyLabel={t("arrangement.noRows")}
          onCreate={async (payload) => {
            await currentEfficiencyEntriesApi.create({
              ...payload,
              scope: "element",
              scope_ref: electrolyzer,
              position: String(position),
            });
            await refresh();
          }}
          onUpdate={async (id, payload) => {
            await currentEfficiencyEntriesApi.update(id, {
              ...payload,
              scope: "element",
              scope_ref: electrolyzer,
              position: String(position),
            });
            await refresh();
          }}
        />
      </Section>
    </div>
  );
}

function CatalogSection({
  title,
  hint,
  number,
  record,
  fields,
  canEdit,
  missing,
  onCreate,
  onUpdate,
}: {
  title: string;
  hint: string;
  number: string;
  record: object | null;
  fields: FieldDef[];
  canEdit: boolean;
  missing: string;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
  onUpdate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  if (!number) return null;
  return (
    <Section title={`${title} · ${number}`} hint={hint} open>
      {!record ? <p className="mb-2 text-[11px] font-semibold text-[var(--win-danger)]">{missing}</p> : null}
      <BoundForm
        key={`${number}-${record ? "edit" : "new"}`}
        fields={fields}
        record={record}
        canEdit={canEdit}
        onSubmit={record ? onUpdate : onCreate}
      />
    </Section>
  );
}
