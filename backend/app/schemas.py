"""Pydantic schemas. One Base (create/update body) + Read (adds id) per model."""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- Auth / Users

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=4)


class FormPermissionEntry(ORMModel):
    form_key: str
    level: str = "none"


class UserRead(ORMModel):
    id: int
    username: str
    full_name: str | None = None
    role: str
    is_active: bool
    created_at: datetime
    auth_source: str = "local"


class UserWithPermissions(UserRead):
    permissions: dict[str, str] = {}


class UserCreate(BaseModel):
    username: str
    full_name: str | None = None
    password: str = Field(min_length=4)
    role: str = "user"
    is_active: bool = True
    permissions: dict[str, str] | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=4)
    permissions: dict[str, str] | None = None


class MeResponse(UserRead):
    permissions: dict[str, str] = {}


# ---------------------------------------------------------------- Backup

class BackupSettingsBase(ORMModel):
    enabled: bool = False
    time: str = "02:00"
    days_of_week: str = "mon,tue,wed,thu,fri,sat,sun"
    retention_count: int = Field(default=14, ge=1, le=365)


class BackupSettingsUpdate(BackupSettingsBase):
    pass


class BackupSettingsRead(BackupSettingsBase):
    id: int
    last_run_at: datetime | None = None
    last_run_status: str | None = None
    last_run_message: str | None = None
    next_run_at: str | None = None


class BackupFileInfo(BaseModel):
    filename: str
    size_bytes: int
    created_at: datetime


# ---------------------------------------------------------------- Voltage sync (ARIAORMS)

class VoltageSyncSettingsBase(ORMModel):
    enabled: bool = False
    watch_dir: str | None = None
    poll_seconds: int = Field(default=30, ge=5, le=3600)
    source_url: str | None = "http://192.168.20.12:8080/LogSheetsReports.aspx"


class VoltageSyncSettingsUpdate(VoltageSyncSettingsBase):
    pass


class VoltageSyncSettingsRead(VoltageSyncSettingsBase):
    id: int
    last_run_at: datetime | None = None
    last_run_status: str | None = None
    last_run_message: str | None = None
    resolved_watch_dir: str | None = None
    watched_file_count: int = 0


class VoltageSyncRunResult(BaseModel):
    ok: bool
    files_scanned: int = 0
    files_applied: int = 0
    rows_upserted: int = 0
    message: str = ""
    details: list[dict] = []


# ---------------------------------------------------------------- Monitoring / alerts

class AlertRuleBase(ORMModel):
    name: str
    metric: str
    operator: str = "gt"
    warning_threshold: float | None = None
    danger_threshold: float | None = None
    electrolyzer: str | None = None
    enabled: bool = True
    notify: bool = True
    description: str | None = None


class AlertRuleUpdate(ORMModel):
    name: str | None = None
    metric: str | None = None
    operator: str | None = None
    warning_threshold: float | None = None
    danger_threshold: float | None = None
    electrolyzer: str | None = None
    enabled: bool | None = None
    notify: bool | None = None
    description: str | None = None


class AlertRuleRead(AlertRuleBase):
    id: int


class AlertEventRead(ORMModel):
    id: int
    rule_id: int | None = None
    fingerprint: str
    severity: str
    category: str
    metric: str
    title: str
    message: str | None = None
    electrolyzer: str | None = None
    position: str | None = None
    element_nr: str | None = None
    component_ref: str | None = None
    value: float | None = None
    threshold: float | None = None
    reading_date: datetime | None = None
    reading_time: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None


class AlertSummary(BaseModel):
    open_danger: int = 0
    open_warning: int = 0
    open_info: int = 0
    open_total: int = 0
    acknowledged: int = 0
    resolved_today: int = 0


class MonitoringCellStatus(BaseModel):
    electrolyzer: str
    position: str
    element_nr: str | None = None
    anode_nr: str | None = None
    cathode_nr: str | None = None
    voltage: float | None = None
    standardized_voltage: float | None = None
    reading_date: datetime | None = None
    reading_time: str | None = None
    severity: str = "ok"  # ok | warning | danger | unknown
    threshold: float | None = None


class MonitoringElectrolyzerBlock(BaseModel):
    electrolyzer: str
    reading_date: datetime | None = None
    reading_time: str | None = None
    cell_count: int = 0
    ok_count: int = 0
    warning_count: int = 0
    danger_count: int = 0
    max_voltage: float | None = None
    avg_voltage: float | None = None
    total_voltage: float | None = None
    cells: list[MonitoringCellStatus] = []


