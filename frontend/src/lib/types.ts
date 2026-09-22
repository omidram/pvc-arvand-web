// TypeScript mirrors of backend/app/schemas.py

export interface Electrolyzer {
  nr: number;
  name: string | null;
}

export interface SubPlant {
  nr: number;
  name: string | null;
}

export interface FullPlant {
  id: number;
  language_id: number | null;
  name: string | null;
}

export interface Rectifier {
  nr: number;
  name: string | null;
}

export interface Transformer {
  nr: number;
  name: string | null;
}

export interface ElectrolyzerArrangement {
  id: number;
  name: string | null;
  sub_plant: string | null;
  transformer: string | null;
  rectifier: string | null;
  block: string | null;
  start_position: string | null;
  end_position: string | null;
}

export interface ReservePosition {
  id: number;
  position: string | null;
}

export interface PlantSettings {
  id: number;
  customer: string | null;
  uan: string | null;
  version: string | null;
  plant_type_raw: number | null;
  plant_type: string;
  acidified: boolean;
  language: string;
  reference_current_density: number;
  zero_voltage: number;
  date: string | null;
}

export interface CorrectionFactor {
  id: number;
  reference_current_density: number | null;
  temp_correction: number | null;
  conc_correction: number | null;
}

export interface ElectrodeArea {
  id: number;
  area_m2: number | null;
}

export interface VoltageDistributionClass {
  id: number;
  lower_bound: number | null;
  upper_bound: number | null;
  label: string | null;
}

export interface Remark {
  id: number;
  date: string | null;
  author: string | null;
  category: string | null;
  text: string | null;
}

export interface PerformanceTest {
  id: number;
  date: string | null;
  plant_part: string | null;
  ce_pct: number | null;
  spc_kwh: number | null;
}

export interface GroupDefinition {
  group_nr: string;
  anode_coating: string | null;
  cathode_coating: string | null;
  membrane_type: string | null;
  gap_mm: string | null;
  remarks: string | null;
}

export interface InspectionReason {
  id: number;
  language_id: number | null;
  code: string | null;
  reason: string | null;
  selected: boolean;
  count: number | null;
}

export interface InspectionFinding {
  id: number;
  language_id: number | null;
  code: string | null;
  text: string | null;
  selected: boolean;
  count: number | null;
}

export interface Element {
  id: number;
  element_nr: string | null;
  electrolyzer: string | null;
  position: string | null;
  group_nr: string | null;
  generation: string | null;
  anode_nr: string | null;
  cathode_nr: string | null;
  membrane_nr: string | null;
  membrane_type: string | null;
  gap_mm: string | null;
  assembly_date: string | null;
  commissioning_date: string | null;
  decommissioning_date: string | null;
  disassembly_date: string | null;
  dol_days: number | null;
  decommission_reason: string | null;
  ispb: string | null;
  anode_coating: string | null;
  anode_electrode: string | null;
  anode_shell: string | null;
  cathode_coating: string | null;
  cathode_electrode: string | null;
  cathode_shell: string | null;
  membrane_info: string | null;
  remarks: string | null;
  computed_dol_days: number | null;
  status: "active" | "disassembled" | "decommissioned" | "planned" | null;
}

export interface InspectionReport {
  id: number;
  element_nr: string | null;
  inspection_reason: string | null;
  blister_anode_area: string | null;
  blister_periphery_top: string | null;
  blister_periphery_bottom: string | null;
  blister_periphery_side: string | null;
  blister_corners: string | null;
  folds: string | null;
  pressure_marks: string | null;
  visible_holes: string | null;
  cracks: string | null;
  blister_remarks: string | null;
  sample_cathode: boolean;
  sample_anode: boolean;
  sample_membrane: boolean;
  anode_tube_ok: boolean;
  anode_tube_remark: string | null;
  cathode_tube_ok: boolean;
  cathode_tube_remark: string | null;
  anode_spacer_ok: boolean;
  anode_spacer_remark: string | null;
  cathode_spacer_ok: boolean;
  cathode_spacer_remark: string | null;
  frame_gasket_ok: boolean;
  frame_gasket_remark: string | null;
  inspector_name: string | null;
  inspection_date: string | null;
  general_remarks: string | null;
}

export interface InspectionHalfshellGrid {
  id: number;
  element_nr: string | null;
  grid_type: string;
  grid_data: Record<string, unknown>;
}

