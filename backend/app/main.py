from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import inspect, text

from . import alerts_engine, arialims_sync_scheduler, audit, backup_scheduler, models, ticket_models, voltage_sync_scheduler, workflow_models  # noqa: F401
from .audit_middleware import AuditMiddleware
from .auth import INSPECTION_COLLAB_KEYS, require_any_form_access, require_form_access, seed_default_admin
from .cell_component_names import persist_industrial_names
from .inspection_reason_names import persist_industrial_reasons
from .config import settings
from .database import Base, SessionLocal, engine
from .paths import static_dir
from .routers import (
    activity as activity_router_module,
    activity_reports as activity_reports_router_module,
    analyses,
    arrangement_board as arrangement_board_router_module,
    assembly_inspections,
    field_options as field_options_router_module,
    group_overview as group_overview_router_module,
    auth as auth_router_module,
    backup as backup_router_module,
    components,
    config as config_router,
    data_transfer,
    database as database_router_module,
    db_tables,
    directory as directory_router_module,
    element_dashboard as element_dashboard_router_module,
    elements,
    imports as imports_router_module,
    uploads as uploads_router_module,
    inspections,
    logs as logs_router_module,
    maintenance_reports as maintenance_reports_router_module,
    monitoring as monitoring_router_module,
    relations as relations_router_module,
    remarks,
    reports,
    roles as roles_router_module,
    global_search,
    search,
    segregation,
    shutdowns,
    statistics,
    storage as storage_router_module,
    table_files as table_files_router_module,
    tickets as tickets_router_module,
    un_ce as un_ce_router_module,
    cathodic_ce as cathodic_ce_router_module,
    warehouse_lifecycle as warehouse_lifecycle_router_module,
    work_orders as work_orders_router_module,
    membrane_stock as membrane_stock_router_module,
    workflow as workflow_router_module,
    users as users_router_module,
    voltage,
    voltage_sync as voltage_sync_router_module,
    arialims_sync as arialims_sync_router_module,
)

Base.metadata.create_all(bind=engine)

from .table_files import register_builtin

register_builtin()


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
    "sign_insp_shift": "VARCHAR(1)",
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


def _ensure_cathodic_ce_columns() -> None:
    """create_all does not add columns to a table that already exists."""
    columns = {
        "sign_insp_name": "VARCHAR(150)",
        "sign_insp_image": "TEXT",
        "sign_insp_at": "VARCHAR(40)",
        "sign_proc_name": "VARCHAR(150)",
        "sign_proc_image": "TEXT",
        "sign_proc_at": "VARCHAR(40)",
    }
    try:
        present = {col["name"] for col in inspect(engine).get_columns("cathodic_ce_sheets")}
    except Exception:
        return
    missing = [name for name in columns if name not in present]
    if not missing:
        return
    with engine.begin() as conn:
        for name in missing:
            conn.execute(text(f"ALTER TABLE cathodic_ce_sheets ADD COLUMN {name} {columns[name]}"))


def _ensure_workflow_redesign() -> None:
    """Coating/purchase steps from the warehouse flow charts, plus columns create_all will not add."""
    alters = {
        "wf_coating_batches": {"excel_emailed_at": "DATETIME"},
        "wf_coating_packages": {"dispatch_date": "DATE", "expected_return_date": "DATE"},
        "wf_settings": {"planner_skills": "TEXT"},
        "wf_work_order_labors": {"kind": "VARCHAR(10) DEFAULT 'actual'", "data": "TEXT"},
    }
    try:
        tables = set(inspect(engine).get_table_names())
    except Exception:
        return
    with engine.begin() as conn:
        for table, columns in alters.items():
            if table not in tables:
                continue
            present = {col["name"] for col in inspect(engine).get_columns(table)}
            for name, ddl in columns.items():
                if name not in present:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        if "wf_coating_batches" in tables:
            conn.execute(text("UPDATE wf_coating_batches SET status = 'await_return' WHERE status IN ('at_coater', 'await_report')"))
            conn.execute(
                text(
                    "UPDATE wf_coating_packages SET dispatch_date = ("
                    "SELECT dispatch_date FROM wf_coating_batches b WHERE b.id = wf_coating_packages.batch_id"
                    ") WHERE dispatch_date IS NULL"
                )
            )
            conn.execute(
                text(
                    "UPDATE wf_coating_packages SET expected_return_date = ("
                    "SELECT expected_return_date FROM wf_coating_batches b WHERE b.id = wf_coating_packages.batch_id"
                    ") WHERE expected_return_date IS NULL"
                )
            )
        if "wf_cell_requests" in tables:
            present = {col["name"] for col in inspect(engine).get_columns("wf_cell_requests")}
            if "request_kind" not in present:
                conn.execute(text("ALTER TABLE wf_cell_requests ADD COLUMN request_kind VARCHAR(20) DEFAULT 'removal'"))
        if "wf_purchases" in tables:
            present = {col["name"] for col in inspect(engine).get_columns("wf_purchases")}
            if "decisions" not in present:
                conn.execute(text("ALTER TABLE wf_purchases ADD COLUMN decisions TEXT"))
            conn.execute(text("UPDATE wf_purchases SET status = 'await_registration' WHERE status = 'ordered' AND delivery_date IS NOT NULL"))
            conn.execute(text("DELETE FROM wf_planner_people WHERE skill LIKE '%?%'")) if "wf_planner_people" in tables else None
            conn.execute(text("UPDATE wf_purchases SET status = 'await_confirm_insp' WHERE status = 'await_confirm' AND decisions LIKE '%\"process\"%'"))
            conn.execute(text("UPDATE wf_purchases SET status = 'await_order' WHERE status = 'ordered' AND delivery_date IS NULL"))