class MonitoringComponentIssue(BaseModel):
    kind: str  # missing_anode | missing_cathode | anode_decommissioned | cathode_decommissioned
    severity: str
    electrolyzer: str | None = None
    position: str | None = None
    element_nr: str | None = None
    component_ref: str | None = None
    detail: str


class MonitoringSnapshot(BaseModel):
    generated_at: datetime
    summary: AlertSummary
    voltage: dict
    electrolyzers: list[MonitoringElectrolyzerBlock]
    component_issues: list[MonitoringComponentIssue]
    recent_alerts: list[AlertEventRead]


# ---------------------------------------------------------------- Lookups

class ElectrolyzerBase(ORMModel):
    nr: int
    name: str | None = None


class SubPlantBase(ORMModel):
    nr: int
    name: str | None = None


class FullPlantBase(ORMModel):
    id: int
    language_id: int | None = None
    name: str | None = None


class RectifierBase(ORMModel):
    nr: int
    name: str | None = None


class TransformerBase(ORMModel):
    nr: int
    name: str | None = None


class ElectrolyzerArrangementBase(ORMModel):
    name: str | None = None
    sub_plant: str | None = None
    transformer: str | None = None
    rectifier: str | None = None
    block: str | None = None
    start_position: str | None = None
    end_position: str | None = None


class ElectrolyzerArrangementRead(ElectrolyzerArrangementBase):
    id: int


class ReservePositionBase(ORMModel):
    position: str | None = None


class ReservePositionRead(ReservePositionBase):
    id: int


# ---------------------------------------------------------------- Settings

class PlantSettingsBase(ORMModel):
    customer: str | None = None
    uan: str | None = None
    version: str | None = None
    plant_type_raw: int | None = None
    plant_type: str = "NaOH"
    acidified: bool = False
    language: str = "EN"
    reference_current_density: float = 6.0
    zero_voltage: float = 2.40
    date: datetime | None = None


class PlantSettingsRead(PlantSettingsBase):
    id: int


class CorrectionFactorBase(ORMModel):
    reference_current_density: float | None = None
    temp_correction: float | None = None
    conc_correction: float | None = None


class CorrectionFactorRead(CorrectionFactorBase):
    id: int


class ElectrodeAreaBase(ORMModel):
    area_m2: float | None = None


class ElectrodeAreaRead(ElectrodeAreaBase):
    id: int


class VoltageDistributionClassBase(ORMModel):
    lower_bound: float | None = None
    upper_bound: float | None = None
    label: str | None = None


class VoltageDistributionClassRead(VoltageDistributionClassBase):
    id: int


class RemarkBase(ORMModel):
    date: datetime | None = None
    author: str | None = None
    category: str | None = None
    text: str | None = None


class RemarkRead(RemarkBase):
    id: int


class PerformanceTestBase(ORMModel):
    date: datetime | None = None
    plant_part: str | None = None
    ce_pct: float | None = None
    spc_kwh: float | None = None


class PerformanceTestRead(PerformanceTestBase):
    id: int


# ---------------------------------------------------------------- Elements

class GroupDefinitionBase(ORMModel):
    group_nr: str
    anode_coating: str | None = None
    cathode_coating: str | None = None
    membrane_type: str | None = None
    gap_mm: str | None = None
    remarks: str | None = None


class InspectionReasonBase(ORMModel):
    language_id: int | None = None
    code: str | None = None
    reason: str | None = None
    selected: bool = False
    count: int | None = None


class InspectionReasonRead(InspectionReasonBase):
    id: int


class InspectionFindingBase(ORMModel):
    language_id: int | None = None
    code: str | None = None
    text: str | None = None
    selected: bool = False
    count: int | None = None


class InspectionFindingRead(InspectionFindingBase):
    id: int


class ElementBase(ORMModel):
    element_nr: str | None = None
    electrolyzer: str | None = None
    position: str | None = None
    group_nr: str | None = None
    generation: str | None = None
    anode_nr: str | None = None
    cathode_nr: str | None = None
    membrane_nr: str | None = None
    membrane_type: str | None = None
    gap_mm: str | None = None
    assembly_date: date | None = None
    commissioning_date: date | None = None
    decommissioning_date: date | None = None
    disassembly_date: date | None = None
    dol_days: int | None = None
    decommission_reason: str | None = None
    ispb: str | None = None
    anode_coating: str | None = None
    anode_electrode: str | None = None
    anode_shell: str | None = None
    cathode_coating: str | None = None
    cathode_electrode: str | None = None
    cathode_shell: str | None = None
    membrane_info: str | None = None
    remarks: str | None = None


