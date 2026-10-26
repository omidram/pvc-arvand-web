import type { QueryClient } from "@tanstack/react-query";
import { apiClient } from "./api-client";
import type { PipelineItem } from "./types";

export type WfFlow = "coating" | "purchase" | "cell" | "inspection" | "assemble" | "workorder";
export type WfGroup = "c90" | "procurement" | "warehouse" | "inspection" | "operation" | "cellshop" | "process" | "planner";
export type WfKind = "anode" | "cathode";

export const COATING_STEPS = ["c90_select", "code_generate", "await_company", "await_indent", "await_dispatch", "await_return", "await_inspection", "await_approval", "completed"] as const;
export const PURCHASE_STEPS = ["purchase_request", "await_indent", "await_order", "await_registration", "completed"] as const;
export const CELL_STEPS = ["await_shutdown", "await_shop", "in_shop", "completed"] as const;
export const NUMBERING_STEPS = ["await_numbering", "completed"] as const;

/** Removal stays with the cell shop. Dismantling continues to C-90; a healthy cell waits until it is put back. */
export function cellPath(status: string, decision?: string | null): readonly string[] {
  if (status === "await_numbering") return NUMBERING_STEPS;
  const head = ["await_shutdown", "await_shop", "in_shop"];
  if (status === "await_disassembly" || decision === "disassemble") return [...head, "await_disassembly", "completed"];
  if (status === "await_reinstall" || (decision === "keep" && status !== "completed")) return [...head, "await_reinstall", "completed"];
  if (status === "completed" && decision === "keep") return [...head, "await_reinstall", "completed"];
  return [...head, "completed"];
}
export const INSPECTION_STEPS = ["await_request", "await_inspection", "completed"] as const;
export const ASSEMBLE_STEPS = ["await_assembly", "await_air", "await_insp_sign", "await_proc_sign", "await_position", "completed"] as const;
/** Stages that carry a deadline, per flow (the order of the settings table). */
const VIRTUAL_STEPS = new Set(["c90_select", "code_generate", "purchase_request"]);
export const SLA_STAGES: Record<WfFlow, readonly string[]> = {
  coating: COATING_STEPS.filter((s) => s !== "completed" && !VIRTUAL_STEPS.has(s)),
  purchase: PURCHASE_STEPS.filter((s) => s !== "completed" && !VIRTUAL_STEPS.has(s)),
  cell: [...CELL_STEPS.filter((s) => s !== "completed"), "await_disassembly", "await_reinstall", "await_numbering"],
  inspection: INSPECTION_STEPS.filter((s) => s !== "completed"),
  assemble: ASSEMBLE_STEPS.filter((s) => s !== "completed"),
  workorder: ["open"],
};

/** Where a notice opens: cell requests live in the element dashboard, work orders on their page, the others in the cartable. */
export function workflowHref(flow: string, id: number) {
  if (flow === "cell") return `/element-dashboard?tab=requests&req=${id}`;
  if (flow === "workorder") return `/work-orders?id=${id}`;
  return `/cartable?wf=${flow}:${id}`;
}
export const DELAY_PARTIES = ["employer", "company", "transport", "other"] as const;
/** Any of these opens the warehouse page (workflow groups included). */
export const LIVE_MS = 20_000;
/** The cartable and its notifications refresh faster so every role sees new work at once. */
export const CARTABLE_MS = 10_000;

export type SlaState = "ok" | "warn" | "late";

export interface WfDeadline {
  stage_since?: string | null;
  due_at?: string | null;
  sla_hours?: number | null;
  sla_state?: SlaState | null;
  sla_left_minutes?: number | null;
}

export interface WfSlaConfig {
  hours: Record<string, Record<string, number>>;
  warn_percent: number;
  defaults?: Record<string, Record<string, number>>;
}

/** Warehouse board, lifecycle, workflows and the element dashboard read the same pieces. */
export function refreshWarehouseData(qc: QueryClient) {
  for (const key of ["wf", "wh", "storage", "element-dashboard"]) void qc.invalidateQueries({ queryKey: [key] });
}

export const WAREHOUSE_VIEW_KEYS = ["storage", "anodes", "cathodes", "membranes", "wf_c90", "wf_procurement", "wf_warehouse", "wf_inspection"];
export const CARTABLE_VIEW_KEYS = [...WAREHOUSE_VIEW_KEYS, "wf_operation", "wf_cellshop", "wf_process", "wf_planner", "elements", "inspections"];

