"""
SQLAlchemy models for the PVC Arvand Electrolyzer Management System.

These map to a cleaned-up, normalized version of the original Uhde
"Administrator" Access database (322 raw tables, most of which were either
empty legacy artifacts, Access-internal UI state, or duplicated staging
tables). Every field that carries real plant data has a home here; the
original Access table/column name is noted in a comment for traceability.
"""
from datetime import datetime, date

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


# ==========================================================================
# Users / authentication / per-form access control
# ==========================================================================

class AppRole(Base):
    """Named plant role with a menu/section visibility matrix (e.g. Inspector)."""
    __tablename__ = "app_roles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RolePermission(Base):
    """Per-role, per-form access. Missing / 'none' = section completely hidden."""
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "form_key", name="uq_role_permission_role_form"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[int] = mapped_column(Integer, ForeignKey("app_roles.id"), index=True)
    form_key: Mapped[str] = mapped_column(String(50), index=True)
    level: Mapped[str] = mapped_column(String(10), default="none")  # none | view | edit


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")  # admin | user | visitor (system privilege)
    role_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("app_roles.id"), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    auth_source: Mapped[str] = mapped_column(String(20), default="local")  # local | ad
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FormPermission(Base):
    """Per-user, per-form access level. Used when the user has no app role_id. Missing == 'none' (hidden)."""
    __tablename__ = "form_permissions"
    __table_args__ = (UniqueConstraint("user_id", "form_key", name="uq_form_permission_user_form"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    form_key: Mapped[str] = mapped_column(String(50), index=True)
    level: Mapped[str] = mapped_column(String(10), default="none")  # none | view | edit


class AuditLog(Base):
    """Immutable application-wide audit trail. Admin-only read access via API."""
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    username: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    user_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    action: Mapped[str] = mapped_column(String(40), index=True)  # create|update|delete|login|logout|api|...
    resource: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)  # table or area
    resource_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    method: Mapped[str | None] = mapped_column(String(10), nullable=True)
    path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    before_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    changes: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {field: {old, new}}
    request_body: Mapped[dict | list | str | None] = mapped_column(JSON, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)


class BackupSettings(Base):
    """Single-row table holding the automatic-backup schedule configuration."""
    __tablename__ = "backup_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    time: Mapped[str] = mapped_column(String(5), default="02:00")  # 24h "HH:MM"
    days_of_week: Mapped[str] = mapped_column(String(50), default="mon,tue,wed,thu,fri,sat,sun")
    retention_count: Mapped[int] = mapped_column(Integer, default=14)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # success | error
    last_run_message: Mapped[str | None] = mapped_column(String(255), nullable=True)


class VoltageSyncSettings(Base):
    """ARIAORMS LogSheets → standardized voltage (daily HTTP pull + optional watch folder)."""
    __tablename__ = "voltage_sync_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    watch_dir: Mapped[str | None] = mapped_column(String(500), nullable=True)
    poll_seconds: Mapped[int] = mapped_column(Integer, default=30)
    source_url: Mapped[str | None] = mapped_column(
        String(500),
        default="http://192.168.20.12:8080/LogSheetsReports.aspx",
        nullable=True,
    )
    username: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Local wall-clock time for daily full pull of all electrolyzers (HH:MM).
    daily_time: Mapped[str] = mapped_column(String(5), default="00:00")
    # Inclusive days ending yesterday for scheduled pull (Sync Now includes today).
    lookback_days: Mapped[int] = mapped_column(Integer, default=7)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_run_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # JSON map: relative path -> {mtime, size} of last successfully applied file
    processed_state: Mapped[str | None] = mapped_column(Text, nullable=True)


class AlertRule(Base):
    """Configurable warning/danger thresholds for plant monitoring."""
    __tablename__ = "alert_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    metric: Mapped[str] = mapped_column(String(40), index=True)
    # cell_voltage | standardized_voltage | total_voltage
    # missing_anode | missing_cathode | anode_decommissioned | cathode_decommissioned
    operator: Mapped[str] = mapped_column(String(10), default="gt")  # gt | gte | lt | lte
    warning_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    danger_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    electrolyzer: Mapped[str | None] = mapped_column(String(50), nullable=True)  # null = all
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notify: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class AlertEvent(Base):
    """Raised alerts shown in the monitoring inbox / notifications."""
    __tablename__ = "alert_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("alert_rules.id"), nullable=True, index=True)
    fingerprint: Mapped[str] = mapped_column(String(200), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)  # warning | danger | info
    category: Mapped[str] = mapped_column(String(40), index=True)  # voltage | anode | cathode | element
    metric: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)
    position: Mapped[str | None] = mapped_column(String(50), nullable=True)
    element_nr: Mapped[str | None] = mapped_column(String(50), nullable=True)
    component_ref: Mapped[str | None] = mapped_column(String(50), nullable=True)  # anode/cathode nr
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    reading_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reading_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)  # open | acknowledged | resolved
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ==========================================================================
# Plant configuration / lookups  (tblElektrolyseurbezeichnung, etc.)
# ==========================================================================