_ensure_user_auth_source()
_ensure_user_role_id()
def _ensure_inspection_decision_column() -> None:
    """Parallel inspector / process decisions live on the inspection request."""
    try:
        present = {col["name"] for col in inspect(engine).get_columns("wf_inspection_requests")}
    except Exception:
        return
    if "decisions" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE wf_inspection_requests ADD COLUMN decisions TEXT"))


_ensure_inspection_sheet_columns()
_ensure_inspection_decision_column()
_ensure_cathodic_ce_columns()
_ensure_workflow_redesign()


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


def _ensure_plant_settings_electricity_price() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("plant_settings")}
    except Exception:
        return
    if "electricity_price_per_kw" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE plant_settings ADD COLUMN electricity_price_per_kw FLOAT"))


_ensure_plant_settings_electricity_price()


def _ensure_user_last_seen() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("users")}
    except Exception:
        return
    if "last_seen_at" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN last_seen_at DATETIME"))


_ensure_user_last_seen()


def _ensure_element_dashboard_queue_days() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("element_dashboard_settings")}
    except Exception:
        return
    if not present or "shop_queue_days" in present:
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE element_dashboard_settings ADD COLUMN shop_queue_days INTEGER"))


_ensure_element_dashboard_queue_days()


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


def _ensure_shutdown_trip_columns() -> None:
    try:
        present = {col["name"] for col in inspect(engine).get_columns("shutdowns")}
    except Exception:
        return
    for name in ("ka_before_trip", "lost_load", "lost_production", "mtbf_days"):
        if name in present:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE shutdowns ADD COLUMN {name} FLOAT"))
        present.add(name)


_ensure_shutdown_trip_columns()


def _ensure_coating_warranty_columns() -> None:
    for table, cols in (
        (
            "wf_coating_batches",
            {
                "warranty_months": "INTEGER",
                "warranty_start": "DATE",
            },
        ),
        (
            "anode_recoating",
            {
                "warranty_months": "INTEGER",
                "warranty_start": "DATE",
                "prior_service_days": "INTEGER",
            },
        ),
        (
            "cathode_recoating",
            {
                "warranty_months": "INTEGER",
                "warranty_start": "DATE",
                "prior_service_days": "INTEGER",
            },
        ),
        (
            "wf_purchases",
            {
                "warranty_months": "INTEGER",
                "warranty_start": "DATE",
            },
        ),
    ):
        try:
            present = {col["name"] for col in inspect(engine).get_columns(table)}
        except Exception:
            continue
        for name, sql_type in cols.items():
            if name in present:
                continue
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))


_ensure_coating_warranty_columns()


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
    models.AriaLimsSyncSettings.__table__.create(bind=engine, checkfirst=True)
    models.AriaLimsSamplingPoint.__table__.create(bind=engine, checkfirst=True)
    present = {col["name"] for col in inspect(engine).get_columns("arialims_sync_settings")}
    additions = {
        "start_mode": "VARCHAR(20) DEFAULT 'lookback'",
        "start_date": "DATE",
        "end_mode": "VARCHAR(20) DEFAULT 'auto'",
        "end_date": "DATE",
        "last_success_at": "TIMESTAMP" if engine.dialect.name == "postgresql" else "DATETIME",
    }
    for name, sql_type in additions.items():
        if name in present:
            continue
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE arialims_sync_settings ADD COLUMN {name} {sql_type}"))
            if name == "last_success_at":
                conn.execute(
                    text("UPDATE arialims_sync_settings SET last_success_at = last_run_at WHERE last_run_status = 'success'")
                )


_ensure_arialims_sync_table()


def _ensure_assembly_inspection_columns() -> None:
    insp = inspect(engine)
    if "assembly_inspection_reports" not in insp.get_table_names():
        return
    present = {col["name"] for col in insp.get_columns("assembly_inspection_reports")}
    columns = {
        "check_remarks": "JSON",
        "sign_insp_shift": "VARCHAR(1)",
    }
    missing = [name for name in columns if name not in present]
    if not missing:
        return
    with engine.begin() as conn:
        for name in missing:
            conn.execute(text(f"ALTER TABLE assembly_inspection_reports ADD COLUMN {name} {columns[name]}"))


_ensure_assembly_inspection_columns()

