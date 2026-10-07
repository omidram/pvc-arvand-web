from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import inspect, text

from . import alerts_engine, arialims_sync_scheduler, audit, backup_scheduler, models, voltage_sync_scheduler
from .audit_middleware import AuditMiddleware
from .auth import INSPECTION_COLLAB_KEYS, require_any_form_access, require_form_access, seed_default_admin
from .cell_component_names import persist_industrial_names
from .inspection_reason_names import persist_industrial_reasons
from .config import settings
from .database import Base, SessionLocal, engine
from .paths import static_dir
from .routers import (
    analyses,
    arrangement_board as arrangement_board_router_module,
    assembly_inspections,
    auth as auth_router_module,
    backup as backup_router_module,
    components,
    config as config_router,
    data_transfer,
    database as database_router_module,
    db_tables,
    directory as directory_router_module,
    elements,
    imports as imports_router_module,
    inspections,
    logs as logs_router_module,
    maintenance_reports as maintenance_reports_router_module,
    monitoring as monitoring_router_module,
    relations as relations_router_module,
    remarks,
    reports,
    roles as roles_router_module,
    search,
    segregation,
    shutdowns,
    statistics,
    storage as storage_router_module,
    warehouse_lifecycle as warehouse_lifecycle_router_module,
    users as users_router_module,
    voltage,
    voltage_sync as voltage_sync_router_module,
    arialims_sync as arialims_sync_router_module,
)

Base.metadata.create_all(bind=engine)


def _ensure_user_auth_source() -> None:
    try:
        columns = {col["name"] for col in inspect(engine).get_columns("users")}
    except Exception:
        return
    if "auth_source" in columns:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN auth_source VARCHAR(20) DEFAULT 'local'"))


def _ensure_user_role_id() -> None:
    try:
        columns = {col["name"] for col in inspect(engine).get_columns("users")}
    except Exception:
        return
    if "role_id" in columns:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN role_id INTEGER"))


_INSPECTION_SHEET_COLUMNS = {
    "client": "TEXT",
    "anode_nr": "TEXT",
    "cathode_nr": "TEXT",
    "membrane_nr": "TEXT",
    "membrane_type": "TEXT",
    "electrolyzer": "TEXT",
    "position": "TEXT",
    "operation_days": "TEXT",
    "electrode_nr_anode": "TEXT",
    "electrode_nr_cathode": "TEXT",
    "deformation_pan": "TEXT",
    "deformation_electrode": "TEXT",
    "coloured_area": "TEXT",
    "coloured_electrode": "TEXT",
    "coloured_pan": "TEXT",
    "deposits": "TEXT",
    "leakage_pan": "TEXT",
    "leakage_web": "TEXT",
    "leakage_corner": "TEXT",
    "leakage_outlet": "TEXT",
    "leakage_inlet": "TEXT",
    "signature": "TEXT",
    "sample_cathode_note": "TEXT",
    "sample_anode_note": "TEXT",
    "sample_membrane_note": "TEXT",
    "xrf_anode": "TEXT",
    "xrf_cathode": "TEXT",
    "sign_insp_name": "TEXT",
    "sign_insp_image": "TEXT",
    "sign_insp_at": "TEXT",
    "sign_maint_name": "TEXT",
    "sign_maint_image": "TEXT",
    "sign_maint_at": "TEXT",
    "sign_proc_name": "TEXT",
    "sign_proc_image": "TEXT",
    "sign_proc_at": "TEXT",
}


def _ensure_inspection_sheet_columns() -> None:
    """create_all does not add columns to a table that already exists."""
    try:
        present = {col["name"] for col in inspect(engine).get_columns("inspection_reports")}
    except Exception:
        return
    missing = [name for name in _INSPECTION_SHEET_COLUMNS if name not in present]
    if not missing:
        return
    with engine.begin() as conn:
        for name in missing:
            conn.execute(text(f"ALTER TABLE inspection_reports ADD COLUMN {name} {_INSPECTION_SHEET_COLUMNS[name]}"))