class Electrolyzer(Base):
    __tablename__ = "electrolyzers"  # was: tblElektrolyseurbezeichnung
    nr: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str | None] = mapped_column(String(100))


class SubPlant(Base):
    __tablename__ = "sub_plants"  # was: tblTeilanlagenbezeichnung
    nr: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str | None] = mapped_column(String(100))


class FullPlant(Base):
    __tablename__ = "full_plants"  # was: tblGesamtanlagenbezeichnung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    language_id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str | None] = mapped_column(String(150))


class Rectifier(Base):
    __tablename__ = "rectifiers"  # was: tblGleichrichterbezeichnung
    nr: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str | None] = mapped_column(String(100))


class Transformer(Base):
    __tablename__ = "transformers"  # was: tblTransformatorbezeichnung
    nr: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str | None] = mapped_column(String(100))


class ElectrolyzerArrangement(Base):
    __tablename__ = "electrolyzer_arrangements"  # was: tblElektrolyseuranordnung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(100))  # Bezeichnung
    sub_plant: Mapped[str | None] = mapped_column(String(100))  # Teilanlage
    transformer: Mapped[str | None] = mapped_column(String(100))
    rectifier: Mapped[str | None] = mapped_column(String(100))
    block: Mapped[str | None] = mapped_column(String(50))
    start_position: Mapped[str | None] = mapped_column(String(50))  # Anfangsposition
    end_position: Mapped[str | None] = mapped_column(String(50))  # Endposition


class ReservePosition(Base):
    __tablename__ = "reserve_positions"  # was: tblReserveplaetze
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    position: Mapped[str | None] = mapped_column(String(50))


# ==========================================================================
# Settings  (tblBasisdaten + derived plant-wide configuration)
# ==========================================================================

class PlantSettings(Base):
    """Single-row table holding the global plant configuration."""
    __tablename__ = "plant_settings"  # was: tblBasisdaten (+ subset of tblGewDaten)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    customer: Mapped[str | None] = mapped_column(String(150))  # Kunde
    uan: Mapped[str | None] = mapped_column(String(50))
    version: Mapped[str | None] = mapped_column(String(20))
    plant_type_raw: Mapped[int | None] = mapped_column(Integer)  # Anlagentyp (raw Access code)
    plant_type: Mapped[str] = mapped_column(String(10), default="NaOH")  # "NaOH" | "KOH"
    acidified: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(10), default="EN")
    reference_current_density: Mapped[float] = mapped_column(Float, default=6.0)  # kA/m^2
    zero_voltage: Mapped[float] = mapped_column(Float, default=2.40)  # U0
    date: Mapped[datetime | None] = mapped_column(DateTime)
    # Auto-logout after this many minutes without user input. 0 = disabled.
    session_idle_minutes: Mapped[int] = mapped_column(Integer, default=30)


class CorrectionFactor(Base):
    __tablename__ = "correction_factors"  # was: tblUnKorrekturfaktoren
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reference_current_density: Mapped[float | None] = mapped_column(Float)  # iRef
    temp_correction: Mapped[float | None] = mapped_column(Float)  # tKorrektur (V per degree)
    conc_correction: Mapped[float | None] = mapped_column(Float)  # cKorrektur (V per % w/w)


class ElectrodeArea(Base):
    __tablename__ = "electrode_areas"  # was: tblElementflaeche
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    area_m2: Mapped[float | None] = mapped_column(Float)  # Flaeche


class VoltageDistributionClass(Base):
    __tablename__ = "voltage_distribution_classes"  # was: tblKlassenVerteilungUnElemente
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lower_bound: Mapped[float | None] = mapped_column(Float)  # Untergrenze
    upper_bound: Mapped[float | None] = mapped_column(Float)  # Obergrenze
    label: Mapped[str | None] = mapped_column(String(50))  # Klasse