with SessionLocal() as _db:
    seed_default_admin(_db)
    alerts_engine.ensure_default_rules(_db)
    persist_industrial_names(_db)
    persist_industrial_reasons(_db)
    try:
        from .routers.field_options import seed_field_options

        seed_field_options(_db)
    except Exception:  # noqa: BLE001
        _db.rollback()
    try:
        from . import arialims_sync as _arialims_sync

        _arialims_sync.get_or_create_settings(_db)  # default URL + bundled sample points
        from .plant_import import apply_bundled_membrane_use

        apply_bundled_membrane_use(_db)
    except Exception:  # noqa: BLE001
        _db.rollback()

from starlette.formparsers import MultiPartParser

# Starlette 0.41 defaults both of these to 1 MB. File parts spool to disk after
# max_file_size, but a reverse proxy / incomplete multipart still needs headroom.
MultiPartParser.max_file_size = 64 * 1024 * 1024
MultiPartParser.max_part_size = 512 * 1024 * 1024

app = FastAPI(title="Arvand Cell Management", version="1.10")

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


@app.exception_handler(Exception)
async def _unhandled_error(request: Request, exc: Exception):
    """Return unexpected errors as JSON *with* CORS headers.

    Without this the browser hides a 500 behind a generic "Network Error"
    (error responses produced outside CORSMiddleware carry no CORS headers).
    """
    import logging

    logging.getLogger("uvicorn.error").exception("Unhandled error on %s", request.url.path, exc_info=exc)
    headers = {}
    origin = request.headers.get("origin")
    if origin:
        headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Vary": "Origin"}
    return JSONResponse(
        {"detail": f"Server error: {type(exc).__name__}: {str(exc)[:300]}"},
        status_code=500,
        headers=headers,
    )


def _perm(form_key: str) -> list[Depends]:
    return [Depends(require_form_access(form_key))]


def _api(router, **kwargs):
    """Mount a router under /api so page URLs like /cathodes never collide with REST."""
    extra_prefix = kwargs.pop("prefix", "")
    app.include_router(router, prefix="/api" + extra_prefix, **kwargs)


# --- Auth & Users (auth is public; users/roles/logs are admin-only in their routers) ---
_api(auth_router_module.router)
_api(imports_router_module.router)
_api(uploads_router_module.router)
_api(users_router_module.router)
_api(roles_router_module.router)
_api(logs_router_module.router)
# Who did what, per day / week / month (granted per role via the "activity" form key).
_api(activity_router_module.router, dependencies=_perm("activity"))
_api(activity_reports_router_module.router, dependencies=_perm("activity"))

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
_api(
    group_overview_router_module.router,
    dependencies=[Depends(require_any_form_access("elements", "settings"))],
)
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

# --- Dropdown values for data-entry fields (anode/cathode/membrane details, Assembly Data) ---
_api(
    field_options_router_module.router,
    dependencies=[Depends(require_any_form_access("elements", "anodes", "cathodes", "membranes", "settings"))],
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
_api(un_ce_router_module.router, dependencies=_perm("voltage"))
_api(cathodic_ce_router_module.router, dependencies=_perm("voltage"))

# --- Lagerbestand (Access: frmLagerbestandAnoden/Kathoden/Membranen) ---
_api(storage_router_module.router)
_api(warehouse_lifecycle_router_module.router)
# Recoating / new-purchase workflows: access is checked per step against the wf_* group keys.
_api(workflow_router_module.router)
_api(membrane_stock_router_module.router)
_api(work_orders_router_module.router)

# --- Analyses ---
_api(analyses.router, dependencies=_perm("analyses"))

# --- Remarks / search / statistics (statistics has per-route dashboard/statistics deps) ---
_api(remarks.router, dependencies=_perm("remarks"))
_api(remarks.performance_tests_router, dependencies=_perm("voltage"))
_api(global_search.router, dependencies=_perm("search"))  # before search.router: /search/global
_api(search.router, dependencies=_perm("search"))
_api(statistics.router)

# --- Reports & data analysis (replaces the old AI insights module) ---
_api(reports.router, dependencies=_perm("reports"))

# --- Import / export ---
_api(data_transfer.router)
_api(table_files_router_module.router)

# --- All 126 Access database tables (read-only archive) ---
_api(db_tables.router)

# --- Automatic / manual backup ---
_api(backup_router_module.router, dependencies=_perm("settings"))
_api(voltage_sync_router_module.router, dependencies=_perm("settings"))
_api(arialims_sync_router_module.router, dependencies=_perm("settings"))
# Monitoring uses voltage access (or admin); form_key "monitoring" is for finer grants in Users.
_api(monitoring_router_module.router, dependencies=_perm("voltage"))
# Element management dashboard: anyone who may see elements, anodes, cathodes, membranes or the warehouse.
_api(
    element_dashboard_router_module.router,
    dependencies=[Depends(require_any_form_access("elements", "anodes", "cathodes", "membranes", "storage"))],
)

# --- Tickets: every signed-in user (any role) can message users / roles, attach files, send forms ---
_api(tickets_router_module.router)

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