_ensure_user_auth_source()
_ensure_user_role_id()
_ensure_inspection_sheet_columns()


def _ensure_element_remark_columns() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("elements")}
    except Exception:
        return
    alters: list[str] = []
    if "membrane_remark" not in present:
        alters.append("ALTER TABLE elements ADD COLUMN membrane_remark TEXT")
    if "anode_remark" not in present:
        alters.append("ALTER TABLE elements ADD COLUMN anode_remark TEXT")
    if "cathode_remark" not in present:
        alters.append("ALTER TABLE elements ADD COLUMN cathode_remark TEXT")
    if not alters:
        return
    with engine.begin() as conn:
        for statement in alters:
            conn.execute(text(statement))


_ensure_element_remark_columns()


def _ensure_plant_settings_session_idle() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("plant_settings")}
    except Exception:
        return
    if "session_idle_minutes" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE plant_settings ADD COLUMN session_idle_minutes INTEGER DEFAULT 30"))


_ensure_plant_settings_session_idle()


def _ensure_segregation_disassemble_date() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("electrode_segregations")}
    except Exception:
        return
    if "disassemble_date" in present or "dismantle_date" not in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE electrode_segregations RENAME COLUMN dismantle_date TO disassemble_date"))


_ensure_segregation_disassemble_date()


def _ensure_segregation_enrich_columns() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("electrode_segregations")}
    except Exception:
        return
    additions = {
        "decommission_date": "DATE",
        "pair_serial_nr": "VARCHAR(50)",
        "pair_xrf": "VARCHAR(100)",
        "decommission_voltage": "FLOAT",
        "decommission_ka": "FLOAT",
        "decommission_temp": "FLOAT",
        "inspection_form_serial": "VARCHAR(150)",
    }
    for name, sql_type in additions.items():
        if name in present:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE electrode_segregations ADD COLUMN {name} {sql_type}"))
        present.add(name)


_ensure_segregation_enrich_columns()


def _ensure_normalization_energy_columns() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("electrolyzer_normalizations")}
    except Exception:
        return
    for name in ("rack_a_avg", "rack_b_avg", "catholyte_conc"):
        if name in present:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE electrolyzer_normalizations ADD COLUMN {name} FLOAT"))
        present.add(name)


_ensure_normalization_energy_columns()


def _ensure_voltage_sync_columns() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("voltage_sync_settings")}
    except Exception:
        return
    additions = {
        "username": "VARCHAR(120)",
        "password": "VARCHAR(255)",
        "daily_time": "VARCHAR(5) DEFAULT '00:00'",
        "lookback_days": "INTEGER DEFAULT 1",
    }
    for name, sql_type in additions.items():
        if name in present:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE voltage_sync_settings ADD COLUMN {name} {sql_type}"))
        present.add(name)


_ensure_voltage_sync_columns()


def _ensure_arialims_sync_table() -> None:
    """Ensure arialims_sync_settings exists (create_all already does; keep for future ALTERs)."""
    try:
        tables = set(inspect(engine).get_table_names())
    except Exception:
        return
    if "arialims_sync_settings" in tables:
        return
    models.AriaLimsSyncSettings.__table__.create(bind=engine, checkfirst=True)


_ensure_arialims_sync_table()


def _ensure_assembly_inspection_columns() -> None:
    insp = inspect(engine)
    if "assembly_inspection_reports" not in insp.get_table_names():
        return
    present = {col["name"] for col in insp.get_columns("assembly_inspection_reports")}
    if "check_remarks" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE assembly_inspection_reports ADD COLUMN check_remarks JSON"))


_ensure_assembly_inspection_columns()

with SessionLocal() as _db:
    seed_default_admin(_db)
    alerts_engine.ensure_default_rules(_db)
    persist_industrial_names(_db)
    persist_industrial_reasons(_db)

app = FastAPI(title="Arvand Electrolyzer Management Program", version="1.10")

# Register SQLAlchemy audit listeners (imported for side effects).
_ = audit


