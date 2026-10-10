import { apiClient } from "./api-client";
import type * as T from "./types";

/** Generic REST helpers matching backend/app/crud.py's build_crud_router shape. */
function resource<TRead, TWrite = Partial<TRead>>(prefix: string) {
  return {
    list: async (params?: Record<string, unknown>): Promise<TRead[]> => {
      const { data } = await apiClient.get(prefix, { params });
      return data;
    },
    get: async (id: string | number): Promise<TRead> => {
      const { data } = await apiClient.get(`${prefix}/${encodeURIComponent(String(id))}`);
      return data;
    },
    create: async (payload: TWrite): Promise<TRead> => {
      const { data } = await apiClient.post(prefix, payload);
      return data;
    },
    update: async (id: string | number, payload: TWrite): Promise<TRead> => {
      const { data } = await apiClient.put(`${prefix}/${encodeURIComponent(String(id))}`, payload);
      return data;
    },
    remove: async (id: string | number): Promise<void> => {
      await apiClient.delete(`${prefix}/${encodeURIComponent(String(id))}`);
    },
  };
}

// ---------------------------------------------------------------- Config / settings
export const electrolyzersApi = resource<T.Electrolyzer>("/electrolyzers");
export const subPlantsApi = resource<T.SubPlant>("/sub-plants");
export const fullPlantsApi = resource<T.FullPlant>("/full-plants");
export const rectifiersApi = resource<T.Rectifier>("/rectifiers");
export const transformersApi = resource<T.Transformer>("/transformers");
export const arrangementsApi = resource<T.ElectrolyzerArrangement>("/arrangements");

export type ArrangementBoardCell = {
  position: number;
  block: string | null;
  occupied: boolean;
  element_nr: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  membrane_type: string | null;
  assembly_date: string | null;
  commissioning_date: string | null;
  decommissioning_date: string | null;
  element_id: number | null;
};

export type ArrangementBoard = {
  electrolyzer: string | null;
  electrolyzers: string[];
  blocks: {
    id: number;
    name: string | null;
    block: string | null;
    sub_plant: string | null;
    transformer: string | null;
    rectifier: string | null;
    start_position: string | null;
    end_position: string | null;
  }[];
  counts: { positions: number; occupied: number; empty: number };
  cells: ArrangementBoardCell[];
};

export type CellDossier = {
  electrolyzer: string;
  position: number;
  block: {
    id: number;
    block: string | null;
    sub_plant: string | null;
    transformer: string | null;
    rectifier: string | null;
    start_position: string | null;
    end_position: string | null;
  } | null;
  element: T.Element | null;
  history: T.Element[];
  anode: T.Anode | null;
  cathode: T.Cathode | null;
  membrane: T.Membrane | null;
  anode_maintenance: T.AnodeMaintenance[];
  anode_recoating: T.AnodeRecoating[];
  anode_coating: T.AnodeCoatingCheck[];
  cathode_maintenance: T.CathodeMaintenance[];
  cathode_recoating: T.CathodeRecoating[];
  cathode_coating: T.CathodeCoatingCheck[];
  membrane_maintenance: T.MembraneMaintenance[];
  anode_segregation: T.ElectrodeSegregation[];
  cathode_segregation: T.ElectrodeSegregation[];
  inspections: T.InspectionReport[];
  halfshells: { id: number; element_nr: string | null; grid_type: string; grid_data: Record<string, unknown> }[];
  voltage: T.VoltageReading[];
  current_efficiency: T.CurrentEfficiencyEntry[];
  links: {
    anode_catalog: boolean;
    cathode_catalog: boolean;
    membrane_catalog: boolean;
    group_catalog: boolean;
  };
};

export const arrangementBoardApi = {
  get: async (electrolyzer?: string): Promise<ArrangementBoard> =>
    (await apiClient.get("/arrangement-board", { params: { electrolyzer } })).data,
  cell: async (electrolyzer: string, position: number, elementId?: number | null): Promise<CellDossier> =>
    (
      await apiClient.get("/arrangement-board/cell", {
        params: { electrolyzer, position, element_id: elementId || undefined },
      })
    ).data,
};
export const reservePositionsApi = resource<T.ReservePosition>("/reserve-positions");
export const correctionFactorsApi = resource<T.CorrectionFactor>("/correction-factors");
export const electrodeAreasApi = resource<T.ElectrodeArea>("/electrode-areas");
export const voltageDistributionClassesApi = resource<T.VoltageDistributionClass>("/voltage-distribution-classes");

export const settingsApi = {
  get: async (): Promise<T.PlantSettings> => (await apiClient.get("/settings")).data,
  update: async (payload: Partial<T.PlantSettings>): Promise<T.PlantSettings> =>
    (await apiClient.put("/settings", payload)).data,
};

export const remarksApi = resource<T.Remark>("/remarks");
export const performanceTestsApi = resource<T.PerformanceTest>("/performance-tests");

// ---------------------------------------------------------------- Elements
export const groupDefinitionsApi = resource<T.GroupDefinition>("/group-definitions");
export const inspectionReasonsApi = resource<T.InspectionReason>("/inspection-reasons");
export const inspectionFindingsApi = resource<T.InspectionFinding>("/inspection-findings");

export const elementsApi = {
  ...resource<T.Element>("/elements"),
  history: async (elementNr: string): Promise<T.Element[]> =>
    (await apiClient.get(`/elements/by-element-nr/${encodeURIComponent(elementNr)}/history`)).data,
  duplicates: async (componentType: "anode" | "cathode" | "membrane"): Promise<Record<string, T.Element[]>> =>
    (await apiClient.get(`/elements/duplicates/${componentType}`)).data,
  integrityReport: async (): Promise<{
    elements: number;
    duplicate_installations: number;
    unclosed_replaced_installations: number;
    unpadded_positions: number;
  }> => (await apiClient.get("/elements/integrity/report")).data,
  integrityRepair: async (): Promise<{
    applied: { duplicates_removed: number; installations_closed: number; positions_padded: number };
  }> => (await apiClient.post("/elements/integrity/repair")).data,
  groupsOverview: async (): Promise<{ group_nr: string; element_count: number }[]> =>
    (await apiClient.get("/elements/groups/overview")).data,
  importAssemblyExcel: async (
    file: File,
    mode: "assembly" | "disassembly" | "upsert" = "upsert",
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ imported_rows: number; created?: number; updated?: number; skipped?: number; mode?: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/elements/import-assembly-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
      params: { mode },
    });
    return followImport(data, onProgress);
  },
  nextNumber: async (): Promise<{ element_nr: string }> =>
    (await apiClient.get("/elements/next-number")).data,
  match: async (params: {
    focus: string;
    element_nr?: string;
    anode_nr?: string;
    cathode_nr?: string;
    membrane_nr?: string;
    electrolyzer?: string;
    position?: string;
    membrane_type?: string;
    group_nr?: string;
  }): Promise<T.Element | null> => (await apiClient.get("/elements/match", { params })).data,
};