class Remark(Base):
    __tablename__ = "remarks"  # was: tblBemerkungen
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    author: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(100))
    text: Mapped[str | None] = mapped_column(Text)


class PerformanceTest(Base):
    """Access form frmTabelleLeistungstests / tblLeistungstests."""
    __tablename__ = "performance_tests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    plant_part: Mapped[str | None] = mapped_column(String(100))  # Anlagenteil
    ce_pct: Mapped[float | None] = mapped_column(Float)
    spc_kwh: Mapped[float | None] = mapped_column(Float)


# ==========================================================================
# Element Administration - the core module (Montage -> "Assembly Data")
# ==========================================================================

class GroupDefinition(Base):
    __tablename__ = "group_definitions"  # was: tblGruppenmerkmale
    group_nr: Mapped[str] = mapped_column(String(50), primary_key=True)  # Gruppe
    anode_coating: Mapped[str | None] = mapped_column(String(100))
    cathode_coating: Mapped[str | None] = mapped_column(String(100))
    membrane_type: Mapped[str | None] = mapped_column(String(100))
    gap_mm: Mapped[str | None] = mapped_column(String(50))  # Elektrodenabstand
    remarks: Mapped[str | None] = mapped_column(Text)


class InspectionReason(Base):
    __tablename__ = "inspection_reasons"  # was: tblInspektionsgruende
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    language_id: Mapped[int | None] = mapped_column(Integer)
    code: Mapped[str | None] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(String(200))  # Inspektionsgrund
    selected: Mapped[bool] = mapped_column(Boolean, default=False)  # Gewaehlt
    count: Mapped[int | None] = mapped_column(Integer)  # Anzahl


class InspectionFinding(Base):
    """Reusable finding codes used inside inspection reports."""
    __tablename__ = "inspection_findings"  # was: tblInspektionsberichtBefunde
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    language_id: Mapped[int | None] = mapped_column(Integer)
    code: Mapped[str | None] = mapped_column(String(20))
    text: Mapped[str | None] = mapped_column(String(200))
    selected: Mapped[bool] = mapped_column(Boolean, default=False)
    count: Mapped[int | None] = mapped_column(Integer)


class Element(Base):
    """The core 'Assembly Data' record - one row per element installation."""
    __tablename__ = "elements"  # was: Montage
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)  # Element Nr
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True)  # Elektrolyseur
    position: Mapped[str | None] = mapped_column(String(50))
    group_nr: Mapped[str | None] = mapped_column(String(50))  # Gruppe
    generation: Mapped[str | None] = mapped_column(String(50))
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)  # Anoden Nr
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)  # Kathoden Nr
    membrane_nr: Mapped[str | None] = mapped_column(String(50), index=True)  # Membran Nr
    membrane_type: Mapped[str | None] = mapped_column(String(100))  # Membrantyp
    gap_mm: Mapped[str | None] = mapped_column(String(50))  # Elektroden Abstand
    assembly_date: Mapped[date | None] = mapped_column(Date)  # Montage Datum
    commissioning_date: Mapped[date | None] = mapped_column(Date)  # Einschalt Datum
    decommissioning_date: Mapped[date | None] = mapped_column(Date)  # Ausschalt Datum
    disassembly_date: Mapped[date | None] = mapped_column(Date)  # Demontage Datum
    dol_days: Mapped[int | None] = mapped_column(Integer)  # DOL, also recomputed on read
    decommission_reason: Mapped[str | None] = mapped_column(String(200))  # Abschaltgrund
    ispb: Mapped[str | None] = mapped_column(String(50))
    anode_coating: Mapped[str | None] = mapped_column(String(100))
    anode_electrode: Mapped[str | None] = mapped_column(String(100))
    anode_shell: Mapped[str | None] = mapped_column(String(100))
    cathode_coating: Mapped[str | None] = mapped_column(String(100))
    cathode_electrode: Mapped[str | None] = mapped_column(String(100))
    cathode_shell: Mapped[str | None] = mapped_column(String(100))
    membrane_info: Mapped[str | None] = mapped_column(String(200))  # Info Membrane
    membrane_remark: Mapped[str | None] = mapped_column(Text)
    anode_remark: Mapped[str | None] = mapped_column(Text)  # توضیحات آند
    cathode_remark: Mapped[str | None] = mapped_column(Text)  # توضیحات کاتد
    remarks: Mapped[str | None] = mapped_column(Text)