class ElementRead(ElementBase):
    id: int
    computed_dol_days: int | None = None
    status: str | None = None


class InspectionReportBase(ORMModel):
    element_nr: str | None = None
    inspection_reason: str | None = None
    blister_anode_area: str | None = None
    blister_periphery_top: str | None = None
    blister_periphery_bottom: str | None = None
    blister_periphery_side: str | None = None
    blister_corners: str | None = None
    folds: str | None = None
    pressure_marks: str | None = None
    visible_holes: str | None = None
    cracks: str | None = None
    blister_remarks: str | None = None
    sample_cathode: bool = False
    sample_anode: bool = False
    sample_membrane: bool = False
    anode_tube_ok: bool = False
    anode_tube_remark: str | None = None
    cathode_tube_ok: bool = False
    cathode_tube_remark: str | None = None
    anode_spacer_ok: bool = False
    anode_spacer_remark: str | None = None
    cathode_spacer_ok: bool = False
    cathode_spacer_remark: str | None = None
    frame_gasket_ok: bool = False
    frame_gasket_remark: str | None = None
    inspector_name: str | None = None
    inspection_date: datetime | None = None
    general_remarks: str | None = None


class InspectionReportRead(InspectionReportBase):
    id: int


class InspectionHalfshellGridBase(ORMModel):
    element_nr: str | None = None
    grid_type: str
    grid_data: dict = {}


class InspectionHalfshellGridRead(InspectionHalfshellGridBase):
    id: int


class CellComponentBase(ORMModel):
    part_nr: str | None = None
    name: str | None = None
    drawing_nr: str | None = None
    revision: str | None = None
    parts_per_element: float | None = None
    element_count: float | None = None
    total_parts: float | None = None
    reserve_index: float | None = None


class CellComponentRead(CellComponentBase):
    id: int
    recommended_spares: float | None = None
    calculated_spares: float | None = None


# ---------------------------------------------------------------- Anode/Cathode/Membrane

class AnodeBase(ORMModel):
    anode_nr: str
    assembly_group: str | None = None
    component_nr: str | None = None
    customer_drawing_nr: str | None = None
    manufacturer: str | None = None
    manufacturer_order_nr: str | None = None
    manufacturer_drawing_nr: str | None = None
    manufacturer_date: datetime | None = None
    tank: str | None = None
    contact_strip: str | None = None
    electrode_support: str | None = None
    electrode_shape: str | None = None
    coating: str | None = None
    baffle_plate: str | None = None
    downcomer: str | None = None
    inlet_system: str | None = None
    standpipe_diameter: str | None = None
    flange_width: str | None = None
    received_date: datetime | None = None
    remarks: str | None = None
    decommission_date: datetime | None = None
    batch: str | None = None
    generation: str | None = None


class CathodeBase(ORMModel):
    cathode_nr: str
    assembly_group: str | None = None
    component_nr: str | None = None
    customer_drawing_nr: str | None = None
    manufacturer: str | None = None
    manufacturer_order_nr: str | None = None
    manufacturer_drawing_nr: str | None = None
    manufacturer_date: datetime | None = None
    tank: str | None = None
    contact_strip: str | None = None
    electrode_support: str | None = None
    electrode_shape: str | None = None
    coating: str | None = None
    inlet_system: str | None = None
    standpipe_diameter: str | None = None
    flange_width: str | None = None
    received_date: datetime | None = None
    remarks: str | None = None
    decommission_date: datetime | None = None
    batch: str | None = None
    generation: str | None = None


class MembraneBase(ORMModel):
    membrane_nr: str
    membrane_type: str | None = None
    received_date: datetime | None = None
    remarks: str | None = None
    decommission_date: datetime | None = None
    batch: str | None = None


class AnodeMaintenanceBase(ORMModel):
    anode_nr: str | None = None
    date: datetime | None = None
    finding: str | None = None
    action: str | None = None
    dispatch_date: datetime | None = None
    return_date: datetime | None = None


class AnodeMaintenanceRead(AnodeMaintenanceBase):
    id: int


class CathodeMaintenanceBase(ORMModel):
    cathode_nr: str | None = None
    date: datetime | None = None
    finding: str | None = None
    action: str | None = None
    dispatch_date: datetime | None = None
    return_date: datetime | None = None


class CathodeMaintenanceRead(CathodeMaintenanceBase):
    id: int


class MembraneMaintenanceBase(ORMModel):
    membrane_nr: str | None = None
    date: datetime | None = None
    repair_work: str | None = None