export const cellComponentsApi = {
  list: async (): Promise<T.CellComponent[]> => (await apiClient.get("/cell-components")).data,
  create: async (payload: Partial<T.CellComponent>): Promise<T.CellComponent> =>
    (await apiClient.post("/cell-components", payload)).data,
  update: async (id: number, payload: Partial<T.CellComponent>): Promise<T.CellComponent> =>
    (await apiClient.put(`/cell-components/${id}`, payload)).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/cell-components/${id}`);
  },
};

export const relationsApi = {
  lookup: async (name: string): Promise<string[]> => (await apiClient.get(`/relations/lookups/${name}`)).data.values,
};

// ---------------------------------------------------------------- Anodes / Cathodes / Membranes
export const anodesApi = resource<T.Anode>("/anodes");
export const anodeMaintenanceApi = resource<T.AnodeMaintenance>("/anode-maintenance");
export const anodeRecoatingApi = resource<T.AnodeRecoating>("/anode-recoating");
export const anodeCoatingChecksApi = resource<T.AnodeCoatingCheck>("/anode-coating-checks");

export const cathodesApi = resource<T.Cathode>("/cathodes");
export const cathodeMaintenanceApi = resource<T.CathodeMaintenance>("/cathode-maintenance");
export const cathodeRecoatingApi = resource<T.CathodeRecoating>("/cathode-recoating");
export const cathodeCoatingChecksApi = resource<T.CathodeCoatingCheck>("/cathode-coating-checks");

export const membranesApi = resource<T.Membrane>("/membranes");
export const membraneMaintenanceApi = resource<T.MembraneMaintenance>("/membrane-maintenance");

export type MaintenanceReportKind = "anode" | "cathode" | "membrane";

export type MaintenanceReportFile = {
  id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
};

export type MaintenanceReportRecord = {
  id: number;
  kind: MaintenanceReportKind;
  component_nr: string;
  report_date: string | null;
  title: string | null;
  notes: string | null;
  files: MaintenanceReportFile[];
};

export type MaintenanceHistoryRow = {
  id: number;
  date: string | null;
  finding: string | null;
  action: string | null;
  dispatch_date: string | null;
  return_date: string | null;
  repair_work: string | null;
};

export const maintenanceReportsApi = {
  history: async (
    kind: MaintenanceReportKind,
    nr: string
  ): Promise<{
    kind: MaintenanceReportKind;
    component_nr: string;
    maintenance: MaintenanceHistoryRow[];
    reports: MaintenanceReportRecord[];
  }> => (await apiClient.get("/maintenance-reports", { params: { kind, nr } })).data,
  create: async (payload: {
    kind: MaintenanceReportKind;
    component_nr: string;
    report_date?: string;
    title?: string;
    notes?: string;
    files: File[];
  }): Promise<MaintenanceReportRecord> => {
    const form = new FormData();
    form.append("kind", payload.kind);
    form.append("component_nr", payload.component_nr);
    if (payload.report_date) form.append("report_date", payload.report_date);
    if (payload.title) form.append("title", payload.title);
    if (payload.notes) form.append("notes", payload.notes);
    for (const file of payload.files) form.append("files", file);
    const { data } = await apiClient.post("/maintenance-reports", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  addFiles: async (reportId: number, files: File[]): Promise<MaintenanceReportRecord> => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const { data } = await apiClient.post(`/maintenance-reports/${reportId}/files`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  fileBlob: async (reportId: number, fileId: number): Promise<Blob> =>
    (await apiClient.get(`/maintenance-reports/${reportId}/files/${fileId}`, { responseType: "blob" })).data,
  removeFile: async (reportId: number, fileId: number): Promise<void> => {
    await apiClient.delete(`/maintenance-reports/${reportId}/files/${fileId}`);
  },
  remove: async (reportId: number): Promise<void> => {
    await apiClient.delete(`/maintenance-reports/${reportId}`);
  },
};

// ---------------------------------------------------------------- Inspections
export const inspectionsApi = resource<T.InspectionReport>("/inspections");
export const assemblyInspectionsApi = resource<T.AssemblyInspectionReport>("/assembly-inspections");

export const inspectionGridsApi = {
  list: async (inspectionId: number): Promise<T.InspectionHalfshellGrid[]> =>
    (await apiClient.get(`/inspections/${inspectionId}/grids`)).data,
  upsert: async (
    inspectionId: number,
    gridType: string,
    gridData: Record<string, unknown>
  ): Promise<T.InspectionHalfshellGrid> =>
    (await apiClient.put(`/inspections/${inspectionId}/grids/${gridType}`, gridData)).data,
};

// ---------------------------------------------------------------- Shutdowns
export const shutdownsApi = resource<T.Shutdown>("/shutdowns"); // pk is `nr`, same /prefix/{id} shape
export const shutdownCategoriesApi = resource<T.ShutdownCategory>("/shutdown-categories");
export const shutdownCausesApi = resource<T.ShutdownCause>("/shutdown-causes");

export const shutdownSummaryApi = {
  get: async (): Promise<T.ShutdownSummary> => (await apiClient.get("/shutdowns-summary")).data,
};

// ---------------------------------------------------------------- Voltage
export const voltageNormalizationsApi = resource<T.ElectrolyzerNormalization>("/voltage-normalizations");
export const voltageReadingsApi = resource<T.VoltageReading>("/voltage-readings");
export const voltageUnElementInputsApi = resource<T.VoltageUnElementInput>("/voltage-un-element-inputs");
export const voltageUnGroupInputsApi = resource<T.VoltageUnGroupInput>("/voltage-un-group-inputs");
export const currentEfficiencyEntriesApi = resource<T.CurrentEfficiencyEntry>("/current-efficiency-entries");

export const voltageCalcApi = {
  calculateStandardized: async (params: {
    u_meas: number;
    current_density: number;
    temp_meas: number;
    conc_meas: number;
    reference_current_density?: number;
    zero_voltage?: number;
    temp_ref?: number;
    conc_ref?: number;
  }): Promise<{ standardized_voltage: number; inputs: Record<string, number> }> =>
    (await apiClient.post("/voltage/calculate-standardized", null, { params })).data,
  distribution: async (params?: {
    electrolyzer?: string;
    date_from?: string;
    date_till?: string;
    ui_min?: number;
    ui_max?: number;
    step?: number;
  }): Promise<T.VoltageDistribution> =>
    (await apiClient.get("/voltage/distribution", { params })).data,
  highDeviation: async (params?: {
    threshold?: number;
    threshold_mv?: number;
    electrolyzer?: string;
    date_from?: string;
    date_till?: string;
  }): Promise<T.HighDeviation> => (await apiClient.get("/voltage/high-deviation", { params })).data,
  elementVoltages: async (params: {
    electrolyzer: string;
    date_from?: string;
    date_till?: string;
  }): Promise<T.ElementVoltageSnapshot> =>
    (await apiClient.get("/voltage/element-voltages", { params })).data,
  importCsv: async (
    file: File,
    electrolyzer: string,
    readingDate: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ imported_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/voltage/import", form, {
      params: { electrolyzer, reading_date: readingDate },
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
  importExcel: async (
    file: File,
    electrolyzer?: string,
    readingDate?: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ imported_rows: number; electrolyzer?: string; reading_date?: string }> => {
    const form = new FormData();
    form.append("file", file);
    const params: Record<string, string> = {};
    if (electrolyzer) params.electrolyzer = electrolyzer;
    if (readingDate) params.reading_date = readingDate;
    const { data } = await apiClient.post("/voltage/import-excel", form, {
      params,
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
};

export const currentEfficiencyCalcApi = {
  calculate: async (params: {
    n_cells: number;
    current_ka: number;
    v_pure_brine?: number;
    v_anolyte?: number;
    c_naclo3_pb?: number;
    c_naclo3_an?: number;
    c_hocl_an?: number;
    c_hcl_pb?: number;
    c_hcl_an?: number;
    c_naoh_pb?: number;
    c_na2co3_pb?: number;
    acidified?: boolean;
  }): Promise<Record<string, unknown>> => (await apiClient.post("/current-efficiency/calculate", null, { params })).data,
};

// ---------------------------------------------------------------- Analyses
export const analysesApi = {
  ...resource<T.AnalysisSample>("/analyses"),
  meta: async (): Promise<T.AnalysisMeta> => (await apiClient.get("/analyses/meta")).data,
  importLabExcel: async (
    file: File,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ imported_samples: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/analyses/import-lab-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
};

// ---------------------------------------------------------------- Electrode segregation (TAFKIK)
export const electrodeSegregationsApi = {
  ...resource<T.ElectrodeSegregation>("/electrode-segregations"),
  importTafkikExcel: async (
    file: File,
    sheet?: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ imported_rows: number; sheet?: string }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/electrode-segregations/import-tafkik-excel", form, {
      params: sheet ? { sheet } : undefined,
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
  enrichFromAssembly: async (): Promise<{ checked: number; updated: number }> =>
    (await apiClient.post("/electrode-segregations/enrich-from-assembly")).data,
  fromAssembly: async (
    serialNr: string,
    preserveServiceLife?: string | null
  ): Promise<Partial<T.ElectrodeSegregation>> =>
    (
      await apiClient.get("/electrode-segregations/from-assembly", {
        params: {
          serial_nr: serialNr,
          preserve_service_life: preserveServiceLife || undefined,
        },
      })
    ).data,
};

// ---------------------------------------------------------------- Search
export const searchApi = {
  all: async (q: string): Promise<T.SearchResults> => (await apiClient.get("/search", { params: { q } })).data,
  byDate: async (field: string, date: string): Promise<Record<string, unknown>[]> =>
    (await apiClient.get("/search/by-date", { params: { field, date } })).data,
  byKind: async (kind: string, q?: string): Promise<T.SearchResults & { title?: string; kind?: string }> =>
    (await apiClient.get(`/search/kind/${encodeURIComponent(kind)}`, { params: { q, limit: 1000 } })).data,
};

// ---------------------------------------------------------------- Statistics
export const statisticsApi = {
  dashboard: async (): Promise<T.DashboardStats> => (await apiClient.get("/statistics/dashboard")).data,
  dolByMembraneType: async (): Promise<T.DolByMembraneType[]> =>
    (await apiClient.get("/statistics/dol-by-membrane-type")).data,
  averagePower: async (params?: {
    date_from?: string;
    date_till?: string;
  }): Promise<T.AveragePowerStats> => (await apiClient.get("/statistics/average-power", { params })).data,
  powerConsumption: async (params?: {
    electrolyzer?: string;
    group?: string;
    date_from?: string;
    date_till?: string;
  }): Promise<{
    from: string;
    till: string;
    group: string;
    formula: string;
    total_kwh: number;
    rows: Array<{
      key: string;
      train?: string | null;
      electrolyzer?: string | null;
      rack?: string;
      energy_kwh: number;
      hours: number;
      samples: number;
      current_ka?: number;
      voltage?: number;
      power_kw?: number;
      avg_kw?: number | null;
    }>;
  }> => (await apiClient.get("/statistics/power-consumption", { params })).data,
  groups: async (): Promise<T.GroupStat[]> => (await apiClient.get("/statistics/groups")).data,
  groupVoltages: async (params: {
    mode: string;
    date?: string;
    electrolyzer?: string;
  }): Promise<T.GroupVoltageReport> =>
    (await apiClient.get("/statistics/group-voltages", { params })).data,
};

// ---------------------------------------------------------------- Reports & Analysis
export const reportsApi = {
  summary: async (electrolyzer?: string): Promise<T.ReportSummary> =>
    (await apiClient.get("/reports/summary", { params: { electrolyzer } })).data,
  trends: async (electrolyzer?: string): Promise<T.ReportTrends> =>
    (await apiClient.get("/reports/trends", { params: { electrolyzer } })).data,
};

// ---------------------------------------------------------------- Export helpers
export type ExportMeta = { fields: string[]; date_fields: string[] };

export async function fetchExportMeta(
  prefix: string,
  params?: Record<string, unknown>
): Promise<ExportMeta> {
  const { data } = await apiClient.get(`${prefix}/export.meta`, { params });
  return {
    fields: Array.isArray(data.fields) ? data.fields.map(String) : [],
    date_fields: Array.isArray(data.date_fields) ? data.date_fields.map(String) : [],
  };
}

/** Downloads a resource's export.xlsx/export.pdf via the browser (auth header via axios, then blob download). */
export async function downloadExport(
  prefix: string,
  format: "xlsx" | "pdf",
  params?: Record<string, unknown>,
  filename?: string
): Promise<void> {
  const { data } = await apiClient.get(`${prefix}/export.${format}`, { params, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `${prefix.replace(/^\//, "").replace(/\//g, "-")}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export type ImportProgress = { percent: number; processed: number; total: number };

export async function followImport<T>(started: { job_id?: string }, onProgress?: (progress: ImportProgress) => void): Promise<T> {
  if (!started?.job_id) return started as T;
  const jobId = started.job_id;
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const { data } = await apiClient.get(`/imports/${jobId}`);
    onProgress?.({
      percent: Number(data.percent ?? 0),
      processed: Number(data.processed ?? 0),
      total: Number(data.total ?? 0),
    });
    if (data.done) {
      if (data.error) throw new Error(String(data.error));
      return data.result as T;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Import timed out");
}

export async function importExcel(
  prefix: string,
  file: File,
  onProgress?: (progress: ImportProgress) => void
): Promise<{ created: number; updated: number; skipped: number; arranged?: boolean; ignored?: string[]; errors?: string[] }> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post(`${prefix}/import.xlsx`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return followImport(data, onProgress);
}

// ---------------------------------------------------------------- Auth / Users
export const authApi = {
  login: async (username: string, password: string): Promise<T.LoginResponse> =>
    (await apiClient.post("/auth/login", { username, password })).data,
  me: async (): Promise<T.AuthUser> => (await apiClient.get("/auth/me")).data,
  directory: async (): Promise<{ enabled: boolean; domain: string; allow_local_fallback: boolean }> =>
    (await apiClient.get("/auth/directory")).data,
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await apiClient.post("/auth/change-password", { current_password: currentPassword, new_password: newPassword });
  },
};

export const usersApi = {
  formKeys: async (): Promise<string[]> => (await apiClient.get("/users/form-keys")).data,
  formFields: async (): Promise<Record<string, string[]>> => (await apiClient.get("/users/form-fields")).data,
  list: async (): Promise<T.UserAccount[]> => (await apiClient.get("/users")).data,
  create: async (payload: {
    username: string;
    full_name?: string;
    password: string;
    role: T.UserRole;
    role_id?: number | null;
    is_active?: boolean;
    permissions?: Record<string, T.PermissionLevel>;
  }): Promise<T.UserAccount> => (await apiClient.post("/users", payload)).data,
  update: async (
    id: number,
    payload: Partial<{
      full_name: string;
      role: T.UserRole;
      role_id: number | null;
      is_active: boolean;
      password: string;
      permissions: Record<string, T.PermissionLevel>;
    }>
  ): Promise<T.UserAccount> => (await apiClient.put(`/users/${id}`, payload)).data,
  setPassword: async (id: number, newPassword: string): Promise<T.UserAccount> =>
    (await apiClient.post(`/users/${id}/password`, { new_password: newPassword })).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },
};

export const rolesApi = {
  list: async (): Promise<T.AppRole[]> => (await apiClient.get("/roles")).data,
  create: async (payload: {
    name: string;
    description?: string | null;
    permissions?: Record<string, T.PermissionLevel>;
  }): Promise<T.AppRole> => (await apiClient.post("/roles", payload)).data,
  update: async (
    id: number,
    payload: Partial<{
      name: string;
      description: string | null;
      permissions: Record<string, T.PermissionLevel>;
    }>
  ): Promise<T.AppRole> => (await apiClient.put(`/roles/${id}`, payload)).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/roles/${id}`);
  },
};

export const logsApi = {
  list: async (params?: {
    q?: string;
    action?: string;
    username?: string;
    resource?: string;
    success?: boolean;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }): Promise<T.AuditLogListResponse> => (await apiClient.get("/logs", { params })).data,
  meta: async (): Promise<{ actions: string[]; resources: string[] }> => (await apiClient.get("/logs/meta")).data,
  get: async (id: number): Promise<T.AuditLog> => (await apiClient.get(`/logs/${id}`)).data,
};

// ---------------------------------------------------------------- Work activity (who did what)

export type ActivityCounts = Record<string, number>;
export type ActivityFilters = {
  date_from?: string;
  date_to?: string;
  username?: string;
  role_id?: number;
  granularity?: "day" | "week" | "month";
  calendar?: "gregorian" | "jalali";
};
export type ActivityPerson = { username: string; full_name: string | null; department: string | null };
export type ActivityRow = ActivityPerson & {
  counts: ActivityCounts;
  total: number;
  bulk: number;
  distinct_elements: number;
  active_days: number;
  first_at: string | null;
  last_at: string | null;
  period?: string;
  period_start?: string;
  period_end?: string;
};
export type ActivityMeta = {
  metrics: { key: string; group: string }[];
  departments: { id: number; name: string }[];
  users: { username: string; full_name: string | null; role_id: number | null }[];
};
export type ActivitySummary = {
  date_from: string;
  date_to: string;
  metrics: { key: string; group: string }[];
  rows: ActivityRow[];
  user_totals: ActivityRow[];
  period_totals: { period: string; period_start: string; period_end: string; counts: ActivityCounts; users: number; bulk: number }[];
  inactive_users: ActivityPerson[];
};
export type ActivityCellShopDay = {
  date: string;
  counts: ActivityCounts;
  distinct_elements: number;
  users: { username: string; counts: ActivityCounts; total: number }[];
  electrolyzers: { electrolyzer: string; counts: ActivityCounts; total: number }[];
  elements: {
    element_nr: string;
    electrolyzer: string | null;
    position: string | null;
    actions: string[];
    users: string[];
    events: { at: string; username: string; metric: string; id: number }[];
  }[];
};
export type ActivityCellShop = {
  metrics: string[];
  totals: { counts: ActivityCounts; distinct_elements: number };
  by_user: { username: string; counts: ActivityCounts; total: number }[];
  by_electrolyzer: { electrolyzer: string; counts: ActivityCounts; total: number }[];
  days: ActivityCellShopDay[];
};
export type ActivityLabEntry = {
  label: string;
  analysis_type: string;
  sample_time: string;
  username: string;
  entered_at: string | null;
  parameters: number;
  expected: boolean;
};
export type ActivityLabDay = {
  date: string;
  open: boolean;
  expected: number;
  entered: number;
  missing: number;
  missing_items: string[];
  types: { analysis_type: string; expected: number; entered: number; missing: number }[];
  entries: ActivityLabEntry[];
  users: { username: string; count: number }[];
};
export type ActivityLab = {
  source: "sampling_points" | "habitual";
  filtered: boolean;
  expected_per_day: number;
  summary: { expected: number; entered: number; missing: number; completeness_pct: number | null };
  missing_by_type: { analysis_type: string; expected: number; missing: number }[];
  entered_by_user: { username: string; count: number }[];
  days: ActivityLabDay[];
};
export type ActivityInspectionRow = {
  key: string;
  reports: number;
  elements: number;
  with_findings?: number;
  passed?: number;
  failed?: number;
  incomplete?: number;
};
export type ActivityInspectionReport = {
  id: number;
  date: string;
  element_nr: string | null;
  electrolyzer: string | null;
  position: string | null;
  inspector: string;
  signed: string[];
  entered_by: string | null;
  reason?: string;
  operation_days?: string | null;
  findings?: string[];
  status?: "passed" | "failed" | "incomplete";
  checked?: number;
  total_checks?: number;
  failed_checks?: string[];
  distance?: string | null;
};
export type ActivityInspections = {
  note: string;
  inspection_reports: {
    total: number;
    with_findings: number;
    by_day: ActivityInspectionRow[];
    by_inspector: ActivityInspectionRow[];
    by_reason: { reason: string; count: number }[];
    top_findings: { field: string; count: number }[];
    reports: ActivityInspectionReport[];
  };
  assembly_reports: {
    total: number;
    passed: number;
    failed: number;
    incomplete: number;
    by_day: ActivityInspectionRow[];
    by_inspector: ActivityInspectionRow[];
    top_failed_checks: { check: string; count: number }[];
    reports: ActivityInspectionReport[];
  };
};
export type ActivityWarehouseRow = {
  date: string;
  kind: "dispatch" | "receiving" | "purchase" | "punch" | "decommission";
  number: string | null;
  company: string | null;
  items: number;
  detail: string;
  status: string | null;
  users: string[];
  remarks: string;
};
export type ActivityWarehouse = {
  summary: { kind: string; documents: number; items: number }[];
  by_user: { username: string; counts: Record<string, number>; total: number }[];
  rows: ActivityWarehouseRow[];
};
export type ActivityEventChange = { field: string; old: string; new: string };
export type ActivityEvent = {
  id: number;
  at: string;
  username: string;
  full_name: string | null;
  department: string | null;
  group: string | null;
  metric: string;
  action: string;
  resource: string;
  resource_id: string | null;
  element_nr: string | null;
  electrolyzer: string | null;
  position: string | null;
  bulk: boolean;
  target: Record<string, string>;
  changes: ActivityEventChange[];
  ip: string | null;
  path: string | null;
};
export type ActivityEventList = {
  total: number;
  items: ActivityEvent[];
  resources: { resource: string; count: number }[];
  metrics: { metric: string; count: number }[];
};
export type ActivityEventFilters = ActivityFilters & {
  group?: string;
  metric?: string;
  resource?: string;
  q?: string;
  include_bulk?: boolean;
  skip?: number;
  limit?: number;
};
export type ActivityUserDetail = {
  person: ActivityPerson;
  total: number;
  bulk: number;
  active_days: number;
  by_metric: Record<string, number>;
  by_resource: { resource: string; count: number }[];
  hours: number[];
  days: {
    date: string;
    first_at: string | null;
    last_at: string | null;
    span_minutes: number;
    total: number;
    bulk: number;
    counts: Record<string, number>;
    resources: Record<string, number>;
  }[];
  logins: { at: string; success: boolean; ip: string | null; agent: string | null }[];
};

export const activityApi = {
  meta: async (): Promise<ActivityMeta> => (await apiClient.get("/activity/meta")).data,
  summary: async (params: ActivityFilters): Promise<ActivitySummary> => (await apiClient.get("/activity/summary", { params })).data,
  cellShop: async (params: ActivityFilters): Promise<ActivityCellShop> => (await apiClient.get("/activity/cell-shop", { params })).data,
  warehouse: async (params: ActivityFilters): Promise<ActivityWarehouse> => (await apiClient.get("/activity/warehouse", { params })).data,
  lab: async (params: ActivityFilters): Promise<ActivityLab> => (await apiClient.get("/activity/lab-compliance", { params })).data,
  inspections: async (params: ActivityFilters): Promise<ActivityInspections> =>
    (await apiClient.get("/activity/inspections", { params })).data,
  events: async (params: ActivityEventFilters): Promise<ActivityEventList> => (await apiClient.get("/activity/events", { params })).data,
  userDetail: async (params: ActivityFilters & { username: string }): Promise<ActivityUserDetail> =>
    (await apiClient.get("/activity/user-detail", { params })).data,
};

export type StorageSummary = {
  counts: { anodes: number; cathodes: number; membranes: number; total: number };
  anodes_by_manufacturer: { manufacturer: string; generation: string; count: number }[];
  cathodes_by_manufacturer: { manufacturer: string; generation: string; count: number }[];
  membranes_by_type: { membrane_type: string; count: number }[];
};

export type WarehouseItem = {
  serial: string;
  key: string;
  kind: "anode" | "cathode";
  bucket: "on_rack" | "out_repair" | "pending" | "ok" | "not_ok";
  reason: string;
  electrolyzer: string | null;
  position: string | null;
  element_nr: string | null;
  assembly_date: string | null;
  commissioning_date: string | null;
  disassembly_date: string | null;
  last_dol: number | null;
  total_dol: number | null;
  runs: number;
  remarks: string | null;
  repair: string | null;
  repair_dispatch: string | null;
  repair_return: string | null;
  coating: string | null;
  manufacturer: string | null;
};

export type WarehouseBoard = {
  kind: string;
  counts: { on_rack: number; out_repair: number; pending: number; ok: number; not_ok: number; total: number };
  items: WarehouseItem[];
  truncated: boolean;
};

export const storageApi = {
  summary: async (): Promise<StorageSummary> => (await apiClient.get("/storage/summary")).data,
  anodes: async (q?: string): Promise<T.Anode[]> =>
    (await apiClient.get("/storage/anodes", { params: { q, limit: 5000 } })).data,
  cathodes: async (q?: string): Promise<T.Cathode[]> =>
    (await apiClient.get("/storage/cathodes", { params: { q, limit: 5000 } })).data,
  membranes: async (q?: string): Promise<T.Membrane[]> =>
    (await apiClient.get("/storage/membranes", { params: { q, limit: 5000 } })).data,
  board: async (kind: "anode" | "cathode", bucket?: string, q?: string): Promise<WarehouseBoard> =>
    (await apiClient.get("/storage/board", { params: { kind, bucket, q, limit: 2500 } })).data,
  move: async (payload: {
    kind: "anode" | "cathode";
    serial: string;
    action: "dispatch_maintenance" | "dispatch_recoating" | "return" | "ok" | "not_ok";
    date?: string;
    note?: string;
  }): Promise<{ ok: boolean; already?: boolean; serial: string; action: string }> =>
    (await apiClient.post("/storage/board/move", payload)).data,
};

export type WhCompany = {
  id: number;
  name: string;
  is_coating: boolean;
  is_supplier: boolean;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  contract_ref: string | null;
  contract_valid_until: string | null;
  remarks: string | null;
};

export type WhLifecycleDashboard = {
  counts: Record<string, number>;
  recent: {
    id: number;
    element_kind: string;
    serial: string;
    event_type: string;
    event_date: string;
    title: string;
    details: Record<string, unknown>;
  }[];
};

export type WhDispatch = {
  id: number;
  send_no: string;
  company_id: number;
  company_name: string | null;
  dispatch_date: string;
  status: string;
  remarks: string | null;
  items: { id: number; element_kind: string; serial: string; received: boolean }[];
};

export type WhReceiving = {
  id: number;
  receive_no: string;
  dispatch_id: number | null;
  send_no: string | null;
  receive_date: string;
  remarks: string | null;
  items: { id: number; element_kind: string; serial: string; coating_status: string | null; qc_result: string | null }[];
};

export type WhPurchase = {
  id: number;
  purchase_no: string;
  supplier_id: number;
  supplier_name: string | null;
  purchase_date: string;
  element_kind: string;
  remarks: string | null;
  serials: string[];
};

export type WhElementTimeline = {
  kind: string;
  serial: string;
  current: {
    lifecycle_status: string | null;
    company_id: number | null;
    company_name: string | null;
    coating_status: string | null;
    appearance_status: string | null;
    qc_result: string | null;
    open_dispatch_id: number | null;
    updated_at: string | null;
  };
  events: {
    id: number;
    event_type: string;
    event_date: string;
    title: string;
    ref_kind: string | null;
    ref_id: number | null;
    details: Record<string, unknown>;
  }[];
};

export const warehouseLifecycleApi = {
  meta: async (): Promise<{ lifecycle_statuses: string[] }> =>
    (await apiClient.get("/warehouse-lifecycle/meta")).data,
  dashboard: async (): Promise<WhLifecycleDashboard> =>
    (await apiClient.get("/warehouse-lifecycle/dashboard")).data,
  companies: async (params?: { q?: string; coating?: boolean; supplier?: boolean }): Promise<WhCompany[]> =>
    (await apiClient.get("/warehouse-lifecycle/companies", { params })).data,
  saveCompany: async (body: Partial<WhCompany> & { name: string }, id?: number): Promise<WhCompany> =>
    id
      ? (await apiClient.put(`/warehouse-lifecycle/companies/${id}`, body)).data
      : (await apiClient.post("/warehouse-lifecycle/companies", body)).data,
  companyHistory: async (id: number) => (await apiClient.get(`/warehouse-lifecycle/companies/${id}/history`)).data,
  elementStates: async (params?: { kind?: string; status?: string; q?: string }) =>
    (await apiClient.get("/warehouse-lifecycle/elements/state", { params })).data,
  elementTimeline: async (kind: "anode" | "cathode", serial: string): Promise<WhElementTimeline> =>
    (await apiClient.get(`/warehouse-lifecycle/elements/${kind}/${encodeURIComponent(serial)}/timeline`)).data,
  dispatches: async (params?: { status?: string; company_id?: number }): Promise<WhDispatch[]> =>
    (await apiClient.get("/warehouse-lifecycle/dispatches", { params })).data,
  createDispatch: async (body: {
    company_id: number;
    dispatch_date: string;
    send_no?: string;
    remarks?: string;
    items: { element_kind: "anode" | "cathode"; serial: string }[];
  }) => (await apiClient.post("/warehouse-lifecycle/dispatches", body)).data,
  receivings: async (): Promise<WhReceiving[]> => (await apiClient.get("/warehouse-lifecycle/receivings")).data,
  createReceiving: async (body: {
    dispatch_id?: number;
    receive_date: string;
    receive_no?: string;
    remarks?: string;
    items: {
      dispatch_item_id?: number;
      element_kind: "anode" | "cathode";
      serial: string;
      coating_status?: string;
      appearance_status?: string;
      qc_result?: string;
      vendor_report_no?: string;
      remarks?: string;
    }[];
  }) => (await apiClient.post("/warehouse-lifecycle/receivings", body)).data,
  purchases: async (): Promise<WhPurchase[]> => (await apiClient.get("/warehouse-lifecycle/purchases")).data,
  createPurchase: async (body: {
    supplier_id: number;
    purchase_date: string;
    element_kind: "anode" | "cathode";
    purchase_no?: string;
    remarks?: string;
    serials: string[];
  }) => (await apiClient.post("/warehouse-lifecycle/purchases", body)).data,
  punches: async (params?: { company_id?: number; serial?: string }) =>
    (await apiClient.get("/warehouse-lifecycle/punches", { params })).data,
  createPunch: async (body: {
    company_id?: number;
    dispatch_id?: number;
    send_no?: string;
    element_kind: "anode" | "cathode";
    serial: string;
    punch_no?: string;
    punch_date?: string;
    remarks?: string;
  }) => (await apiClient.post("/warehouse-lifecycle/punches", body)).data,
  decommissions: async () => (await apiClient.get("/warehouse-lifecycle/decommissions")).data,
  createDecommission: async (body: {
    element_kind: "anode" | "cathode";
    serial: string;
    decommission_date: string;
    reason: string;
    remarks?: string;
  }) => (await apiClient.post("/warehouse-lifecycle/decommissions", body)).data,
  search: async (params: Record<string, string | number | undefined>) =>
    (await apiClient.get("/warehouse-lifecycle/search", { params })).data,
};

export type DbArchiveTable = {
  slug: string;
  name: string;
  sqlite_table: string;
  category: string;
  form_key: string;
  row_count: number;
  columns: string[];
  synced_at: string;
};

export type DbArchiveList = {
  total: number;
  categories: string[];
  tables: DbArchiveTable[];
  available: boolean;
};

export type DbArchiveRows = {
  table: DbArchiveTable;
  total: number;
  skip: number;
  limit: number;
  rows: Record<string, unknown>[];
};

export const dbTablesApi = {
  list: async (): Promise<DbArchiveList> => (await apiClient.get("/db-tables")).data,
  rows: async (
    slug: string,
    params?: { q?: string; column?: string; value?: string; skip?: number; limit?: number }
  ): Promise<DbArchiveRows> => (await apiClient.get(`/db-tables/${slug}/rows`, { params })).data,
  createRow: async (slug: string, values: Record<string, unknown>): Promise<{ ok: boolean; row: Record<string, unknown> }> =>
    (await apiClient.post(`/db-tables/${slug}/rows`, { values })).data,
  updateRow: async (
    slug: string,
    rowId: number,
    values: Record<string, unknown>
  ): Promise<{ ok: boolean; row: Record<string, unknown> }> =>
    (await apiClient.put(`/db-tables/${slug}/rows/${rowId}`, { values })).data,
  deleteRow: async (slug: string, rowId: number): Promise<void> => {
    await apiClient.delete(`/db-tables/${slug}/rows/${rowId}`);
  },
};

// ---------------------------------------------------------------- Import / Export (bulk)
export const dataTransferApi = {
  importableResources: async (): Promise<string[]> => (await apiClient.get("/data/importable-resources")).data,
  importAccess: async (file: File, mode: "replace" | "merge"): Promise<{ ok: boolean; mode: string; log: string[] }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/data/import/access", form, {
      params: { mode },
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  importExcel: async (
    resource: string,
    file: File,
    mode: "replace" | "merge",
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{ ok: boolean; imported: number; skipped: number; errors: string[] }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post(`/data/import/excel/${resource}`, form, {
      params: { mode },
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
};

// ---------------------------------------------------------------- Database (admin)
export type DatabaseFileInfo = {
  key: string;
  label: string;
  section: string;
  path: string;
  exists: boolean;
  is_dir: boolean;
  size_bytes: number | null;
  modified_at: string | null;
  in_use: boolean;
};

export type DatabaseSection = {
  key: string;
  label: string;
  table_count: number;
  row_count: number;
  tables: { name: string; rows: number }[];
};

export type DatabaseStatus = {
  mode: "local" | "online" | "env";
  dialect: string;
  url_display: string;
  data_directory: string;
  local_sqlite_path: string;
  env_locked: boolean;
  online: Record<string, unknown> & { password_set?: boolean; kind?: string };
  files: DatabaseFileInfo[];
  sections: DatabaseSection[];
  can_download: boolean;
};

export type DatabaseSwitchPayload = {
  mode: "local" | "online";
  kind?: "postgresql" | "sqlite";
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sqlite_path?: string;
  url?: string;
  copy_data?: boolean;
};

export const databaseApi = {
  status: async (): Promise<DatabaseStatus> => (await apiClient.get("/database/status")).data,
  test: async (payload: DatabaseSwitchPayload): Promise<{ ok: boolean; dialect: string; url_display: string }> =>
    (await apiClient.post("/database/test", payload)).data,
  switchTo: async (
    payload: DatabaseSwitchPayload
  ): Promise<{ ok: boolean; mode: string; url_display: string; restart_required: boolean }> =>
    (await apiClient.post("/database/switch", payload)).data,
  reveal: async (path: string): Promise<void> => {
    await apiClient.post("/database/reveal", { path });
  },
  download: async (): Promise<void> => {
    const { data, headers } = await apiClient.get("/database/download", { responseType: "blob" });
    const match = /filename="?([^"]+)"?/i.exec(String(headers["content-disposition"] || ""));
    const filename = match?.[1] || "pvc_arvand.db";
    const url = window.URL.createObjectURL(new Blob([data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

export type DirectorySettings = {
  enabled: boolean;
  host: string;
  port: number;
  use_ssl: boolean;
  use_starttls: boolean;
  base_dn: string;
  domain: string;
  bind_username: string;
  bind_password?: string;
  bind_password_set?: boolean;
  allowed_users: string[];
  allowed_groups: string[];
  allow_local_fallback: boolean;
  enforce_at_startup: boolean;
  updated_at?: string | null;
};

export type DirectoryStatus = {
  settings: DirectorySettings;
  windows: { username: string; domain: string; account: string; sam: string };
  current_user: { ok: boolean; reason?: string; unreachable?: boolean; sam?: string } | null;
};

export const directoryApi = {
  status: async (): Promise<DirectoryStatus> => (await apiClient.get("/directory/status")).data,
  save: async (payload: DirectorySettings): Promise<{ ok: boolean; settings: DirectorySettings }> =>
    (await apiClient.put("/directory/settings", payload)).data,
  test: async (payload: DirectorySettings): Promise<{ ok: boolean; bound_as?: string; server?: string }> =>
    (await apiClient.post("/directory/test", payload)).data,
  checkUser: async (username: string): Promise<{ ok: boolean; reason: string }> =>
    (await apiClient.post("/directory/check-user", { username })).data,
};

// ---------------------------------------------------------------- Backup
export const backupApi = {
  getSettings: async (): Promise<T.BackupSettings> => (await apiClient.get("/backup/settings")).data,
  updateSettings: async (
    payload: Pick<T.BackupSettings, "enabled" | "time" | "days_of_week" | "retention_count">
  ): Promise<T.BackupSettings> => (await apiClient.put("/backup/settings", payload)).data,
  list: async (): Promise<T.BackupFileInfo[]> => (await apiClient.get("/backup/list")).data,
  runNow: async (): Promise<T.BackupFileInfo> => (await apiClient.post("/backup/run")).data,
  remove: async (filename: string): Promise<void> => {
    await apiClient.delete(`/backup/${encodeURIComponent(filename)}`);
  },
  download: async (filename: string): Promise<void> => {
    const { data } = await apiClient.get(`/backup/download/${encodeURIComponent(filename)}`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([data]));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

// ---------------------------------------------------------------- Voltage sync (ARIAORMS)
export const voltageSyncApi = {
  getSettings: async (): Promise<T.VoltageSyncSettings> => (await apiClient.get("/voltage-sync/settings")).data,
  updateSettings: async (
    payload: Partial<{
      enabled: boolean;
      watch_dir: string | null;
      poll_seconds: number;
      source_url: string | null;
      username: string | null;
      password: string;
      daily_time: string;
      lookback_days: number;
    }>
  ): Promise<T.VoltageSyncSettings> => (await apiClient.put("/voltage-sync/settings", payload)).data,
  runNow: async (onProgress?: (progress: ImportProgress) => void): Promise<T.VoltageSyncRunResult> => {
    const { data } = await apiClient.post("/voltage-sync/run");
    return followImport(data, onProgress);
  },
  importFile: async (
    file: File,
    params?: { electrolyzer?: string; reading_date?: string },
    onProgress?: (progress: ImportProgress) => void
  ): Promise<T.VoltageSyncRunResult> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/voltage-sync/import-file", form, {
      params,
      headers: { "Content-Type": "multipart/form-data" },
    });
    return followImport(data, onProgress);
  },
};

// ---------------------------------------------------------------- AriaLims sync (lab analyses)
export const ariaLimsSyncApi = {
  getSettings: async (): Promise<T.AriaLimsSyncSettings> =>
    (await apiClient.get("/arialims-sync/settings")).data,
  updateSettings: async (
    payload: Partial<{
      enabled: boolean;
      base_url: string | null;
      username: string | null;
      password: string;
      api_token: string;
      daily_time: string;
      lookback_days: number;
      analysis_types: string | null;
    }>
  ): Promise<T.AriaLimsSyncSettings> => (await apiClient.put("/arialims-sync/settings", payload)).data,
  testConnection: async (): Promise<T.AriaLimsTestResult> =>
    (await apiClient.post("/arialims-sync/test")).data,
  runNow: async (onProgress?: (progress: ImportProgress) => void): Promise<T.AriaLimsSyncRunResult> => {
    const { data } = await apiClient.post("/arialims-sync/run");
    return followImport(data, onProgress);
  },
  getCatalog: async (): Promise<{ items: T.AriaLimsCatalogItem[]; contract_ready: boolean }> =>
    (await apiClient.get("/arialims-sync/catalog")).data,
  listPoints: async (): Promise<T.AriaLimsSamplingPoint[]> => (await apiClient.get("/arialims-sync/points")).data,
  createPoint: async (payload: Omit<T.AriaLimsSamplingPoint, "id">): Promise<T.AriaLimsSamplingPoint> =>
    (await apiClient.post("/arialims-sync/points", payload)).data,
  updatePoint: async (id: number, payload: Omit<T.AriaLimsSamplingPoint, "id">): Promise<T.AriaLimsSamplingPoint> =>
    (await apiClient.put(`/arialims-sync/points/${id}`, payload)).data,
  importPoints: async (
    file: File
  ): Promise<{ created: number; updated: number; total: number; skipped: { scid: number; name: string | null; reason: string }[] }> => {
    const form = new FormData();
    form.append("file", file);
    return (
      await apiClient.post("/arialims-sync/points/import-xlsx", form, { headers: { "Content-Type": "multipart/form-data" } })
    ).data;
  },
  deletePoint: async (id: number): Promise<void> => {
    await apiClient.delete(`/arialims-sync/points/${id}`);
  },
  preview: async (scid: number, days = 7): Promise<T.AriaLimsPreview> =>
    (await apiClient.post("/arialims-sync/preview", { scid, days })).data,
};

// ---------------------------------------------------------------- Monitoring / alerts
export interface CellElementBrief {
  id: number;
  element_nr: string | null;
  electrolyzer: string | null;
  position: string | null;
  train: string | null;
  rack: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  membrane_type: string | null;
  assembly_date: string | null;
  commissioning_date: string | null;
  disassembly_date: string | null;
  dol_days: number | null;
  active: boolean;
  anode_coating: string | null;
  cathode_coating: string | null;
  gap_mm: string | null;
  remarks: string | null;
}

export interface CellProperties {
  electrolyzer: string;
  position: string;
  position_label: string;
  train: string | null;
  arrangement: string | null;
  rack: string | null;
  rack_start: number | null;
  rack_end: number | null;
  current: CellElementBrief | null;
  history: CellElementBrief[];
}

export interface ComponentDossier {
  kind: "anode" | "cathode" | "membrane";
  nr: string;
  status: "mounted" | "spare" | "repair" | "decommissioned" | "dismantled";
  place: { electrolyzer: string | null; position: string | null; train: string | null; rack: string | null; active: boolean } | null;
  catalog: {
    nr: string | null;
    membrane_type: string | null;
    manufacturer: string | null;
    coating: string | null;
    batch: string | null;
    generation: string | null;
    received_date: string | null;
    decommission_date: string | null;
    remarks: string | null;
  } | null;
  installations: CellElementBrief[];
  maintenance: {
    id: number;
    date: string | null;
    finding: string | null;
    action: string | null;
    dispatch_date: string | null;
    return_date: string | null;
  }[];
  reports: { id: number; report_date: string | null; title: string | null; notes: string | null; file_count: number }[];
}

export interface ElectrolyzerProperties {
  electrolyzer: string;
  train: string | null;
  arrangement: string | null;
  layout: {
    block: string | null;
    transformer: string | null;
    rectifier: string | null;
    sub_plant: string | null;
    start_position: string | null;
    end_position: string | null;
  }[];
  summary: {
    installations: number;
    active_cells: number;
    occupied_positions: number;
    empty_positions: number;
    dismantled: number;
    avg_dol_days: number | null;
    membrane_types: { label: string; count: number }[];
    anode_coatings: { label: string; count: number }[];
  };
  normalization: {
    date: string | null;
    time: string | null;
    total_current: number | null;
    total_voltage: number | null;
    element_count: number | null;
    anolyte_temp: number | null;
    catholyte_temp: number | null;
    catholyte_conc: number | null;
    cl2_pct: number | null;
    h2_pct: number | null;
    rack_a_avg: number | null;
    rack_b_avg: number | null;
  } | null;
  current_efficiency: { date: string | null; value_pct: number | null; scope_ref: string | null } | null;
  analyses: {
    id: number;
    analysis_type: string;
    date: string | null;
    time: string | null;
    parameters: Record<string, number | string>;
  }[];
  alerts: {
    id: number;
    severity: string;
    status: string;
    title: string;
    message: string | null;
    position: string | null;
    value: number | null;
    created_at: string | null;
  }[];
  shutdowns: {
    nr: number;
    plant_part: string | null;
    shutdown_time: string | null;
    startup_time: string | null;
    category: string | null;
    cause: string | null;
    remarks: string | null;
  }[];
  inspections: {
    id: number;
    element_nr: string | null;
    position: string | null;
    inspection_date: string | null;
    inspection_reason: string | null;
    inspector_name: string | null;
  }[];
  recent_installs: CellElementBrief[];
  recent_dismantles: CellElementBrief[];
}

export type CellHealthStatus = "ok" | "watch" | "investigate" | "critical" | "unknown";

export interface CellHealthRow {
  electrolyzer: string;
  position: string;
  position_label: string;
  element_nr: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  membrane_type: string | null;
  voltage: number | null;
  standardized_voltage: number | null;
  reading_date: string | null;
  median_voltage: number | null;
  operating_hours: number | null;
  dol_days: number | null;
  install_cycles: number;
  ce_pct: number | null;
  un_avg: number | null;
  avg_voltage: number | null;
  avg_current_ka: number | null;
  test_ce_pct: number | null;
  test_spc_kwh: number | null;
  lab_score: number | null;
  health_score: number | null;
  status: CellHealthStatus;
  peer_delta_v: number | null;
  trend_mv_day: number | null;
  reasons: string[];
  factors: { name: string; status: string; value: number | null }[];
}

export interface CellHealthBoard {
  electrolyzer: string;
  train: string | null;
  arrangement: string | null;
  median_voltage: number | null;
  envelope: {
    report_date: string | null;
    total_current_ka: number | null;
    anolyte_temp: number | null;
    catholyte_temp: number | null;
    delta_p: number | null;
    naoh_pct: number | null;
    cl2_pct: number | null;
    h2_pct: number | null;
    brine_flags: { parameter: string; value: number; limit: number; severity: string }[];
    brine_date: string | null;
    factors: { name: string; value: number | null; status: string; detail: string }[];
    envelope_score: number | null;
    envelope_status: CellHealthStatus;
  };
  shutdown_stats: { shutdowns: number; trips: number };
  summary: {
    cells: number;
    ok: number;
    watch: number;
    investigate: number;
    critical: number;
    unknown: number;
    median_voltage: number | null;
  };
  investigation: CellHealthRow[];
  cells: CellHealthRow[];
  levels: { l1_online: string; l2_condition: string; l3_overhaul: string };
}

export interface CellHealthDetail {
  electrolyzer: string;
  train: string | null;
  envelope: CellHealthBoard["envelope"];
  shutdown_stats: { shutdowns: number; trips: number };
  median_voltage: number | null;
  cell: CellHealthRow | null;
  levels: CellHealthBoard["levels"];
}

export const monitoringApi = {
  snapshot: async (): Promise<T.MonitoringSnapshot> => (await apiClient.get("/monitoring/snapshot")).data,
  summary: async (): Promise<T.AlertSummary> => (await apiClient.get("/monitoring/summary")).data,
  evaluate: async (): Promise<{ ok: boolean; summary: T.AlertSummary }> =>
    (await apiClient.post("/monitoring/evaluate")).data,
  listRules: async (): Promise<T.AlertRule[]> => (await apiClient.get("/monitoring/rules")).data,
  createRule: async (payload: Omit<T.AlertRule, "id">): Promise<T.AlertRule> =>
    (await apiClient.post("/monitoring/rules", payload)).data,
  updateRule: async (id: number, payload: Partial<T.AlertRule>): Promise<T.AlertRule> =>
    (await apiClient.put(`/monitoring/rules/${id}`, payload)).data,
  deleteRule: async (id: number): Promise<void> => {
    await apiClient.delete(`/monitoring/rules/${id}`);
  },
  listAlerts: async (params?: {
    status?: string;
    severity?: string;
    category?: string;
    limit?: number;
  }): Promise<T.AlertEvent[]> => (await apiClient.get("/monitoring/alerts", { params })).data,
  acknowledge: async (id: number): Promise<T.AlertEvent> =>
    (await apiClient.post(`/monitoring/alerts/${id}/acknowledge`)).data,
  resolve: async (id: number): Promise<T.AlertEvent> =>
    (await apiClient.post(`/monitoring/alerts/${id}/resolve`)).data,
  resolveAll: async (severity?: string): Promise<{ ok: boolean; resolved: number }> =>
    (await apiClient.post("/monitoring/alerts/resolve-all", null, { params: { severity } })).data,
  cell: async (params: { electrolyzer: string; position: string }): Promise<CellProperties> =>
    (await apiClient.get("/monitoring/cell", { params })).data,
  electrolyzer: async (params: { electrolyzer: string }): Promise<ElectrolyzerProperties> =>
    (await apiClient.get("/monitoring/electrolyzer", { params })).data,
  cellHealth: async (params: {
    electrolyzer: string;
    position: string;
  }): Promise<CellHealthDetail> => (await apiClient.get("/monitoring/cell-health", { params })).data,
  cellHealthBoard: async (params: { electrolyzer: string }): Promise<CellHealthBoard> =>
    (await apiClient.get("/monitoring/cell-health-board", { params })).data,
  component: async (params: { kind: "anode" | "cathode" | "membrane"; nr: string }): Promise<ComponentDossier> =>
    (await apiClient.get("/monitoring/component", { params })).data,
  voltageHistory: async (params: {
    electrolyzer: string;
    position?: string;
    span?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{
    electrolyzer: string;
    position: string | null;
    title: string;
    kind: string;
    unit: string;
    span: string;
    date_from?: string | null;
    date_to?: string | null;
    total: number;
    points: {
      date: string | null;
      time: string | null;
      voltage: number;
      current_ka?: number | null;
      prev_day_ka?: number | null;
      prev2_day_ka?: number | null;
    }[];
    rectifier_points?: { date: string | null; time: string | null; voltage: number }[];
  }> => (await apiClient.get("/monitoring/voltage-history", { params })).data,
  plantTrends: async (params: {
    scope?: string;
    electrolyzer?: string;
    train?: string;
    span?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<{
    scope: string;
    title: string;
    electrolyzer: string | null;
    train: string | null;
    span: string;
    date_from?: string | null;
    date_to?: string | null;
    total: number;
    points: {
      date: string | null;
      time: string | null;
      voltage: number;
      voltage_sum?: number;
      current_ka: number;
      power_kw: number;
      electrolyzers?: number;
    }[];
  }> => (await apiClient.get("/monitoring/plant-trends", { params })).data,
  importProgress: async (): Promise<{
    active: boolean;
    done: number;
    total: number;
    names: string[];
  }> => (await apiClient.get("/monitoring/import-progress")).data,
};

// ---- Dropdown (combo) values of data-entry fields ----
export interface FieldOptionItem {
  id: number | null;
  value: string;
  managed: boolean;
  built_in: boolean;
  count: number;
}

export const fieldOptionsApi = {
  catalog: async (): Promise<{ table: string; fields: string[] }[]> =>
    (await apiClient.get("/field-options/catalog")).data,
  values: async (table: string): Promise<Record<string, string[]>> =>
    (await apiClient.get("/field-options/values", { params: { table } })).data,
  items: async (table: string, field: string): Promise<FieldOptionItem[]> =>
    (await apiClient.get("/field-options/items", { params: { table, field } })).data,
  add: async (table: string, field: string, value: string): Promise<{ id: number; value: string }> =>
    (await apiClient.post("/field-options", { table, field, value })).data,
  rename: async (
    id: number,
    value: string,
    applyToRecords: boolean
  ): Promise<{ id: number; value: string; records_updated: number }> =>
    (await apiClient.put(`/field-options/${id}`, { value, apply_to_records: applyToRecords })).data,
  remove: async (id: number): Promise<{ ok: boolean }> => (await apiClient.delete(`/field-options/${id}`)).data,
};
