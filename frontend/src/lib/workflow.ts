import { apiClient } from "./api-client";

export type WfFlow = "coating" | "purchase";
export type WfGroup = "c90" | "procurement" | "warehouse" | "inspection";
export type WfKind = "anode" | "cathode";

export const COATING_STEPS = ["await_company", "await_indent", "await_dispatch", "at_coater", "await_report", "await_inspection", "await_approval", "completed"] as const;
export const PURCHASE_STEPS = ["await_indent", "await_order", "ordered", "await_registration", "completed"] as const;
export const DELAY_PARTIES = ["employer", "company", "transport", "other"] as const;
/** Any of these opens the warehouse page (workflow groups included). */
export const WAREHOUSE_VIEW_KEYS = ["storage", "anodes", "cathodes", "membranes", "wf_c90", "wf_procurement", "wf_warehouse", "wf_inspection"];

export interface WfSummary {
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
  registered?: number;
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
}

export interface WfDetail extends WfSummary {
  delay_party: string | null;
  delay_reason: string | null;
  remarks: string | null;
  completed_at: string | null;
  pallet_size?: number;
  packages?: { id: number; code: string; pallet_no: number; has_report: boolean; items: WfCoatingItem[] }[];
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
  groups: WfGroup[];
  view_groups: WfGroup[];
  delay_parties: string[];
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

export const workflowApi = {
  meta: async (): Promise<WfMeta> => (await apiClient.get("/workflow/meta")).data,
  summary: async (): Promise<{ cartable: number; unread: number; items: WfNotice[] }> => (await apiClient.get("/workflow/summary")).data,
  notifications: async (limit = 20): Promise<WfNotice[]> => (await apiClient.get("/workflow/notifications", { params: { limit } })).data,
  markRead: async (body: { ids?: number[]; flow?: WfFlow; record_id?: number; all?: boolean }) =>
    (await apiClient.post("/workflow/notifications/read", body)).data,
  cartable: async (): Promise<WfSummary[]> => (await apiClient.get("/workflow/cartable")).data,
  list: async (flow: WfFlow, params?: { status?: string; open_only?: boolean }): Promise<WfSummary[]> =>
    (await apiClient.get(`/workflow/${flow}`, { params })).data,
  get: async (flow: WfFlow, id: number): Promise<WfDetail> => (await apiClient.get(`/workflow/${flow}/${id}`)).data,
  createCoating: async (body: {
    anodes: { serial: string; problem?: string | null }[];
    cathodes: { serial: string; problem?: string | null }[];
    pallet_size: number;
    separate_kinds: boolean;
    remarks?: string;
    allow_unknown?: boolean;
  }): Promise<WfDetail> => (await apiClient.post("/workflow/coating", body)).data,
  createPurchase: async (body: { supplier_id: number; anode_count: number; cathode_count: number; approval_ref?: string; remarks?: string }): Promise<WfDetail> =>
    (await apiClient.post("/workflow/purchase", body)).data,
  step: async (flow: WfFlow, id: number, action: string, body: Record<string, unknown>): Promise<WfDetail> =>
    (await apiClient.post(`/workflow/${flow}/${id}/${action}`, body)).data,
  uploadReport: async (id: number, files: File[], packageId?: number | null, note?: string): Promise<{ rows_filled: number; detail: WfDetail }> =>
    (await apiClient.post(`/workflow/coating/${id}/report`, filesForm(files, { package_id: packageId, note }), multipart)).data,
  attach: async (flow: WfFlow, id: number, files: File[], note?: string) =>
    (await apiClient.post(`/workflow/${flow}/${id}/files`, filesForm(files, { note }), multipart)).data,
  downloadFile: (file: WfFile) => saveBlob(`/workflow/files/${file.id}`, file.name),
  downloadExcel: (id: number, name: string, packageId?: number) =>
    saveBlob(`/workflow/coating/${id}/excel`, `${name}.xlsx`, packageId ? { package_id: packageId } : undefined),
  history: async (params: Record<string, string>): Promise<{ rows: WfHistoryRow[]; totals: Record<string, number> }> =>
    (await apiClient.get("/workflow/history", { params })).data,
  companyReport: async (params: { date_from?: string; date_to?: string } = {}): Promise<WfCompanyStats[]> =>
    (await apiClient.get("/workflow/reports/companies", { params })).data,
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