class InspectionReport(Base):
    __tablename__ = "inspection_reports"  # was: tblInspektionsbericht
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    inspection_reason: Mapped[str | None] = mapped_column(String(200))
    blister_anode_area: Mapped[str | None] = mapped_column(String(100))
    blister_periphery_top: Mapped[str | None] = mapped_column(String(100))
    blister_periphery_bottom: Mapped[str | None] = mapped_column(String(100))
    blister_periphery_side: Mapped[str | None] = mapped_column(String(100))
    blister_corners: Mapped[str | None] = mapped_column(String(100))
    folds: Mapped[str | None] = mapped_column(String(100))  # Falten
    pressure_marks: Mapped[str | None] = mapped_column(String(100))  # Druckstellen
    visible_holes: Mapped[str | None] = mapped_column(String(100))  # SichtbareLoecher
    cracks: Mapped[str | None] = mapped_column(String(100))  # Risse
    blister_remarks: Mapped[str | None] = mapped_column(Text)
    sample_cathode: Mapped[bool] = mapped_column(Boolean, default=False)
    sample_anode: Mapped[bool] = mapped_column(Boolean, default=False)
    sample_membrane: Mapped[bool] = mapped_column(Boolean, default=False)
    anode_tube_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    anode_tube_remark: Mapped[str | None] = mapped_column(Text)
    cathode_tube_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    cathode_tube_remark: Mapped[str | None] = mapped_column(Text)
    anode_spacer_ok: Mapped[bool] = mapped_column(Boolean, default=False)  # Distanzstreifen Anode
    anode_spacer_remark: Mapped[str | None] = mapped_column(Text)
    cathode_spacer_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    cathode_spacer_remark: Mapped[str | None] = mapped_column(Text)
    frame_gasket_ok: Mapped[bool] = mapped_column(Boolean, default=False)  # Rahmendichtung
    frame_gasket_remark: Mapped[str | None] = mapped_column(Text)
    inspector_name: Mapped[str | None] = mapped_column(String(100))
    inspection_date: Mapped[datetime | None] = mapped_column(DateTime)
    general_remarks: Mapped[str | None] = mapped_column(Text)
    # CZ-03-00-189-A header and footer lines. Added on existing SQLite files at startup.
    client: Mapped[str | None] = mapped_column(String(150))
    anode_nr: Mapped[str | None] = mapped_column(String(50))
    cathode_nr: Mapped[str | None] = mapped_column(String(50))
    membrane_nr: Mapped[str | None] = mapped_column(String(50))
    membrane_type: Mapped[str | None] = mapped_column(String(100))
    electrolyzer: Mapped[str | None] = mapped_column(String(50))
    position: Mapped[str | None] = mapped_column(String(50))
    operation_days: Mapped[str | None] = mapped_column(String(20))
    electrode_nr_anode: Mapped[str | None] = mapped_column(String(50))
    electrode_nr_cathode: Mapped[str | None] = mapped_column(String(50))
    deformation_pan: Mapped[str | None] = mapped_column(String(200))
    deformation_electrode: Mapped[str | None] = mapped_column(String(200))
    coloured_area: Mapped[str | None] = mapped_column(String(200))
    coloured_electrode: Mapped[str | None] = mapped_column(String(200))
    coloured_pan: Mapped[str | None] = mapped_column(String(200))
    deposits: Mapped[str | None] = mapped_column(Text)
    leakage_pan: Mapped[str | None] = mapped_column(String(200))
    leakage_web: Mapped[str | None] = mapped_column(String(200))
    leakage_corner: Mapped[str | None] = mapped_column(String(200))
    leakage_outlet: Mapped[str | None] = mapped_column(String(200))
    leakage_inlet: Mapped[str | None] = mapped_column(String(200))
    signature: Mapped[str | None] = mapped_column(String(150))
    sample_cathode_note: Mapped[str | None] = mapped_column(String(200))
    sample_anode_note: Mapped[str | None] = mapped_column(String(200))
    sample_membrane_note: Mapped[str | None] = mapped_column(String(200))
    xrf_anode: Mapped[str | None] = mapped_column(String(200))
    xrf_cathode: Mapped[str | None] = mapped_column(String(200))
    sign_insp_name: Mapped[str | None] = mapped_column(String(150))
    sign_insp_image: Mapped[str | None] = mapped_column(Text)
    sign_insp_at: Mapped[str | None] = mapped_column(String(40))
    sign_maint_name: Mapped[str | None] = mapped_column(String(150))
    sign_maint_image: Mapped[str | None] = mapped_column(Text)
    sign_maint_at: Mapped[str | None] = mapped_column(String(40))
    sign_proc_name: Mapped[str | None] = mapped_column(String(150))
    sign_proc_image: Mapped[str | None] = mapped_column(Text)
    sign_proc_at: Mapped[str | None] = mapped_column(String(40))


