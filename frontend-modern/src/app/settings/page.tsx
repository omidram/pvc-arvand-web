"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import {
  settingsApi,
  electrolyzersApi,
  subPlantsApi,
  fullPlantsApi,
  rectifiersApi,
  transformersApi,
  arrangementsApi,
  reservePositionsApi,
  correctionFactorsApi,
  electrodeAreasApi,
  voltageDistributionClassesApi,
  groupDefinitionsApi,
  inspectionReasonsApi,
  inspectionFindingsApi,
  cellComponentsApi,
} from "@/lib/endpoints";
import type {
  PlantSettings,
  Electrolyzer,
  SubPlant,
  FullPlant,
  Rectifier,
  Transformer,
  ElectrolyzerArrangement,
  ReservePosition,
  CorrectionFactor,
  ElectrodeArea,
  VoltageDistributionClass,
  GroupDefinition,
  InspectionReason,
  InspectionFinding,
  CellComponent,
} from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LookupTable } from "@/components/domain/lookup-table";
import { ResourceForm, type FieldDef } from "@/components/ui/resource-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { ImportExportTab } from "@/components/domain/import-export-tab";
import { BackupTab } from "@/components/domain/backup-tab";
import { DatabaseTab } from "@/components/domain/database-tab";
import { DirectoryTab } from "@/components/domain/directory-tab";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { useTheme } from "@/lib/theme/context";
import { cellComponentLabel } from "@/lib/cell-component-names";
import { inspectionReasonLabel } from "@/lib/inspection-reason-names";
import type { ThemeColors, ThemePresetId } from "@/lib/theme/presets";
import { NAMED_PRESETS } from "@/lib/theme/presets";
import { Sun, Moon, MonitorCog, Contrast, Waves, Trees, Grape, Wheat, Palette } from "lucide-react";

type T = ReturnType<typeof useI18n>["t"];

function PlantInfoTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("settings");
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const updateMutation = useMutation({ mutationFn: settingsApi.update });
  const [saved, setSaved] = useState(false);

  const fields: FieldDef[] = [
    { name: "customer", label: t("fields.customer") },
    { name: "uan", label: t("fields.uan") },
    { name: "version", label: t("fields.version") },
    {
      name: "plant_type",
      label: t("settings.plantType"),
      type: "select",
      options: [
        { label: "NaOH", value: "NaOH" },
        { label: "KOH", value: "KOH" },
      ],
    },
    { name: "acidified", label: t("settings.acidified"), type: "checkbox" },
    {
      name: "language",
      label: t("settings.language"),
      type: "select",
      options: [
        { label: "EN", value: "EN" },
        { label: "DE", value: "DE" },
        { label: "FA", value: "FA" },
      ],
    },
    { name: "reference_current_density", label: t("fields.referenceCurrentDensity"), type: "number", step: "0.01" },
    { name: "zero_voltage", label: t("fields.zeroVoltage"), type: "number", step: "0.001" },
    { name: "date", label: t("settings.recordDate"), type: "date" },
  ];

  if (settingsQuery.isLoading) return <LoadingState />;
  if (settingsQuery.isError) return <ErrorState message={(settingsQuery.error as Error).message} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.plantWideTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResourceForm<PlantSettings>
          fields={fields}
          initialValues={settingsQuery.data}
          submitLabel={t("common.save")}
          onCancel={() => settingsQuery.refetch()}
          submitting={updateMutation.isPending}
          readOnly={!editable}
          onSubmit={(values) =>
            updateMutation.mutate(values, {
              onSuccess: () => {
                setSaved(true);
                settingsQuery.refetch();
                setTimeout(() => setSaved(false), 2000);
              },
            })
          }
        />
        {saved && <div className="mt-3 text-sm font-semibold text-[#0d5c0d]">{t("common.saved")}</div>}
      </CardContent>
    </Card>
  );
}