export interface WfSummary extends WfDeadline {
  flow: WfFlow;
  id: number;
  title: string;
  code?: string;
  codes: string[];
  status: string;
  groups: WfGroup[];
  anode_count: number;
  cathode_count: number;
  company_id: number | null;
  company_name: string | null;
  indent_no: string | null;
  approval_ref?: string | null;
  dispatch_date: string | null;
  expected_date: string | null;
  actual_date: string | null;
  delay_days: number | null;
  rejected?: boolean;
  rework_count?: number;
  warranty_months?: number | null;
  warranty_start?: string | null;
  registered?: number;
  reason?: string;
  problem?: string | null;
  element_nr?: string | null;
  anode_nr?: string | null;
  cathode_nr?: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_note: string | null;
}

export interface WfFile {
  id: number;
  name: string;
  kind: "report" | "attachment";
  package_id: number | null;
  size: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

export interface WfEvent {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  note: string | null;
  data: Record<string, unknown>;
  created_at: string | null;
}

export interface WfCoatingItem {
  id: number;
  line_no: number;
  element_kind: WfKind;
  serial: string;
  problem: string | null;
  pre_inspection: string | null;
  final_report: string | null;
  remark: string | null;
  inspection?: InspectionBrief | null;
  inspection_request?: { id: number; code: string; status: string } | null;
}

export interface InspectionBrief {
  id: number;
  element_nr: string | null;
  date: string | null;
  inspector: string | null;
}

export interface WfDetail extends WfSummary {
  delay_party: string | null;
  delay_reason: string | null;
  remarks: string | null;
  completed_at: string | null;
  inspections_done?: number;
  inspections_total?: number;
  pallet_size?: number;
  packages?: { id: number; code: string; pallet_no: number; has_report: boolean; dispatch_date?: string | null; expected_return_date?: string | null; items: WfCoatingItem[] }[];
  items?: { id: number; element_kind: WfKind; serial: string; coating: string | null; manufacturer: string | null }[];
  files: WfFile[];
  events: WfEvent[];
  actions: string[];
}

export interface WfNotice {
  id: number;
  flow: WfFlow;
  record_id: number;
  status: string | null;
  title: string | null;
  from_name: string | null;
  created_at: string | null;
  read: boolean;
}

export interface WfHistoryRow {
  flow: WfFlow;
  record_id: number;
  code: string;
  element_kind: WfKind | null;
  serial: string;
  status: string;
  company_name: string | null;
  indent_no: string | null;
  requested_at: string | null;
  sent_date: string | null;
  expected_date: string | null;
  actual_date: string | null;
  delay_days: number | null;
  problem: string | null;
  final_report: string | null;
  remark: string | null;
}

export interface WfCompanyStats {
  company_id: number;
  company_name: string;
  is_coating: boolean;
  is_supplier: boolean;
  coating_requests: number;
  coating_pieces: number;
  coating_anodes: number;
  coating_cathodes: number;
  at_company: number;
  reworks: number;
  purchases: number;
  purchased_anodes: number;
  purchased_cathodes: number;
  deliveries: number;
  on_time: number;
  late: number;
  late_company: number;
  late_by_party: Record<string, number>;
  avg_delay: number | null;
  max_delay: number | null;
}

export interface WfMeta {
  can_view: boolean;
  can_view_cell: boolean;
  can_request_cell: boolean;
  can_view_inspection?: boolean;
  can_request_inspection?: boolean;
  can_request_assemble?: boolean;
  groups: WfGroup[];
  view_groups: WfGroup[];
  delay_parties: string[];
  sla?: WfSlaConfig;
}

export interface InspectionRequest extends WfDeadline {
  flow: "inspection";
  id: number;
  title: string;
  code: string;
  status: string;
  groups: WfGroup[];
  element_nr: string | null;
  element_id: number | null;
  electrolyzer: string | null;
  position: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  disassembly_date: string | null;
  reason: string | null;
  report_id: number | null;
  decisions?: PieceDecisions;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_note: string | null;
}

export interface PieceVerdict {
  healthy?: boolean;
  usable?: boolean;
  quality?: "good" | "medium" | null;
  problem?: "coating" | "mechanical" | "rate_off" | null;
  warranty?: boolean | null;
  problems?: string;
  result?: string;
  xrf?: string | null;
}

export interface PieceDecisions {
  inspection?: { anode?: PieceVerdict; cathode?: PieceVerdict };
  process?: { anode?: PieceVerdict; cathode?: PieceVerdict };
}

export interface InspectionCellCard {
  assembly_date: string | null;
  commissioning_date: string | null;
  decommissioning_date: string | null;
  disassembly_date: string | null;
  membrane_type: string | null;
  gap_mm: string | null;
  anode_coating: string | null;
  cathode_coating: string | null;
  anode_remark: string | null;
  cathode_remark: string | null;
  decommission_reason: string | null;
  dol_days: number | null;
}

export interface AssembleDecision {
  ok?: boolean;
  result?: string | null;
  note?: string | null;
}

export interface AssembleRequest extends WfDeadline {
  flow: "assemble";
  id: number;
  title: string;
  code: string;
  status: string;
  groups: WfGroup[];
  element_nr: string | null;
  element_id: number | null;
  electrolyzer: string | null;
  position: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  membrane_type: string | null;
  anode_source: string | null;
  cathode_source: string | null;
  assembly_date: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_note: string | null;
}

export interface AssembleAirBrief {
  id: number;
  element_nr: string | null;
  filled: boolean;
  checks_done: number;
  checks_total: number;
  sign_maint: boolean;
  sign_insp: boolean;
  sign_proc: boolean;
  sign_maint_name: string | null;
  sign_insp_name: string | null;
  sign_proc_name: string | null;
}

export interface AssembleRequestDetail extends AssembleRequest {
  completed_at: string | null;
  remarks?: string | null;
  reason?: string | null;
  problem?: string | null;
  indent_no?: string | null;
  approval_ref?: string | null;
  expected_date?: string | null;
  planned_date?: string | null;
  air?: AssembleAirBrief | null;
  decisions?: { inspection?: AssembleDecision; process?: AssembleDecision };
  element?: { id: number; element_nr: string | null; electrolyzer: string | null; position: string | null } | null;
  files: WfFile[];
  events: WfEvent[];
  actions: string[];
}

export interface InspectionRequestDetail extends InspectionRequest {
  completed_at: string | null;
  report: InspectionBrief | null;
  anode_xrf?: string | null;
  cathode_xrf?: string | null;
  cell?: InspectionCellCard | null;
  candidates: InspectionBrief[];
  files: WfFile[];
  events: WfEvent[];
  actions: string[];
}

/** Opens a new Element Inspection form already filled with the element of a request. */
export function inspectionFormHref(r: { element_nr?: string | null; anode_nr?: string | null; cathode_nr?: string | null }) {
  const q = new URLSearchParams({ new: "1" });
  if (r.element_nr) q.set("element_nr", r.element_nr);
  if (r.anode_nr) q.set("anode_nr", r.anode_nr);
  if (r.cathode_nr) q.set("cathode_nr", r.cathode_nr);
  return `/inspections?${q.toString()}`;
}

export type CellDecision = "keep" | "disassemble" | "relocated";

export interface CellRequest extends WfDeadline {
  flow: "cell";
  id: number;
  title: string;
  code: string;
  status: string;
  request_kind?: "removal" | "numbering";
  groups: WfGroup[];
  element_nr: string;
  element_id: number | null;
  electrolyzer: string | null;
  position: string | null;
  reason: string;
  urgent: boolean;
  problem: string | null;
  planned_date: string | null;
  decommission_date: string | null;
  received_date: string | null;
  decision: CellDecision | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_note: string | null;
}

export interface CellRequestDetail extends CellRequest {
  completed_at: string | null;
  element: PipelineItem | null;
  files: WfFile[];
  events: WfEvent[];
  actions: string[];
}

const multipart = { headers: { "Content-Type": "multipart/form-data" } };

function filesForm(files: File[], extra: Record<string, string | number | undefined | null> = {}): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") form.append(k, String(v));
  for (const f of files) form.append("files", f);
  return form;
}