class AssemblyInspectionReport(Base):
    """Uhde Inspection Report for the Assembly of cell Elements (مونتاژ checklist)."""
    __tablename__ = "assembly_inspection_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assembly_date: Mapped[date | None] = mapped_column(Date, index=True)
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    membrane_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    membrane_type: Mapped[str | None] = mapped_column(String(100))
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True)
    position: Mapped[str | None] = mapped_column(String(50))
    group_nr: Mapped[str | None] = mapped_column(String(50))
    remarks: Mapped[str | None] = mapped_column(Text)
    checks: Mapped[dict] = mapped_column(JSON, default=dict)  # {activity_key: bool}
    check_remarks: Mapped[dict] = mapped_column(JSON, default=dict)  # {activity_key: str}
    spacer_thickness_anode: Mapped[str | None] = mapped_column(String(50))
    spacer_thickness_cathode: Mapped[str | None] = mapped_column(String(50))
    electrode_distance: Mapped[str | None] = mapped_column(String(50))
    sign_maint_name: Mapped[str | None] = mapped_column(String(150))
    sign_maint_image: Mapped[str | None] = mapped_column(Text)
    sign_maint_at: Mapped[str | None] = mapped_column(String(40))
    sign_insp_name: Mapped[str | None] = mapped_column(String(150))
    sign_insp_image: Mapped[str | None] = mapped_column(Text)
    sign_insp_at: Mapped[str | None] = mapped_column(String(40))
    sign_proc_name: Mapped[str | None] = mapped_column(String(150))
    sign_proc_image: Mapped[str | None] = mapped_column(Text)
    sign_proc_at: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InspectionHalfshellGrid(Base):
    """
    Generic replacement for the 4 Access grid tables
    (tblInspektionsberichtAnodenhalbschale / Kathodenhalbschale / MembranAS /
    MembranKS / MembranLT), each a 13(rows A-M) x 18(cols) defect map.
    """
    __tablename__ = "inspection_halfshell_grids"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    grid_type: Mapped[str] = mapped_column(String(30))  # anode_half | cathode_half | membrane_as | membrane_ks | membrane_lt
    grid_data: Mapped[dict] = mapped_column(JSON, default=dict)  # {"A1": "...", ...}


class CellComponent(Base):
    __tablename__ = "cell_components"  # was: Einzelteile
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    part_nr: Mapped[str | None] = mapped_column(String(50))  # Teil Nr
    name: Mapped[str | None] = mapped_column(String(200))  # Benennung
    drawing_nr: Mapped[str | None] = mapped_column(String(50))
    revision: Mapped[str | None] = mapped_column(String(20))
    parts_per_element: Mapped[float | None] = mapped_column(Float)
    element_count: Mapped[float | None] = mapped_column(Float)
    total_parts: Mapped[float | None] = mapped_column(Float)
    reserve_index: Mapped[float | None] = mapped_column(Float)


# ==========================================================================
# Anodes / Cathodes / Membranes
# ==========================================================================