function CellComponentsTab() {
  const { t } = useI18n();
  const { canEdit } = useAuth();
  const editable = canEdit("settings");
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["cell-components"],
    queryFn: cellComponentsApi.list,
  });
  const [editing, setEditing] = useState<CellComponent | null>(null);
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CellComponent> }) =>
      cellComponentsApi.update(id, payload),
    onSuccess: () => {
      setEditing(null);
      refetch();
    },
  });

  const fields: FieldDef[] = [
    { name: "part_nr", label: t("fields.partNr") },
    { name: "name", label: t("fields.name") },
    { name: "drawing_nr", label: t("fields.drawingNr") },
    { name: "revision", label: t("fields.revision") },
    { name: "parts_per_element", label: t("fields.partsPerElement"), type: "number", step: "0.01" },
    { name: "element_count", label: t("fields.elementCount"), type: "number" },
    { name: "reserve_index", label: t("fields.reserveIndex"), type: "number", step: "0.01" },
  ];

  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={(error as Error).message} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.cellComponentsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-[var(--win-muted)]">{t("settings.cellComponentsHelp")}</p>
        <DataTable
          columns={[
            { key: "part_nr", header: t("fields.partNr") },
            { key: "name", header: t("fields.name"), render: (row) => cellComponentLabel(row, t) },
            { key: "drawing_nr", header: t("fields.drawingNr") },
            { key: "total_parts", header: t("fields.totalParts") },
            { key: "recommended_spares", header: t("fields.recommendedSpares") },
            { key: "calculated_spares", header: t("fields.calculatedSpares") },
          ]}
          data={data}
          keyField="id"
          emptyTitle={t("settings.noCellComponents")}
          actions={
            editable
              ? (row) => (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                    <Pencil size={13} />
                  </Button>
                )
              : undefined
          }
        />
      </CardContent>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("settings.editComponent", { name: editing ? cellComponentLabel(editing, t) : t("settings.component") })}>
        {editing && (
          <ResourceForm<CellComponent>
            fields={fields}
            initialValues={{ ...editing, name: cellComponentLabel(editing, t) }}
            onCancel={() => setEditing(null)}
            submitting={updateMutation.isPending}
            readOnly={!editable}
            onSubmit={(values) => {
              const shown = cellComponentLabel(editing, t);
              const nextName = values.name ?? "";
              updateMutation.mutate({
                id: editing.id,
                payload: {
                  ...values,
                  name: nextName.trim() === shown.trim() ? editing.name : values.name,
                },
              });
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function numberNameFields(t: T): FieldDef[] {
  return [
    { name: "nr", label: t("fields.number"), type: "number", required: true },
    { name: "name", label: t("fields.name") },
  ];
}

function numberNameColumns(t: T) {
  return [
    { key: "nr", header: t("fields.number") },
    { key: "name", header: t("fields.name") },
  ];
}

function AppearanceTab() {
  const { t } = useI18n();
  const { preset, resolvedColors, fontSize, setPreset, setColor, setFontSize, reset } = useTheme();

  const presets: { value: ThemePresetId; icon: typeof Sun; swatch: string }[] = [
    { value: "classic", icon: Sun, swatch: NAMED_PRESETS.classic.navy },
    { value: "dark", icon: Moon, swatch: NAMED_PRESETS.dark.navy },
    { value: "system", icon: MonitorCog, swatch: "#808080" },
    { value: "contrast", icon: Contrast, swatch: NAMED_PRESETS.contrast.navy },
    { value: "ocean", icon: Waves, swatch: NAMED_PRESETS.ocean.navy },
    { value: "forest", icon: Trees, swatch: NAMED_PRESETS.forest.navy },
    { value: "wine", icon: Grape, swatch: NAMED_PRESETS.wine.navy },
    { value: "sand", icon: Wheat, swatch: NAMED_PRESETS.sand.navy },
    { value: "custom", icon: Palette, swatch: resolvedColors.navy },
  ];

  const colorFields: { key: keyof ThemeColors; labelKey: string }[] = [
    { key: "navy", labelKey: "appearance.colorAccent" },
    { key: "face", labelKey: "appearance.colorWindow" },
    { key: "panel", labelKey: "appearance.colorPanel" },
    { key: "text", labelKey: "appearance.colorText" },
    { key: "muted", labelKey: "appearance.colorMuted" },
    { key: "input", labelKey: "appearance.colorInput" },
    { key: "danger", labelKey: "appearance.colorDanger" },
    { key: "border", labelKey: "appearance.colorBorder" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-[var(--win-muted)]">{t("appearance.description")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {presets.map(({ value, icon: Icon, swatch }) => {
              const active = preset === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPreset(value)}
                  className={
                    active
                      ? "flex flex-col items-start gap-1.5 border-2 border-[var(--win-navy)] bg-[var(--win-navy)] px-3 py-3 text-start text-white rounded-lg"
                      : "flex flex-col items-start gap-1.5 border-2 border-[var(--win-face)] bg-[var(--win-face)] px-3 py-3 text-start rounded-lg hover:bg-[var(--win-face-hi)]"
                  }
                >
                  <div className="flex w-full items-center justify-between">
                    <Icon size={18} className={active ? "text-white" : "text-[var(--win-navy)]"} />
                    <span className="h-3 w-3 border border-black/30" style={{ background: swatch }} />
                  </div>
                  <div className="text-sm font-bold">{t(`appearance.preset.${value}`)}</div>
                  <div className={active ? "text-[11px] text-white/80" : "text-[11px] text-[var(--win-muted)]"}>
                    {t(`appearance.presetDesc.${value}`)}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.customColors")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--win-muted)]">{t("appearance.customColorsDesc")}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {colorFields.map(({ key, labelKey }) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="color"
                  value={resolvedColors[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  className="h-8 w-10 cursor-pointer border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)]"
                />
                <span className="min-w-[90px] text-xs font-bold text-[var(--win-muted)]">{t(labelKey)}</span>
                <input
                  type="text"
                  value={resolvedColors[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  className="w-24 border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)] px-1 py-0.5 font-mono text-xs text-[var(--win-text)]"
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.fontSize")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="range"
              min={11}
              max={18}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-48"
            />
            <span className="text-sm font-bold text-[var(--win-navy)]">{fontSize}px</span>
            <Button size="sm" variant="secondary" onClick={reset}>
              {t("appearance.reset")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { canEdit, isAdmin } = useAuth();
  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.description")} helpKey="settings" />
      <Tabs
        tabs={[
          { key: "plant", label: t("settings.tabPlant"), content: <PlantInfoTab /> },
          {
            key: "electrolyzers",
            label: t("settings.tabElectrolyzers"),
            content: (
              <LookupTable<Electrolyzer>
                queryKey="electrolyzers"
                api={electrolyzersApi}
                title={t("settings.electrolyzer")}
                keyField="nr"
                fields={numberNameFields(t)}
                columns={numberNameColumns(t)}
              />
            ),
          },
          {
            key: "sub-plants",
            label: t("settings.tabSubPlants"),
            content: (
              <LookupTable<SubPlant>
                queryKey="sub-plants"
                api={subPlantsApi}
                title={t("settings.subPlant")}
                keyField="nr"
                fields={numberNameFields(t)}
                columns={numberNameColumns(t)}
              />
            ),
          },
          {
            key: "full-plants",
            label: t("settings.tabFullPlants"),
            content: (
              <LookupTable<FullPlant>
                queryKey="full-plants"
                api={fullPlantsApi}
                title={t("settings.fullPlant")}
                keyField="id"
                fields={[
                  { name: "id", label: t("fields.id"), type: "number", required: true },
                  { name: "language_id", label: t("fields.languageId"), type: "number" },
                  { name: "name", label: t("fields.name") },
                ]}
                columns={[
                  { key: "id", header: t("fields.id") },
                  { key: "name", header: t("fields.name") },
                  { key: "language_id", header: t("fields.languageId") },
                ]}
              />
            ),
          },
          {
            key: "rectifiers",
            label: t("settings.tabRectifiers"),
            content: (
              <LookupTable<Rectifier>
                queryKey="rectifiers"
                api={rectifiersApi}
                title={t("settings.rectifier")}
                keyField="nr"
                fields={numberNameFields(t)}
                columns={numberNameColumns(t)}
              />
            ),
          },
          {
            key: "transformers",
            label: t("settings.tabTransformers"),
            content: (
              <LookupTable<Transformer>
                queryKey="transformers"
                api={transformersApi}
                title={t("settings.transformer")}
                keyField="nr"
                fields={numberNameFields(t)}
                columns={numberNameColumns(t)}
              />
            ),
          },
          {
            key: "arrangements",
            label: t("settings.tabArrangements"),
            content: (
              <LookupTable<ElectrolyzerArrangement>
                queryKey="arrangements"
                api={arrangementsApi}
                title={t("settings.arrangement")}
                fields={[
                  { name: "name", label: t("fields.name") },
                  { name: "sub_plant", label: t("fields.subPlant") },
                  { name: "transformer", label: t("fields.transformer") },
                  { name: "rectifier", label: t("fields.rectifier") },
                  { name: "block", label: t("fields.block") },
                  { name: "start_position", label: t("fields.startPosition") },
                  { name: "end_position", label: t("fields.endPosition") },
                ]}
                columns={[
                  { key: "name", header: t("fields.name") },
                  { key: "sub_plant", header: t("fields.subPlant") },
                  { key: "transformer", header: t("fields.transformer") },
                  { key: "rectifier", header: t("fields.rectifier") },
                  { key: "block", header: t("fields.block") },
                  { key: "start_position", header: t("fields.start") },
                  { key: "end_position", header: t("fields.end") },
                ]}
              />
            ),
          },
          {
            key: "reserve-positions",
            label: t("settings.tabReservePositions"),
            content: (
              <LookupTable<ReservePosition>
                queryKey="reserve-positions"
                api={reservePositionsApi}
                title={t("settings.reservePosition")}
                fields={[{ name: "position", label: t("fields.position") }]}
                columns={[{ key: "position", header: t("fields.position") }]}
              />
            ),
          },
          {
            key: "correction-factors",
            label: t("settings.tabCorrectionFactors"),
            content: (
              <LookupTable<CorrectionFactor>
                queryKey="correction-factors"
                api={correctionFactorsApi}
                title={t("settings.correctionFactor")}
                fields={[
                  { name: "reference_current_density", label: t("fields.referenceCurrentDensity"), type: "number", step: "0.01" },
                  { name: "temp_correction", label: t("voltage.measuredTemp"), type: "number", step: "0.001" },
                  { name: "conc_correction", label: t("voltage.measuredConc"), type: "number", step: "0.001" },
                ]}
                columns={[
                  { key: "reference_current_density", header: t("fields.referenceCurrentDensity") },
                  { key: "temp_correction", header: t("voltage.measuredTemp") },
                  { key: "conc_correction", header: t("voltage.measuredConc") },
                ]}
              />
            ),
          },
          {
            key: "electrode-areas",
            label: t("settings.tabElectrodeAreas"),
            content: (
              <LookupTable<ElectrodeArea>
                queryKey="electrode-areas"
                api={electrodeAreasApi}
                title={t("settings.electrodeArea")}
                fields={[{ name: "area_m2", label: t("fields.areaM2"), type: "number", step: "0.01" }]}
                columns={[{ key: "area_m2", header: t("fields.areaM2") }]}
              />
            ),
          },
          {
            key: "voltage-classes",
            label: t("settings.tabVoltageClasses"),
            content: (
              <LookupTable<VoltageDistributionClass>
                queryKey="voltage-distribution-classes"
                api={voltageDistributionClassesApi}
                title={t("settings.voltageClass")}
                fields={[
                  { name: "label", label: t("fields.label") },
                  { name: "lower_bound", label: t("fields.lowerBound"), type: "number", step: "0.01" },
                  { name: "upper_bound", label: t("fields.upperBound"), type: "number", step: "0.01" },
                ]}
                columns={[
                  { key: "label", header: t("fields.label") },
                  { key: "lower_bound", header: t("fields.lower") },
                  { key: "upper_bound", header: t("fields.upper") },
                ]}
              />
            ),
          },
          {
            key: "groups",
            label: t("settings.tabGroups"),
            content: (
              <LookupTable<GroupDefinition>
                queryKey="group-definitions"
                api={groupDefinitionsApi}
                title={t("settings.group")}
                keyField="group_nr"
                fields={[
                  { name: "group_nr", label: t("fields.groupNr"), required: true },
                  { name: "anode_coating", label: t("fields.anodeCoating") },
                  { name: "cathode_coating", label: t("fields.cathodeCoating") },
                  { name: "membrane_type", label: t("fields.membraneType") },
                  { name: "gap_mm", label: t("fields.gapMm") },
                  { name: "remarks", label: t("fields.remarks"), type: "textarea", span: 2 },
                ]}
                columns={[
                  { key: "group_nr", header: t("fields.groupNr") },
                  { key: "anode_coating", header: t("fields.anodeCoating") },
                  { key: "cathode_coating", header: t("fields.cathodeCoating") },
                  { key: "membrane_type", header: t("fields.membraneType") },
                  { key: "gap_mm", header: t("fields.gapMm") },
                ]}
              />
            ),
          },
          {
            key: "inspection-reasons",
            label: t("settings.tabInspectionReasons"),
            content: (
              <LookupTable<InspectionReason>
                queryKey="inspection-reasons"
                api={inspectionReasonsApi}
                title={t("settings.inspectionReason")}
                fields={[
                  { name: "code", label: t("fields.code") },
                  { name: "reason", label: t("fields.reason") },
                  { name: "selected", label: t("fields.selectedByDefault"), type: "checkbox" },
                ]}
                columns={[
                  { key: "code", header: t("fields.code") },
                  { key: "reason", header: t("fields.reason"), render: (row) => inspectionReasonLabel(row.reason, t) },
                  { key: "count", header: t("fields.count") },
                ]}
              />
            ),
          },
          {
            key: "inspection-findings",
            label: t("settings.tabInspectionFindings"),
            content: (
              <LookupTable<InspectionFinding>
                queryKey="inspection-findings"
                api={inspectionFindingsApi}
                title={t("settings.inspectionFinding")}
                fields={[
                  { name: "code", label: t("fields.code") },
                  { name: "text", label: t("fields.text") },
                  { name: "selected", label: t("fields.selectedByDefault"), type: "checkbox" },
                ]}
                columns={[
                  { key: "code", header: t("fields.code") },
                  { key: "text", header: t("fields.text") },
                  { key: "count", header: t("fields.count") },
                ]}
              />
            ),
          },
          { key: "cell-components", label: t("settings.tabCellComponents"), content: <CellComponentsTab /> },
          { key: "appearance", label: t("appearance.title"), content: <AppearanceTab /> },
          ...(canEdit("import_export")
            ? [{ key: "import-export", label: t("importExport.title"), content: <ImportExportTab /> }]
            : []),
          ...(canEdit("settings") ? [{ key: "backup", label: t("backup.title"), content: <BackupTab /> }] : []),
          ...(isAdmin ? [{ key: "database", label: t("database.title"), content: <DatabaseTab /> }] : []),
          ...(isAdmin ? [{ key: "directory", label: t("directory.title"), content: <DirectoryTab /> }] : []),
        ]}
      />
    </div>
  );
}