export interface CellComponent {
  id: number;
  part_nr: string | null;
  name: string | null;
  drawing_nr: string | null;
  revision: string | null;
  parts_per_element: number | null;
  element_count: number | null;
  total_parts: number | null;
  reserve_index: number | null;
  recommended_spares: number | null;
  calculated_spares: number | null;
}

export interface Anode {
  anode_nr: string;
  assembly_group: string | null;
  component_nr: string | null;
  customer_drawing_nr: string | null;
  manufacturer: string | null;
  manufacturer_order_nr: string | null;
  manufacturer_drawing_nr: string | null;
  manufacturer_date: string | null;
  tank: string | null;
  contact_strip: string | null;
  electrode_support: string | null;
  electrode_shape: string | null;
  coating: string | null;
  baffle_plate: string | null;
  downcomer: string | null;
  inlet_system: string | null;
  standpipe_diameter: string | null;
  flange_width: string | null;
  received_date: string | null;
  remarks: string | null;
  decommission_date: string | null;
  batch: string | null;
  generation: string | null;
}

export interface Cathode {
  cathode_nr: string;
  assembly_group: string | null;
  component_nr: string | null;
  customer_drawing_nr: string | null;
  manufacturer: string | null;
  manufacturer_order_nr: string | null;
  manufacturer_drawing_nr: string | null;
  manufacturer_date: string | null;
  tank: string | null;
  contact_strip: string | null;
  electrode_support: string | null;
  electrode_shape: string | null;
  coating: string | null;
  inlet_system: string | null;
  standpipe_diameter: string | null;
  flange_width: string | null;
  received_date: string | null;
  remarks: string | null;
  decommission_date: string | null;
  batch: string | null;
  generation: string | null;
}

export interface Membrane {
  membrane_nr: string;
  membrane_type: string | null;
  received_date: string | null;
  remarks: string | null;
  decommission_date: string | null;
  batch: string | null;
}

export interface AnodeMaintenance {
  id: number;
  anode_nr: string | null;
  date: string | null;
  finding: string | null;
  action: string | null;
  dispatch_date: string | null;
  return_date: string | null;
}

export interface CathodeMaintenance {
  id: number;
  cathode_nr: string | null;
  date: string | null;
  finding: string | null;
  action: string | null;
  dispatch_date: string | null;
  return_date: string | null;
}

export interface MembraneMaintenance {
  id: number;
  membrane_nr: string | null;
  date: string | null;
  repair_work: string | null;
}

export interface AnodeRecoating {
  id: number;
  anode_nr: string | null;
  coating_nr: string | null;
  dispatch_date: string | null;
  return_date: string | null;
  manufacturer: string | null;
  recoating_number: string | null;
  remarks: string | null;
}

export interface CathodeRecoating {
  id: number;
  cathode_nr: string | null;
  dispatch_date: string | null;
  return_date: string | null;
  manufacturer: string | null;
  remarks: string | null;
}

export interface AnodeCoatingCheck {
  id: number;
  anode_nr: string | null;
  coating_nr: string | null;
  dol_days: number | null;
  check_date: string | null;
  inspector: string | null;
  residual_thickness: number | null;
  potential: number | null;
  remarks: string | null;
}

export interface CathodeCoatingCheck {
  id: number;
  cathode_nr: string | null;
  check_date: string | null;
  inspector: string | null;
  residual_thickness: number | null;
  potential: number | null;
  remarks: string | null;
}

export interface ShutdownCategory {
  id: number;
  category: string | null;
}

export interface ShutdownCause {
  id: number;
  language_id: number | null;
  code: string | null;
  cause: string | null;
  category: string | null;
}

export interface Shutdown {
  nr: number;
  plant_part: string | null;
  shutdown_time: string | null;
  startup_time: string | null;
  remarks: string | null;
  code: string | null;
  category: string | null;
  cause: string | null;
  duration_hours: number | null;
}

export interface ElectrolyzerNormalization {
  id: number;
  normalization_nr: number | null;
  electrolyzer: string | null;
  date: string | null;
  time: string | null;
  total_current: number | null;
  reference_current_density: number | null;
  anolyte_temp: number | null;
  catholyte_temp: number | null;
  zero_voltage: number | null;
  total_voltage: number | null;
  element_count: number | null;
  cl2_pct: number | null;
  h2_pct: number | null;
  delta_p: number | null;
}

export interface VoltageReading {
  id: number;
  normalization_nr: number | null;
  electrolyzer: string | null;
  position: string | null;
  element_nr: string | null;
  date: string | null;
  time: string | null;
  voltage: number | null;
  voltage_prev: number | null;
  standardized_voltage: number | null;
}