class MembraneMaintenanceRead(MembraneMaintenanceBase):
    id: int


class AnodeRecoatingBase(ORMModel):
    anode_nr: str | None = None
    coating_nr: str | None = None
    dispatch_date: datetime | None = None
    return_date: datetime | None = None
    manufacturer: str | None = None
    recoating_number: str | None = None
    remarks: str | None = None


class AnodeRecoatingRead(AnodeRecoatingBase):
    id: int


class CathodeRecoatingBase(ORMModel):
    cathode_nr: str | None = None
    dispatch_date: datetime | None = None
    return_date: datetime | None = None
    manufacturer: str | None = None
    remarks: str | None = None


class CathodeRecoatingRead(CathodeRecoatingBase):
    id: int


class AnodeCoatingCheckBase(ORMModel):
    anode_nr: str | None = None
    coating_nr: str | None = None
    dol_days: int | None = None
    check_date: datetime | None = None
    inspector: str | None = None
    residual_thickness: float | None = None
    potential: float | None = None
    remarks: str | None = None


class AnodeCoatingCheckRead(AnodeCoatingCheckBase):
    id: int


class CathodeCoatingCheckBase(ORMModel):
    cathode_nr: str | None = None
    check_date: datetime | None = None
    inspector: str | None = None
    residual_thickness: float | None = None
    potential: float | None = None
    remarks: str | None = None


class CathodeCoatingCheckRead(CathodeCoatingCheckBase):
    id: int


# ---------------------------------------------------------------- Shutdowns

class ShutdownCategoryBase(ORMModel):
    category: str | None = None


class ShutdownCategoryRead(ShutdownCategoryBase):
    id: int


class ShutdownCauseBase(ORMModel):
    language_id: int | None = None
    code: str | None = None
    cause: str | None = None
    category: str | None = None


class ShutdownCauseRead(ShutdownCauseBase):
    id: int


class ShutdownBase(ORMModel):
    plant_part: str | None = None
    shutdown_time: datetime | None = None
    startup_time: datetime | None = None
    remarks: str | None = None
    code: str | None = None
    category: str | None = None
    cause: str | None = None


class ShutdownRead(ShutdownBase):
    nr: int
    duration_hours: float | None = None


# ---------------------------------------------------------------- Voltage

class ElectrolyzerNormalizationBase(ORMModel):
    normalization_nr: int | None = None
    electrolyzer: str | None = None
    date: datetime | None = None
    time: str | None = None
    total_current: float | None = None
    reference_current_density: float | None = None
    anolyte_temp: float | None = None
    catholyte_temp: float | None = None
    zero_voltage: float | None = None
    total_voltage: float | None = None
    element_count: int | None = None
    cl2_pct: float | None = None
    h2_pct: float | None = None
    delta_p: float | None = None


class ElectrolyzerNormalizationRead(ElectrolyzerNormalizationBase):
    id: int


class VoltageReadingBase(ORMModel):
    normalization_nr: int | None = None
    electrolyzer: str | None = None
    position: str | None = None
    element_nr: str | None = None
    date: datetime | None = None
    time: str | None = None
    voltage: float | None = None
    voltage_prev: float | None = None
    standardized_voltage: float | None = None


class VoltageReadingRead(VoltageReadingBase):
    id: int


class CurrentEfficiencyEntryBase(ORMModel):
    scope: str
    scope_ref: str | None = None
    position: str | None = None
    date: datetime | None = None
    value_pct: float | None = None


class CurrentEfficiencyEntryRead(CurrentEfficiencyEntryBase):
    id: int


# ---------------------------------------------------------------- Analyses

class AnalysisSampleBase(ORMModel):
    analysis_type: str
    scope: str
    electrolyzer: str | None = None
    position: str | None = None
    group_nr: str | None = None
    sub_plant: str | None = None
    date: datetime | None = None
    time: str | None = None
    parameters: dict = {}


class AnalysisSampleRead(AnalysisSampleBase):
    id: int


class ElectrodeSegregationBase(ORMModel):
    serial_nr: str
    electrode_kind: str | None = None
    company: str | None = None
    service_life: str | None = None
    install_date: date | None = None
    dismantle_date: date | None = None
    inspection_date: date | None = None
    xrf: str | None = None
    voltage_quality: str | None = None
    warranty: str | None = None
    coating_quality: str | None = None
    decision: str | None = None
    problems: str | None = None
    segregation: str | None = None
    pallet: str | None = None
    remarks: str | None = None


class ElectrodeSegregationRead(ElectrodeSegregationBase):
    id: int
