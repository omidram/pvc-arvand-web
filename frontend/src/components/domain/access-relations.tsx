"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AccessSubform } from "@/components/layout/access-form";
import { SubResourcePanel } from "@/components/domain/sub-resource-panel";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  anodeCoatingChecksApi,
  anodeMaintenanceApi,
  anodeRecoatingApi,
  cathodeCoatingChecksApi,
  cathodeMaintenanceApi,
  cathodeRecoatingApi,
  electrodeSegregationsApi,
  elementsApi,
  inspectionsApi,
  membraneMaintenanceApi,
} from "@/lib/endpoints";
import type {
  AnodeCoatingCheck,
  AnodeMaintenance,
  AnodeRecoating,
  CathodeCoatingCheck,
  CathodeMaintenance,
  CathodeRecoating,
  ElectrodeSegregation,
  Element,
  InspectionReport,
  MembraneMaintenance,
} from "@/lib/types";
import { formatDate, sameNr } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { inspectionReasonLabel } from "@/lib/inspection-reason-names";
import type { FieldDef } from "@/components/ui/resource-form";

type TFn = ReturnType<typeof useI18n>["t"];

function maintenanceFields(t: TFn): FieldDef[] {
  return [
    { name: "date", label: t("fields.date"), type: "date" },
    { name: "finding", label: t("fields.finding"), type: "textarea", span: 2 },
    { name: "action", label: t("fields.action"), type: "textarea", span: 2 },
    { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
    { name: "return_date", label: t("fields.returnDate"), type: "date" },
  ];
}

export function RelatedLinks({
  anodeNr,
  cathodeNr,
  membraneNr,
  elementNr,
  serialNr,
}: {
  anodeNr?: string | null;
  cathodeNr?: string | null;
  membraneNr?: string | null;
  elementNr?: string | null;
  serialNr?: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {anodeNr ? (
        <Link href={`/anodes?anode_nr=${encodeURIComponent(anodeNr)}`} className="access-menu-btn !w-auto px-3">
          {t("access.openAnode")} {anodeNr}
        </Link>
      ) : null}
      {cathodeNr ? (
        <Link href={`/cathodes?cathode_nr=${encodeURIComponent(cathodeNr)}`} className="access-menu-btn !w-auto px-3">
          {t("access.openCathode")} {cathodeNr}
        </Link>
      ) : null}
      {membraneNr ? (
        <Link href={`/membranes?membrane_nr=${encodeURIComponent(membraneNr)}`} className="access-menu-btn !w-auto px-3">
          {t("access.openMembrane")} {membraneNr}
        </Link>
      ) : null}
      {elementNr ? (
        <Link href={`/elements/assembly?element_nr=${encodeURIComponent(elementNr)}`} className="access-menu-btn !w-auto px-3">
          {t("access.openElement")} {elementNr}
        </Link>
      ) : null}
      {serialNr ? (
        <Link href={`/segregation?serial_nr=${encodeURIComponent(serialNr)}`} className="access-menu-btn !w-auto px-3">
          {t("access.openTafkik")} {serialNr}
        </Link>
      ) : null}
    </div>
  );
}

function TafkikTable({ serial, kind }: { serial: string; kind?: "anode" | "cathode" }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["electrode-segregations", { q: serial, electrode_kind: kind, limit: 200 }],
    queryFn: () =>
      electrodeSegregationsApi.list({
        q: serial,
        limit: 200,
        ...(kind ? { electrode_kind: kind } : {}),
      }),
    enabled: !!serial,
  });
  const rows = (query.data || []).filter((row) => sameNr(row.serial_nr, serial));
  const caption =
    kind === "anode"
      ? `${t("access.relatedSegregation")} — ${t("segregation.anode")} ${serial}`
      : kind === "cathode"
        ? `${t("access.relatedSegregation")} — ${t("segregation.cathode")} ${serial}`
        : t("access.relatedSegregation");
  return (
    <AccessSubform caption={caption}>
      <DataTable
        columns={[
          { key: "serial_nr", header: t("segregation.serialNr") },
          { key: "inspection_date", header: t("segregation.inspectionDate"), render: (r: ElectrodeSegregation) => formatDate(r.inspection_date) },
          { key: "install_date", header: t("segregation.installDate"), render: (r: ElectrodeSegregation) => formatDate(r.install_date) },
          { key: "disassemble_date", header: t("segregation.disassembleDate"), render: (r: ElectrodeSegregation) => formatDate(r.disassemble_date) },
          { key: "decision", header: t("segregation.decision") },
          { key: "pallet", header: t("segregation.pallet") },
        ]}
        data={rows}
        keyField="id"
        isLoading={query.isLoading}
        onRowClick={(r) => {
          window.location.href = `/segregation?serial_nr=${encodeURIComponent(r.serial_nr)}`;
        }}
        emptyTitle={t("common.noRecordsFound")}
      />
    </AccessSubform>
  );
}