class Anode(Base):
    __tablename__ = "anodes"  # was: tblAnodendetails
    anode_nr: Mapped[str] = mapped_column(String(50), primary_key=True)  # Anodennummer
    assembly_group: Mapped[str | None] = mapped_column(String(50))  # Baugruppe
    component_nr: Mapped[str | None] = mapped_column(String(50))  # Bauteil Nr
    customer_drawing_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    manufacturer_order_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer_drawing_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer_date: Mapped[datetime | None] = mapped_column(DateTime)
    tank: Mapped[str | None] = mapped_column(String(50))  # Wanne
    contact_strip: Mapped[str | None] = mapped_column(String(50))
    electrode_support: Mapped[str | None] = mapped_column(String(50))
    electrode_shape: Mapped[str | None] = mapped_column(String(50))
    coating: Mapped[str | None] = mapped_column(String(50))
    baffle_plate: Mapped[str | None] = mapped_column(String(50))
    downcomer: Mapped[str | None] = mapped_column(String(50))
    inlet_system: Mapped[str | None] = mapped_column(String(50))
    standpipe_diameter: Mapped[str | None] = mapped_column(String(50))
    flange_width: Mapped[str | None] = mapped_column(String(50))
    received_date: Mapped[datetime | None] = mapped_column(DateTime)
    remarks: Mapped[str | None] = mapped_column(Text)
    decommission_date: Mapped[datetime | None] = mapped_column(DateTime)
    batch: Mapped[str | None] = mapped_column(String(50))
    generation: Mapped[str | None] = mapped_column(String(50))


class Cathode(Base):
    __tablename__ = "cathodes"  # was: tblKathodendetails
    cathode_nr: Mapped[str] = mapped_column(String(50), primary_key=True)
    assembly_group: Mapped[str | None] = mapped_column(String(50))
    component_nr: Mapped[str | None] = mapped_column(String(50))
    customer_drawing_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    manufacturer_order_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer_drawing_nr: Mapped[str | None] = mapped_column(String(50))
    manufacturer_date: Mapped[datetime | None] = mapped_column(DateTime)
    tank: Mapped[str | None] = mapped_column(String(50))
    contact_strip: Mapped[str | None] = mapped_column(String(50))
    electrode_support: Mapped[str | None] = mapped_column(String(50))
    electrode_shape: Mapped[str | None] = mapped_column(String(50))
    coating: Mapped[str | None] = mapped_column(String(50))
    inlet_system: Mapped[str | None] = mapped_column(String(50))
    standpipe_diameter: Mapped[str | None] = mapped_column(String(50))
    flange_width: Mapped[str | None] = mapped_column(String(50))
    received_date: Mapped[datetime | None] = mapped_column(DateTime)
    remarks: Mapped[str | None] = mapped_column(Text)
    decommission_date: Mapped[datetime | None] = mapped_column(DateTime)
    batch: Mapped[str | None] = mapped_column(String(50))
    generation: Mapped[str | None] = mapped_column(String(50))


class Membrane(Base):
    __tablename__ = "membranes"  # was: tblMembrandetails
    membrane_nr: Mapped[str] = mapped_column(String(50), primary_key=True)
    membrane_type: Mapped[str | None] = mapped_column(String(100))
    received_date: Mapped[datetime | None] = mapped_column(DateTime)
    remarks: Mapped[str | None] = mapped_column(Text)
    decommission_date: Mapped[datetime | None] = mapped_column(DateTime)
    batch: Mapped[str | None] = mapped_column(String(50))


class MaintenanceReport(Base):
    """Uploaded maintenance report for an anode, cathode, or membrane."""

    __tablename__ = "maintenance_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    component_nr: Mapped[str] = mapped_column(String(50), index=True)
    report_date: Mapped[datetime | None] = mapped_column(DateTime)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime)


class MaintenanceReportFile(Base):
    __tablename__ = "maintenance_report_files"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[int] = mapped_column(Integer, index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(80))
    content_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime)


class AnodeMaintenance(Base):
    __tablename__ = "anode_maintenance"  # was: tblAnodeninstandhaltung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    finding: Mapped[str | None] = mapped_column(Text)  # Befund
    action: Mapped[str | None] = mapped_column(Text)  # Aktion
    dispatch_date: Mapped[datetime | None] = mapped_column(DateTime)
    return_date: Mapped[datetime | None] = mapped_column(DateTime)


class CathodeMaintenance(Base):
    __tablename__ = "cathode_maintenance"  # was: tblKathodeninstandhaltung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    finding: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(Text)
    dispatch_date: Mapped[datetime | None] = mapped_column(DateTime)
    return_date: Mapped[datetime | None] = mapped_column(DateTime)


class MembraneMaintenance(Base):
    __tablename__ = "membrane_maintenance"  # was: tblMembraninstandhaltung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    membrane_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)  # Reparaturdatum
    repair_work: Mapped[str | None] = mapped_column(Text)  # Reparatur