async function saveBlob(url: string, filename: string, params?: Record<string, unknown>) {
  const { data } = await apiClient.get(url, { params, responseType: "blob" });
  const href = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(href);
}

/** One anode / cathode from the TAFKIK segregation form (its latest record). */
export interface WfCoatingCandidate {
  serial: string;
  kind: "anode" | "cathode";
  decision: string | null;
  problem: string | null;
  outcome: string;
  pallet: string | null;
  date: string | null;
  busy: boolean;
}

export interface AssemblyPoolRow {
  source: "reusable" | "purchased" | "recoated";
  kind: "anode" | "cathode";
  serial: string;
  company: string | null;
  quality: string | null;
  detail: string | null;
  ref: string | null;
  date: string | null;
  pair_serial: string | null;
  in_catalog: boolean;
}

export interface AssemblyPool {
  reusable: AssemblyPoolRow[];
  purchased: AssemblyPoolRow[];
  recoated: AssemblyPoolRow[];
}

export interface CartableElementBrief {
  id: number;
  element_nr: string | null;
  electrolyzer: string | null;
  position: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  assembly_date: string | null;
  disassembly_date: string | null;
  decommissioning_date: string | null;
}

export interface CartablePoolSnap {
  reusable: number;
  purchased: number;
  recoated: number;
  reusable_preview: AssemblyPoolRow[];
  purchased_preview: AssemblyPoolRow[];
  recoated_preview: AssemblyPoolRow[];
}