def _safe_static_file(full_path: str):
    root = static_dir().resolve()
    index = root / "index.html"
    if not index.is_file():
        return None
    relative = (full_path or "").lstrip("/").replace("\\", "/")
    if ".." in Path(relative).parts:
        return None
    candidates = []
    if relative:
        candidates.extend(
            [
                root / relative,
                root / f"{relative}.html",
                root / relative / "index.html",
            ]
        )
    else:
        candidates.append(index)
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if root == resolved or root in resolved.parents:
            if resolved.is_file():
                return resolved
    if relative and "." not in Path(relative).name:
        return index
    return None


@app.on_event("startup")
def _start_schedulers() -> None:
    backup_scheduler.init_scheduler_from_db()
    voltage_sync_scheduler.init_scheduler_from_db()
    arialims_sync_scheduler.init_scheduler_from_db()


@app.on_event("shutdown")
def _stop_schedulers() -> None:
    backup_scheduler.shutdown_scheduler()
    voltage_sync_scheduler.shutdown_scheduler()
    arialims_sync_scheduler.shutdown_scheduler()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_ORIGIN,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuditMiddleware)


def _perm(form_key: str) -> list[Depends]:
    return [Depends(require_form_access(form_key))]


def _api(router, **kwargs):
    """Mount a router under /api so page URLs like /cathodes never collide with REST."""
    extra_prefix = kwargs.pop("prefix", "")
    app.include_router(router, prefix="/api" + extra_prefix, **kwargs)


# --- Auth & Users (auth is public; users/roles/logs are admin-only in their routers) ---
_api(auth_router_module.router)
_api(imports_router_module.router)
_api(users_router_module.router)
_api(roles_router_module.router)
_api(logs_router_module.router)

# --- Plant configuration / settings ---
_api(config_router.electrolyzers_router, dependencies=_perm("settings"))
_api(config_router.sub_plants_router, dependencies=_perm("settings"))
_api(config_router.full_plants_router, dependencies=_perm("settings"))
_api(config_router.rectifiers_router, dependencies=_perm("settings"))
_api(config_router.transformers_router, dependencies=_perm("settings"))
_api(config_router.arrangements_router, dependencies=_perm("settings"))
_api(arrangement_board_router_module.router)
_api(config_router.reserve_positions_router, dependencies=_perm("settings"))
_api(config_router.correction_factors_router, dependencies=_perm("settings"))
_api(config_router.electrode_areas_router, dependencies=_perm("settings"))
_api(config_router.voltage_distribution_classes_router, dependencies=_perm("settings"))
_api(config_router.settings_router, dependencies=_perm("settings"))

# --- Element administration ---
_api(elements.router, dependencies=_perm("elements"))
_api(elements.group_definitions_router, dependencies=_perm("settings"))
_api(elements.inspection_reasons_router, dependencies=_perm("settings"))
_api(elements.inspection_findings_router, dependencies=_perm("settings"))
_api(elements.cell_components_router, dependencies=_perm("elements"))
_api(
    relations_router_module.router,
    dependencies=[
        Depends(
            require_any_form_access(
                "elements",
                "anodes",
                "cathodes",
                "membranes",
                "inspections",
                "shutdowns",
                "voltage",
                "settings",
            )
        )
    ],
)

# --- Anodes / cathodes / membranes ---
_api(components.anodes_router, dependencies=_perm("anodes"))
_api(components.anode_maintenance_router, dependencies=_perm("anodes"))
_api(components.anode_recoating_router, dependencies=_perm("anodes"))
_api(components.anode_coating_checks_router, dependencies=_perm("anodes"))
_api(components.cathodes_router, dependencies=_perm("cathodes"))
_api(components.cathode_maintenance_router, dependencies=_perm("cathodes"))
_api(components.cathode_recoating_router, dependencies=_perm("cathodes"))
_api(components.cathode_coating_checks_router, dependencies=_perm("cathodes"))
_api(components.membranes_router, dependencies=_perm("membranes"))
_api(components.membrane_maintenance_router, dependencies=_perm("membranes"))
_api(
    maintenance_reports_router_module.router,
    dependencies=[Depends(require_any_form_access("anodes", "cathodes", "membranes"))],
)