class AnodeRecoating(Base):
    __tablename__ = "anode_recoating"  # was: tblAnodenrecoating
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    coating_nr: Mapped[str | None] = mapped_column(String(50))
    dispatch_date: Mapped[datetime | None] = mapped_column(DateTime)
    return_date: Mapped[datetime | None] = mapped_column(DateTime)
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    recoating_number: Mapped[str | None] = mapped_column(String(20))
    remarks: Mapped[str | None] = mapped_column(Text)


class CathodeRecoating(Base):
    __tablename__ = "cathode_recoating"  # was: tblKathodenrecoating
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    dispatch_date: Mapped[datetime | None] = mapped_column(DateTime)
    return_date: Mapped[datetime | None] = mapped_column(DateTime)
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    remarks: Mapped[str | None] = mapped_column(Text)


class AnodeCoatingCheck(Base):
    __tablename__ = "anode_coating_checks"  # was: tblAnodencoatingpruefung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    coating_nr: Mapped[str | None] = mapped_column(String(50))
    dol_days: Mapped[int | None] = mapped_column(Integer)
    check_date: Mapped[datetime | None] = mapped_column(DateTime)
    inspector: Mapped[str | None] = mapped_column(String(100))
    residual_thickness: Mapped[float | None] = mapped_column(Float)
    potential: Mapped[float | None] = mapped_column(Float)
    remarks: Mapped[str | None] = mapped_column(Text)


class CathodeCoatingCheck(Base):
    __tablename__ = "cathode_coating_checks"  # was: tblKathodencoatingpruefung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    check_date: Mapped[datetime | None] = mapped_column(DateTime)
    inspector: Mapped[str | None] = mapped_column(String(100))
    residual_thickness: Mapped[float | None] = mapped_column(Float)
    potential: Mapped[float | None] = mapped_column(Float)
    remarks: Mapped[str | None] = mapped_column(Text)


class ElectrodeSegregation(Base):
    """TAFKIK workshop segregation / warranty decision for an anode or cathode."""
    __tablename__ = "electrode_segregations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_nr: Mapped[str] = mapped_column(String(50), index=True)
    electrode_kind: Mapped[str | None] = mapped_column(String(20))  # anode | cathode | unknown
    company: Mapped[str | None] = mapped_column(String(100))  # from Element anode/cathode coating
    service_life: Mapped[str | None] = mapped_column(String(100))
    install_date: Mapped[date | None] = mapped_column(Date)
    decommission_date: Mapped[date | None] = mapped_column(Date)
    disassemble_date: Mapped[date | None] = mapped_column(Date)
    inspection_date: Mapped[date | None] = mapped_column(Date)
    xrf: Mapped[str | None] = mapped_column(String(100))
    pair_serial_nr: Mapped[str | None] = mapped_column(String(50))
    pair_xrf: Mapped[str | None] = mapped_column(String(100))
    decommission_voltage: Mapped[float | None] = mapped_column(Float)
    decommission_ka: Mapped[float | None] = mapped_column(Float)
    decommission_temp: Mapped[float | None] = mapped_column(Float)
    voltage_quality: Mapped[str | None] = mapped_column(String(100))  # تفسیر ولتاژ
    warranty: Mapped[str | None] = mapped_column(String(100))
    coating_quality: Mapped[str | None] = mapped_column(String(100))
    decision: Mapped[str | None] = mapped_column(String(200))
    problems: Mapped[str | None] = mapped_column(Text)  # from Element.decommission_reason
    segregation: Mapped[str | None] = mapped_column(Text)
    pallet: Mapped[str | None] = mapped_column(String(50))
    inspection_form_serial: Mapped[str | None] = mapped_column(String(150))  # Inspection.client
    remarks: Mapped[str | None] = mapped_column(Text)  # تفکیک در حضور بازرس


# ==========================================================================
# Shutdowns
# ==========================================================================

class ShutdownCategory(Base):
    __tablename__ = "shutdown_categories"  # was: tblAbschaltungskategorien
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category: Mapped[str | None] = mapped_column(String(100))


class ShutdownCause(Base):
    __tablename__ = "shutdown_causes"  # was: tblAbschaltungsursachen
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    language_id: Mapped[int | None] = mapped_column(Integer)
    code: Mapped[str | None] = mapped_column(String(20))
    cause: Mapped[str | None] = mapped_column(String(200))
    category: Mapped[str | None] = mapped_column(String(100))