export interface CartableDesk {
  groups: WfGroup[];
  edit_groups: WfGroup[];
  view_groups: WfGroup[];
  waiting_total: number;
  late_total: number;
  waiting: WfSummary[];
  by_group: Record<string, { waiting: number; late: number; items: WfSummary[] }>;
  snapshots: Record<string, Record<string, unknown>>;
}

export const workflowApi = {
  assemblyPool: async (): Promise<AssemblyPool> => (await apiClient.get("/workflow/assembly-pool")).data,
  meta: async (): Promise<WfMeta> => (await apiClient.get("/workflow/meta")).data,
  summary: async (): Promise<{ cartable: number; unread: number; late?: number; items: WfNotice[] }> => (await apiClient.get("/workflow/summary")).data,
  notifications: async (limit = 20): Promise<WfNotice[]> => (await apiClient.get("/workflow/notifications", { params: { limit } })).data,
  markRead: async (body: { ids?: number[]; flow?: WfFlow; record_id?: number; all?: boolean }) =>
    (await apiClient.post("/workflow/notifications/read", body)).data,
  cartable: async (): Promise<WfSummary[]> => (await apiClient.get("/workflow/cartable")).data,
  cartableDesk: async (): Promise<CartableDesk> => (await apiClient.get("/workflow/cartable/desk")).data,
  list: async (flow: WfFlow, params?: { status?: string; open_only?: boolean; q?: string }): Promise<WfSummary[]> =>
    (await apiClient.get(`/workflow/${flow}`, { params })).data,
  get: async (flow: WfFlow, id: number): Promise<WfDetail> => (await apiClient.get(`/workflow/${flow}/${id}`)).data,
  coatingCandidates: async (): Promise<WfCoatingCandidate[]> => (await apiClient.get("/workflow/coating-candidates")).data,
  createCoating: async (body: {
    anodes: { serial: string; problem?: string | null }[];
    cathodes: { serial: string; problem?: string | null }[];
    pallet_size: number;
    separate_kinds: boolean;
    remarks?: string;
  }): Promise<WfDetail> => (await apiClient.post("/workflow/coating", body)).data,
  createPurchase: async (body: { supplier_id: number; anode_count: number; cathode_count: number; approval_ref?: string; remarks?: string }): Promise<WfDetail> =>
    (await apiClient.post("/workflow/purchase", body)).data,
  step: async (flow: WfFlow, id: number, action: string, body: Record<string, unknown>): Promise<WfDetail> =>
    (await apiClient.post(`/workflow/${flow}/${id}/${action}`, body)).data,
  update: async (flow: WfFlow, id: number, body: Record<string, unknown>): Promise<WfDetail> =>
    (await apiClient.patch(`/workflow/${flow}/${id}`, body)).data,
  uploadReport: async (id: number, files: File[], packageId?: number | null, note?: string): Promise<{ rows_filled: number; detail: WfDetail }> =>
    (await apiClient.post(`/workflow/coating/${id}/report`, filesForm(files, { package_id: packageId, note }), multipart)).data,
  attach: async (flow: WfFlow, id: number, files: File[], note?: string) =>
    (await apiClient.post(`/workflow/${flow}/${id}/files`, filesForm(files, { note }), multipart)).data,
  downloadFile: (file: WfFile) => saveBlob(`/workflow/files/${file.id}`, file.name),
  downloadInspectionPdf: (report: InspectionBrief) => saveBlob(`/inspections/${report.id}/sheet.pdf`, `inspection-${report.element_nr || report.id}.pdf`),
  downloadExcel: (id: number, name: string, packageId?: number) =>
    saveBlob(`/workflow/coating/${id}/excel`, `${name}.xlsx`, packageId ? { package_id: packageId } : undefined),
  downloadDispatchPack: (id: number, name: string) => saveBlob(`/workflow/coating/${id}/dispatch-pack`, `${name}-pack.zip`),
  history: async (params: Record<string, string>): Promise<{ rows: WfHistoryRow[]; totals: Record<string, number> }> =>
    (await apiClient.get("/workflow/history", { params })).data,
  companyReport: async (params: { date_from?: string; date_to?: string } = {}): Promise<WfCompanyStats[]> =>
    (await apiClient.get("/workflow/reports/companies", { params })).data,
  cellList: async (params: { open_only?: boolean; element_nr?: string; status?: string } = {}): Promise<CellRequest[]> =>
    (await apiClient.get("/workflow/cell", { params })).data,
  cellGet: async (id: number): Promise<CellRequestDetail> => (await apiClient.get(`/workflow/cell/${id}`)).data,
  cellCreate: async (body: {
    element_nr: string;
    reason: string;
    urgent?: boolean;
    problem?: string | null;
    planned_date?: string | null;
    decommission_date?: string | null;
  }): Promise<CellRequestDetail> => (await apiClient.post("/workflow/cell", body)).data,
  cellNumbering: async (body: { electrolyzer: string; position: string; element_nr?: string | null; note?: string | null }): Promise<CellRequestDetail> =>
    (await apiClient.post("/workflow/cell/numbering", body)).data,
  cellStep: async (id: number, action: string, body: Record<string, unknown>): Promise<CellRequestDetail> =>
    (await apiClient.post(`/workflow/cell/${id}/${action}`, body)).data,
  inspectionList: async (params: { open_only?: boolean; serial?: string; status?: string } = {}): Promise<InspectionRequest[]> =>
    (await apiClient.get("/workflow/inspection", { params })).data,
  inspectionGet: async (id: number): Promise<InspectionRequestDetail> => (await apiClient.get(`/workflow/inspection/${id}`)).data,
  inspectionCreate: async (body: { element_nr?: string; anode_nr?: string; cathode_nr?: string; reason?: string; note?: string }): Promise<InspectionRequestDetail> =>
    (await apiClient.post("/workflow/inspection", body)).data,
  inspectionStep: async (id: number, action: string, body: Record<string, unknown>): Promise<InspectionRequestDetail> =>
    (await apiClient.post(`/workflow/inspection/${id}/${action}`, body)).data,
  assembleList: async (params: { open_only?: boolean; status?: string } = {}): Promise<AssembleRequest[]> =>
    (await apiClient.get("/workflow/assemble", { params })).data,
  assembleGet: async (id: number): Promise<AssembleRequestDetail> => (await apiClient.get(`/workflow/assemble/${id}`)).data,
  assembleCreate: async (body: {
    anode_nr: string;
    cathode_nr: string;
    membrane_nr?: string;
    membrane_type?: string;
    element_nr?: string;
    note?: string;
  }): Promise<AssembleRequestDetail> => (await apiClient.post("/workflow/assemble", body)).data,
  assembleStep: async (id: number, action: string, body: Record<string, unknown>): Promise<AssembleRequestDetail> =>
    (await apiClient.post(`/workflow/assemble/${id}/${action}`, body)).data,
  coatingRequestInspections: async (id: number, note?: string): Promise<{ created: number; detail: WfDetail }> =>
    (await apiClient.post(`/workflow/coating/${id}/request_inspections`, { note })).data,
  settings: async (): Promise<WfSlaConfig> => (await apiClient.get("/workflow/settings")).data,
  saveSettings: async (body: { hours: WfSlaConfig["hours"]; warn_percent: number }): Promise<WfSlaConfig> =>
    (await apiClient.put("/workflow/settings", body)).data,
};

/** "A-001 ; dent on flange" or "A-001<TAB>dent" → serial + optional problem note, one per line. */
export function parseSerialLines(text: string): { serial: string; problem: string | null }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const m = line.match(/^([^;|\t]+)(?:[;|\t](.*))?$/);
      if (!m) return [];
      const serials = m[2] === undefined ? m[1].split(",") : [m[1]];
      return serials.map((s) => s.trim()).filter(Boolean).map((serial) => ({ serial, problem: m[2]?.trim() || null }));
    });
}