export interface CurrentEfficiencyEntry {
  id: number;
  scope: string;
  scope_ref: string | null;
  position: string | null;
  date: string | null;
  value_pct: number | null;
}

export interface AnalysisSample {
  id: number;
  analysis_type: string;
  scope: string;
  electrolyzer: string | null;
  position: string | null;
  group_nr: string | null;
  sub_plant: string | null;
  date: string | null;
  time: string | null;
  parameters: Record<string, number | string>;
}

export interface ElectrodeSegregation {
  id: number;
  serial_nr: string;
  electrode_kind: string | null;
  company: string | null;
  service_life: string | null;
  install_date: string | null;
  dismantle_date: string | null;
  inspection_date: string | null;
  xrf: string | null;
  voltage_quality: string | null;
  warranty: string | null;
  coating_quality: string | null;
  decision: string | null;
  problems: string | null;
  segregation: string | null;
  pallet: string | null;
  remarks: string | null;
}

export interface DashboardStats {
  customer: string | null;
  uan: string | null;
  plant_type: string | null;
  counts: {
    electrolyzers: number;
    elements_total: number;
    elements_active: number;
    anodes: number;
    cathodes: number;
    membranes: number;
    shutdowns: number;
    inspections: number;
    analysis_samples: number;
    voltage_readings: number;
  };
}

export interface DolByMembraneType {
  membrane_type: string;
  active: number;
  passive: number;
  total_dol_days: number;
}

export interface GroupStat {
  group_nr: string;
  element_count: number;
  anode_coating: string | null;
  cathode_coating: string | null;
  membrane_type: string | null;
  gap_mm: string | null;
}

export interface ShutdownSummary {
  total_shutdowns: number;
  by_category: { category: string; count: number; total_hours: number }[];
}

export interface VoltageDistribution {
  total_readings: number;
  buckets: { label: string | null; lower_bound: number | null; upper_bound: number | null; count: number }[];
}

export interface HighDeviation {
  average: number | null;
  flagged: {
    electrolyzer: string | null;
    position: string | null;
    element_nr: string | null;
    standardized_voltage: number | null;
    deviation_pct: number | null;
  }[];
}

export interface ReportSummary {
  electrolyzer_filter: string | null;
  generated_at: string;
  counts: {
    active_elements: number;
    total_elements: number;
    shutdowns: number;
    voltage_readings: number;
    current_efficiency_entries: number;
  };
  voltage_stats: { count: number; mean: number; min: number; max: number; stdev: number } | null;
  voltage_outliers: { label: string; value: number; z_score: number }[];
  shutdown_stats: {
    total: number;
    total_hours: number;
    avg_duration_hours: number | null;
    by_category: { category: string; count: number; total_hours: number }[];
  };
  current_efficiency_stats: { count: number; mean: number; min: number; max: number } | null;
  dol_stats: { count: number; mean_days: number | null; min_days: number | null; max_days: number | null };
  recent_shutdowns: {
    nr: number;
    plant_part: string | null;
    category: string | null;
    cause: string | null;
    shutdown_time: string | null;
    startup_time: string | null;
  }[];
}

export interface ReportTrends {
  voltage_trend: { period: string; avg_voltage: number; count: number }[];
  shutdown_trend: { period: string; count: number; total_hours: number }[];
}

export interface SearchResults {
  elements: Record<string, unknown>[];
  anodes: Record<string, unknown>[];
  cathodes: Record<string, unknown>[];
  membranes: Record<string, unknown>[];
  shutdowns: Record<string, unknown>[];
  inspections: Record<string, unknown>[];
}

export interface AnalysisMeta {
  types: string[];
  parameter_units: Record<string, Record<string, string>>;
}

// ---------------------------------------------------------------- Auth / Users
export type PermissionLevel = "none" | "view" | "edit";
export type UserRole = "admin" | "user" | "visitor";

export interface AuthUser {
  id: number;
  username: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  permissions: Record<string, PermissionLevel>;
  auth_source?: "local" | "ad";
}

export type UserAccount = AuthUser;

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

// ---------------------------------------------------------------- Backup
export interface BackupSettings {
  id: number;
  enabled: boolean;
  time: string;
  days_of_week: string;
  retention_count: number;
  last_run_at: string | null;
  last_run_status: "success" | "error" | null;
  last_run_message: string | null;
  next_run_at: string | null;
}

export interface BackupFileInfo {
  filename: string;
  size_bytes: number;
  created_at: string;
}