# --- TAFKIK electrode segregation (Element Administration workshop form) ---
_api(
    segregation.router,
    dependencies=[Depends(require_any_form_access("anodes", "cathodes", "elements"))],
)

# --- Inspections (shared by Insp. / Maint. / Proc. roles via related forms) ---
_api(inspections.router, dependencies=[Depends(require_any_form_access(*INSPECTION_COLLAB_KEYS))])
_api(inspections.grids_router, dependencies=[Depends(require_any_form_access(*INSPECTION_COLLAB_KEYS))])
_api(
    assembly_inspections.router,
    dependencies=[Depends(require_any_form_access("elements", "inspections", "anodes", "cathodes", "membranes"))],
)

# --- Shutdowns ---
_api(shutdowns.router, dependencies=_perm("shutdowns"))
_api(shutdowns.categories_router, dependencies=_perm("shutdowns"))
_api(shutdowns.causes_router, dependencies=_perm("shutdowns"))
_api(shutdowns.summary_router, dependencies=_perm("shutdowns"))

# --- Voltage / standardized voltage / current efficiency ---
_api(voltage.normalizations_router, dependencies=_perm("voltage"))
_api(voltage.readings_router, dependencies=_perm("voltage"))
_api(voltage.un_element_inputs_router, dependencies=_perm("voltage"))
_api(voltage.un_group_inputs_router, dependencies=_perm("voltage"))
_api(voltage.calc_router, dependencies=_perm("voltage"))
_api(voltage.current_efficiency_router, dependencies=_perm("voltage"))
_api(voltage.ce_calc_router, dependencies=_perm("voltage"))

# --- Lagerbestand (Access: frmLagerbestandAnoden/Kathoden/Membranen) ---
_api(storage_router_module.router)
_api(warehouse_lifecycle_router_module.router)

# --- Analyses ---
_api(analyses.router, dependencies=_perm("analyses"))

# --- Remarks / search / statistics (statistics has per-route dashboard/statistics deps) ---
_api(remarks.router, dependencies=_perm("remarks"))
_api(remarks.performance_tests_router, dependencies=_perm("voltage"))
_api(search.router, dependencies=_perm("search"))
_api(statistics.router)

# --- Reports & data analysis (replaces the old AI insights module) ---
_api(reports.router, dependencies=_perm("reports"))

# --- Import / export ---
_api(data_transfer.router)

# --- All 126 Access database tables (read-only archive) ---
_api(db_tables.router)

# --- Automatic / manual backup ---
_api(backup_router_module.router, dependencies=_perm("settings"))
_api(voltage_sync_router_module.router, dependencies=_perm("settings"))
_api(arialims_sync_router_module.router, dependencies=_perm("settings"))
# Monitoring uses voltage access (or admin); form_key "monitoring" is for finer grants in Users.
_api(monitoring_router_module.router, dependencies=_perm("voltage"))

# --- Admin database files / local vs online switch ---
_api(database_router_module.router)

# --- Admin Active Directory ---
_api(directory_router_module.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def root():
    index = _safe_static_file("")
    if index is not None:
        return FileResponse(index)
    return {"name": app.title, "version": app.version, "docs": "/docs"}


# SPA fallback — GET/HEAD only. Never register a catch-all that matches /api/*
# for other methods (that would turn missing API routes into HTTP 405).
@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa_or_static(full_path: str, request: Request):
    first = (full_path or "").split("/", 1)[0]
    if first in {"api", "docs", "redoc", "openapi.json", "health"}:
        raise HTTPException(status_code=404, detail="Not found")
    target = _safe_static_file(full_path)
    if target is not None:
        return FileResponse(target)
    if request.method == "HEAD":
        raise HTTPException(status_code=404, detail="Not found")
    return JSONResponse({"detail": "Not found"}, status_code=404)
