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
      const { data } = await apiClient.get(`${prefix}/${id}`);
      return data;
    },
    create: async (payload: TWrite): Promise<TRead> => {
      const { data } = await apiClient.post(prefix, payload);
      return data;
    },
    update: async (id: string | number, payload: TWrite): Promise<TRead> => {
      const { data } = await apiClient.put(`${prefix}/${id}`, payload);
      return data;
    },
    remove: async (id: string | number): Promise<void> => {
      await apiClient.delete(`${prefix}/${id}`);
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
  groupsOverview: async (): Promise<{ group_nr: string; element_count: number }[]> =>
    (await apiClient.get("/elements/groups/overview")).data,
  importAssemblyExcel: async (file: File): Promise<{ imported_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/elements/import-assembly-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
};

export const cellComponentsApi = {
  list: async (): Promise<T.CellComponent[]> => (await apiClient.get("/cell-components")).data,
  update: async (id: number, payload: Partial<T.CellComponent>): Promise<T.CellComponent> =>
    (await apiClient.put(`/cell-components/${id}`, payload)).data,
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

// ---------------------------------------------------------------- Inspections
export const inspectionsApi = resource<T.InspectionReport>("/inspections");

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
  distribution: async (electrolyzer?: string): Promise<T.VoltageDistribution> =>
    (await apiClient.get("/voltage/distribution", { params: { electrolyzer } })).data,
  highDeviation: async (params?: { threshold?: number; electrolyzer?: string }): Promise<T.HighDeviation> =>
    (await apiClient.get("/voltage/high-deviation", { params })).data,
  importCsv: async (file: File, electrolyzer: string, readingDate: string): Promise<{ imported_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/voltage/import", form, {
      params: { electrolyzer, reading_date: readingDate },
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  importExcel: async (file: File, electrolyzer?: string, readingDate?: string): Promise<{ imported_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const params: Record<string, string> = {};
    if (electrolyzer) params.electrolyzer = electrolyzer;
    if (readingDate) params.reading_date = readingDate;
    const { data } = await apiClient.post("/voltage/import-excel", form, {
      params,
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
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
  importLabExcel: async (file: File): Promise<{ imported_samples: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/analyses/import-lab-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
};

export const electrodeSegregationsApi = {
  ...resource<T.ElectrodeSegregation>("/electrode-segregations"),
  importTafkikExcel: async (file: File): Promise<{ imported_rows: number }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post("/electrode-segregations/import-tafkik-excel", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
};

// ---------------------------------------------------------------- Search
export const searchApi = {
  all: async (q: string): Promise<T.SearchResults> => (await apiClient.get("/search", { params: { q } })).data,
  byDate: async (field: string, date: string): Promise<Record<string, unknown>[]> =>
    (await apiClient.get("/search/by-date", { params: { field, date } })).data,
};

// ---------------------------------------------------------------- Statistics
export const statisticsApi = {
  dashboard: async (): Promise<T.DashboardStats> => (await apiClient.get("/statistics/dashboard")).data,
  dolByMembraneType: async (): Promise<T.DolByMembraneType[]> =>
    (await apiClient.get("/statistics/dol-by-membrane-type")).data,
  powerConsumption: async (electrolyzer?: string): Promise<Record<string, unknown>> =>
    (await apiClient.get("/statistics/power-consumption", { params: { electrolyzer } })).data,
  groups: async (): Promise<T.GroupStat[]> => (await apiClient.get("/statistics/groups")).data,
};

// ---------------------------------------------------------------- Reports & Analysis
export const reportsApi = {
  summary: async (electrolyzer?: string): Promise<T.ReportSummary> =>
    (await apiClient.get("/reports/summary", { params: { electrolyzer } })).data,
  trends: async (electrolyzer?: string): Promise<T.ReportTrends> =>
    (await apiClient.get("/reports/trends", { params: { electrolyzer } })).data,
};

// ---------------------------------------------------------------- Export helpers
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
  list: async (): Promise<T.UserAccount[]> => (await apiClient.get("/users")).data,
  create: async (payload: {
    username: string;
    full_name?: string;
    password: string;
    role: T.UserRole;
    is_active?: boolean;
    permissions?: Record<string, T.PermissionLevel>;
  }): Promise<T.UserAccount> => (await apiClient.post("/users", payload)).data,
  update: async (
    id: number,
    payload: Partial<{
      full_name: string;
      role: T.UserRole;
      is_active: boolean;
      password: string;
      permissions: Record<string, T.PermissionLevel>;
    }>
  ): Promise<T.UserAccount> => (await apiClient.put(`/users/${id}`, payload)).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },
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
    mode: "replace" | "merge"
  ): Promise<{ ok: boolean; imported: number; skipped: number; errors: string[] }> => {
    const form = new FormData();
    form.append("file", file);
    const { data } = await apiClient.post(`/data/import/excel/${resource}`, form, {
      params: { mode },
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
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