class Shutdown(Base):
    __tablename__ = "shutdowns"  # was: tblAbschaltungen
    nr: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_part: Mapped[str | None] = mapped_column(String(50))  # Anlagenteil
    shutdown_time: Mapped[datetime | None] = mapped_column(DateTime)
    startup_time: Mapped[datetime | None] = mapped_column(DateTime)
    remarks: Mapped[str | None] = mapped_column(Text)
    code: Mapped[str | None] = mapped_column(String(10))
    category: Mapped[str | None] = mapped_column(String(50))
    cause: Mapped[str | None] = mapped_column(String(200))


# ==========================================================================
# Voltage / Standardized Voltage (SPC)
# ==========================================================================

class ElectrolyzerNormalization(Base):
    """A 'normalization batch' - the reference conditions for a set of
    electrolyzer/element voltage readings on a given date."""
    __tablename__ = "electrolyzer_normalizations"  # was: NormElek + Normierung
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalization_nr: Mapped[int | None] = mapped_column(Integer)  # Normierung
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True)
    date: Mapped[datetime | None] = mapped_column(DateTime)
    time: Mapped[str | None] = mapped_column(String(20))
    total_current: Mapped[float | None] = mapped_column(Float)  # I Gesamt (kA)
    reference_current_density: Mapped[float | None] = mapped_column(Float)  # Cc
    anolyte_temp: Mapped[float | None] = mapped_column(Float)  # t An
    catholyte_temp: Mapped[float | None] = mapped_column(Float)  # t Ka
    zero_voltage: Mapped[float | None] = mapped_column(Float)  # Uo
    total_voltage: Mapped[float | None] = mapped_column(Float)  # U Gesamt
    element_count: Mapped[int | None] = mapped_column(Integer)  # Elementzahl
    rack_a_avg: Mapped[float | None] = mapped_column(Float)
    rack_b_avg: Mapped[float | None] = mapped_column(Float)
    catholyte_conc: Mapped[float | None] = mapped_column(Float)
    cl2_pct: Mapped[float | None] = mapped_column(Float)
    h2_pct: Mapped[float | None] = mapped_column(Float)
    delta_p: Mapped[float | None] = mapped_column(Float)


class VoltageReading(Base):
    """Per-element voltage reading tied to a normalization batch."""
    __tablename__ = "voltage_readings"  # was: Spannungen
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalization_nr: Mapped[int | None] = mapped_column(Integer, index=True)
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True)
    position: Mapped[str | None] = mapped_column(String(50))
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)  # resolved at import time
    date: Mapped[datetime | None] = mapped_column(DateTime)
    time: Mapped[str | None] = mapped_column(String(20))
    voltage: Mapped[float | None] = mapped_column(Float)  # Ui
    voltage_prev: Mapped[float | None] = mapped_column(Float)  # Uk
    standardized_voltage: Mapped[float | None] = mapped_column(Float)  # computed Un, cached


# ==========================================================================
# Current Efficiency
# ==========================================================================

class CurrentEfficiencyEntry(Base):
    """Unifies tblEingabeCEElementNaOH / CEElektrolyseurNaOH / CETeilanlageNaOH."""
    __tablename__ = "current_efficiency_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(20))  # element | electrolyzer | sub_plant
    scope_ref: Mapped[str | None] = mapped_column(String(50))  # electrolyzer/subplant nr
    position: Mapped[str | None] = mapped_column(String(50))  # only for scope=element
    date: Mapped[datetime | None] = mapped_column(DateTime)
    value_pct: Mapped[float | None] = mapped_column(Float)  # CE (%)


# ==========================================================================
# Analyses - unified table replacing ~25 near-duplicate Access tables
# ==========================================================================

class AnalysisSample(Base):
    __tablename__ = "analysis_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_type: Mapped[str] = mapped_column(String(30), index=True)
    # anolyte | catholyte | chlorine_gas | pure_brine | demin_water | hydrogen | caustic_feed | hcl
    scope: Mapped[str] = mapped_column(String(20), index=True)
    # element | group | sub_plant | electrolyzer | total_plant
    electrolyzer: Mapped[str | None] = mapped_column(String(50), index=True)
    position: Mapped[str | None] = mapped_column(String(50))
    group_nr: Mapped[str | None] = mapped_column(String(50))
    sub_plant: Mapped[str | None] = mapped_column(String(50))
    date: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    time: Mapped[str | None] = mapped_column(String(20))
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)  # {"NaOH": 32.1, "pH": 7.2, ...}