export function ElementRelations({ row }: { row: Element }) {
  const { t } = useI18n();
  const historyQuery = useQuery({
    queryKey: ["elements", "history", row.element_nr],
    queryFn: () => elementsApi.history(row.element_nr!),
    enabled: !!row.element_nr,
  });
  // Inspections are stored per Element Nr, and the search box is a substring match
  // ("10" also finds "1000000"): keep exact element numbers only.
  const inspectionsQuery = useQuery({
    queryKey: ["inspections", { q: row.element_nr, limit: 2000 }],
    queryFn: () => inspectionsApi.list({ q: row.element_nr, limit: 2000 }),
    enabled: !!row.element_nr,
  });
  const inspections = (inspectionsQuery.data || []).filter((r) => sameNr(r.element_nr, row.element_nr));

  const historyCols: Column<Element>[] = [
    { key: "electrolyzer", header: t("fields.electrolyzer") },
    { key: "position", header: t("fields.positionShort") },
    { key: "assembly_date", header: t("fields.assemblyDate"), render: (r) => formatDate(r.assembly_date) },
    { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (r) => formatDate(r.disassembly_date) },
    { key: "anode_nr", header: t("fields.anode") },
    { key: "cathode_nr", header: t("fields.cathode") },
    { key: "membrane_nr", header: t("fields.membrane") },
    { key: "computed_dol_days", header: t("fields.dolDays"), render: (r) => r.computed_dol_days ?? "—" },
    { key: "status", header: t("fields.status") },
  ];
  const inspectionCols: Column<InspectionReport>[] = [
    { key: "inspection_date", header: t("fields.date"), render: (r) => formatDate(r.inspection_date) },
    { key: "inspection_reason", header: t("fields.inspectionReason"), render: (r) => inspectionReasonLabel(r.inspection_reason, t) },
    { key: "inspector_name", header: t("fields.inspector") },
  ];

  return (
    <>
      <RelatedLinks anodeNr={row.anode_nr} cathodeNr={row.cathode_nr} membraneNr={row.membrane_nr} />
      <AccessSubform caption={t("access.relatedHistory")}>
        <DataTable
          columns={historyCols}
          data={historyQuery.data}
          keyField="id"
          isLoading={historyQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/elements/assembly?element_nr=${encodeURIComponent(r.element_nr || "")}&id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedInspections")}>
        <DataTable
          columns={inspectionCols}
          data={inspections}
          keyField="id"
          isLoading={inspectionsQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/inspections?id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
      {row.anode_nr ? <TafkikTable serial={row.anode_nr} kind="anode" /> : null}
      {row.cathode_nr ? <TafkikTable serial={row.cathode_nr} kind="cathode" /> : null}
    </>
  );
}

export function AnodeRelations({ anodeNr }: { anodeNr: string }) {
  const { t } = useI18n();
  const elementsQuery = useQuery({
    queryKey: ["elements", { q: anodeNr, limit: 200 }],
    queryFn: () => elementsApi.list({ q: anodeNr, limit: 200 }),
  });
  return (
    <>
      <AccessSubform caption={t("access.relatedMaintenance")}>
        <SubResourcePanel<AnodeMaintenance>
          queryKey="anode-maintenance"
          api={anodeMaintenanceApi}
          parentField="anode_nr"
          parentValue={anodeNr}
          keyField="id"
          title={t("access.relatedMaintenance")}
          fields={maintenanceFields(t)}
          formKey="anodes"
          columns={[
            { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
            { key: "finding", header: t("fields.finding") },
            { key: "action", header: t("fields.action") },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedRecoating")}>
        <SubResourcePanel<AnodeRecoating>
          queryKey="anode-recoating"
          api={anodeRecoatingApi}
          parentField="anode_nr"
          parentValue={anodeNr}
          keyField="id"
          title={t("access.relatedRecoating")}
          fields={[
            { name: "coating_nr", label: t("fields.coatingNr") },
            { name: "recoating_number", label: t("fields.recoatingNumber") },
            { name: "manufacturer", label: t("fields.manufacturer") },
            { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
            { name: "return_date", label: t("fields.returnDate"), type: "date" },
          ]}
          formKey="anodes"
          columns={[
            { key: "coating_nr", header: t("fields.coatingNr") },
            { key: "manufacturer", header: t("fields.manufacturer") },
            { key: "dispatch_date", header: t("fields.dispatched"), render: (r) => formatDate(r.dispatch_date) },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedCoatingChecks")}>
        <SubResourcePanel<AnodeCoatingCheck>
          queryKey="anode-coating-checks"
          api={anodeCoatingChecksApi}
          parentField="anode_nr"
          parentValue={anodeNr}
          keyField="id"
          title={t("access.relatedCoatingChecks")}
          fields={[
            { name: "check_date", label: t("fields.checkDate"), type: "date" },
            { name: "inspector", label: t("fields.inspector") },
            { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
            { name: "potential", label: t("fields.potential"), type: "number", step: "0.01" },
          ]}
          formKey="anodes"
          columns={[
            { key: "check_date", header: t("fields.date"), render: (r) => formatDate(r.check_date) },
            { key: "inspector", header: t("fields.inspector") },
            { key: "residual_thickness", header: t("fields.residualThickness") },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedElements")}>
        <DataTable
          columns={[
            { key: "element_nr", header: t("fields.elementNr") },
            { key: "electrolyzer", header: t("fields.electrolyzer") },
            { key: "position", header: t("fields.position") },
            { key: "assembly_date", header: t("fields.assemblyDate"), render: (r) => formatDate(r.assembly_date) },
            { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (r) => formatDate(r.disassembly_date) },
          ]}
          data={(elementsQuery.data || []).filter((e) => sameNr(e.anode_nr, anodeNr))}
          keyField="id"
          isLoading={elementsQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/elements/assembly?id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
      <TafkikTable serial={anodeNr} kind="anode" />
    </>
  );
}

export function CathodeRelations({ cathodeNr }: { cathodeNr: string }) {
  const { t } = useI18n();
  const elementsQuery = useQuery({
    queryKey: ["elements", { q: cathodeNr, limit: 200 }],
    queryFn: () => elementsApi.list({ q: cathodeNr, limit: 200 }),
  });
  return (
    <>
      <AccessSubform caption={t("access.relatedMaintenance")}>
        <SubResourcePanel<CathodeMaintenance>
          queryKey="cathode-maintenance"
          api={cathodeMaintenanceApi}
          parentField="cathode_nr"
          parentValue={cathodeNr}
          keyField="id"
          title={t("access.relatedMaintenance")}
          fields={maintenanceFields(t)}
          formKey="cathodes"
          columns={[
            { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
            { key: "finding", header: t("fields.finding") },
            { key: "action", header: t("fields.action") },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedRecoating")}>
        <SubResourcePanel<CathodeRecoating>
          queryKey="cathode-recoating"
          api={cathodeRecoatingApi}
          parentField="cathode_nr"
          parentValue={cathodeNr}
          keyField="id"
          title={t("access.relatedRecoating")}
          fields={[
            { name: "manufacturer", label: t("fields.manufacturer") },
            { name: "dispatch_date", label: t("fields.dispatchDate"), type: "date" },
            { name: "return_date", label: t("fields.returnDate"), type: "date" },
          ]}
          formKey="cathodes"
          columns={[
            { key: "manufacturer", header: t("fields.manufacturer") },
            { key: "dispatch_date", header: t("fields.dispatched"), render: (r) => formatDate(r.dispatch_date) },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedCoatingChecks")}>
        <SubResourcePanel<CathodeCoatingCheck>
          queryKey="cathode-coating-checks"
          api={cathodeCoatingChecksApi}
          parentField="cathode_nr"
          parentValue={cathodeNr}
          keyField="id"
          title={t("access.relatedCoatingChecks")}
          fields={[
            { name: "check_date", label: t("fields.checkDate"), type: "date" },
            { name: "inspector", label: t("fields.inspector") },
            { name: "residual_thickness", label: t("fields.residualThickness"), type: "number", step: "0.01" },
          ]}
          formKey="cathodes"
          columns={[
            { key: "check_date", header: t("fields.date"), render: (r) => formatDate(r.check_date) },
            { key: "inspector", header: t("fields.inspector") },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedElements")}>
        <DataTable
          columns={[
            { key: "element_nr", header: t("fields.elementNr") },
            { key: "electrolyzer", header: t("fields.electrolyzer") },
            { key: "position", header: t("fields.position") },
            { key: "assembly_date", header: t("fields.assemblyDate"), render: (r) => formatDate(r.assembly_date) },
            { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (r) => formatDate(r.disassembly_date) },
          ]}
          data={(elementsQuery.data || []).filter((e) => sameNr(e.cathode_nr, cathodeNr))}
          keyField="id"
          isLoading={elementsQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/elements/assembly?id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
      <TafkikTable serial={cathodeNr} kind="cathode" />
    </>
  );
}

export function MembraneRelations({ membraneNr }: { membraneNr: string }) {
  const { t } = useI18n();
  const elementsQuery = useQuery({
    queryKey: ["elements", { q: membraneNr, limit: 200 }],
    queryFn: () => elementsApi.list({ q: membraneNr, limit: 200 }),
  });
  return (
    <>
      <AccessSubform caption={t("access.relatedMaintenance")}>
        <SubResourcePanel<MembraneMaintenance>
          queryKey="membrane-maintenance"
          api={membraneMaintenanceApi}
          parentField="membrane_nr"
          parentValue={membraneNr}
          keyField="id"
          title={t("access.relatedMaintenance")}
          fields={[
            { name: "date", label: t("fields.date"), type: "date" },
            { name: "repair_work", label: t("fields.repairWork"), type: "textarea", span: 2 },
          ]}
          formKey="membranes"
          columns={[
            { key: "date", header: t("fields.date"), render: (r) => formatDate(r.date) },
            { key: "repair_work", header: t("fields.repairWork") },
          ]}
        />
      </AccessSubform>
      <AccessSubform caption={t("access.relatedElements")}>
        <DataTable
          columns={[
            { key: "element_nr", header: t("fields.elementNr") },
            { key: "electrolyzer", header: t("fields.electrolyzer") },
            { key: "position", header: t("fields.position") },
          ]}
          data={(elementsQuery.data || []).filter((e) => sameNr(e.membrane_nr, membraneNr))}
          keyField="id"
          isLoading={elementsQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/elements/assembly?id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
    </>
  );
}

export function SegregationRelations({ row }: { row: ElectrodeSegregation }) {
  const { t } = useI18n();
  const serial = row.serial_nr;
  const elementsQuery = useQuery({
    queryKey: ["elements", { q: serial, limit: 200 }],
    queryFn: () => elementsApi.list({ q: serial, limit: 200 }),
    enabled: !!serial,
  });
  const related = (elementsQuery.data || []).filter(
    (el) => sameNr(el.anode_nr, serial) || sameNr(el.cathode_nr, serial)
  );
  return (
    <>
      <RelatedLinks
        anodeNr={row.electrode_kind === "cathode" ? null : serial}
        cathodeNr={row.electrode_kind === "anode" ? null : serial}
      />
      <AccessSubform caption={t("access.relatedElements")}>
        <DataTable
          columns={[
            { key: "element_nr", header: t("fields.elementNr") },
            { key: "electrolyzer", header: t("fields.electrolyzer") },
            { key: "position", header: t("fields.position") },
            { key: "anode_nr", header: t("fields.anode") },
            { key: "cathode_nr", header: t("fields.cathode") },
            { key: "assembly_date", header: t("fields.assemblyDate"), render: (r) => formatDate(r.assembly_date) },
            { key: "disassembly_date", header: t("fields.disassemblyDate"), render: (r) => formatDate(r.disassembly_date) },
          ]}
          data={related}
          keyField="id"
          isLoading={elementsQuery.isLoading}
          onRowClick={(r) => {
            window.location.href = `/elements/assembly?id=${r.id}`;
          }}
          emptyTitle={t("common.noRecordsFound")}
        />
      </AccessSubform>
    </>
  );
}

export function InspectionRelations({ row }: { row: InspectionReport }) {
  return (
    <>
      <RelatedLinks
        elementNr={row.element_nr}
        anodeNr={row.anode_nr}
        cathodeNr={row.cathode_nr}
        membraneNr={row.membrane_nr}
      />
      {row.anode_nr ? <TafkikTable serial={row.anode_nr} kind="anode" /> : null}
      {row.cathode_nr ? <TafkikTable serial={row.cathode_nr} kind="cathode" /> : null}
    </>
  );
}
