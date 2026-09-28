from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import inspect, text

from . import alerts_engine, backup_scheduler, models, voltage_sync_scheduler
from .auth import require_form_access, seed_default_admin
from .config import settings
from .database import Base, SessionLocal, engine
from .paths import static_dir
from .routers import (
    analyses,
    auth as auth_router_module,
    backup as backup_router_module,
    components,
    config as config_router,
    data_transfer,
    database as database_router_module,
    db_tables,
    directory as directory_router_module,
    elements,
    inspections,
    monitoring as monitoring_router_module,
    remarks,
    reports,
    roles as roles_router_module,
    search,
    segregation,
    shutdowns,
    statistics,
    storage as storage_router_module,
    users as users_router_module,
    voltage,
    voltage_sync as voltage_sync_router_module,
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


_ensure_user_auth_source()
_ensure_user_role_id()

with SessionLocal() as _db:
    seed_default_admin(_db)
    alerts_engine.ensure_default_rules(_db)

app = FastAPI(title="PVC Arvand - Electrolyzer Management System", version="1.0.0")


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


@app.on_event("shutdown")
def _stop_schedulers() -> None:
    backup_scheduler.shutdown_scheduler()
    voltage_sync_scheduler.shutdown_scheduler()

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


def _perm(form_key: str) -> list[Depends]:
    return [Depends(require_form_access(form_key))]


def _api(router, **kwargs):
    """Mount a router under /api so page URLs like /cathodes never collide with REST."""
    extra_prefix = kwargs.pop("prefix", "")
    app.include_router(router, prefix="/api" + extra_prefix, **kwargs)


# --- Auth & Users (auth is public; users/roles are admin-only, enforced in their routers) ---
_api(auth_router_module.router)
_api(users_router_module.router)
_api(roles_router_module.router)

# --- Plant configuration / settings ---
_api(config_router.electrolyzers_router, dependencies=_perm("settings"))
_api(config_router.sub_plants_router, dependencies=_perm("settings"))
_api(config_router.full_plants_router, dependencies=_perm("settings"))
_api(config_router.rectifiers_router, dependencies=_perm("settings"))
_api(config_router.transformers_router, dependencies=_perm("settings"))
_api(config_router.arrangements_router, dependencies=_perm("settings"))
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
_api(elements.cell_components_router, dependencies=_perm("settings"))

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

# --- TAFKIK electrode segregation (shared anode/cathode workshop decisions) ---
_api(segregation.router, dependencies=_perm("anodes"))

# --- Inspections ---
_api(inspections.router, dependencies=_perm("inspections"))
_api(inspections.grids_router, dependencies=_perm("inspections"))

# --- Shutdowns ---
_api(shutdowns.router, dependencies=_perm("shutdowns"))
_api(shutdowns.categories_router, dependencies=_perm("shutdowns"))
_api(shutdowns.causes_router, dependencies=_perm("shutdowns"))
_api(shutdowns.summary_router, dependencies=_perm("shutdowns"))

# --- Voltage / standardized voltage / current efficiency ---
_api(voltage.normalizations_router, dependencies=_perm("voltage"))
_api(voltage.readings_router, dependencies=_perm("voltage"))
_api(voltage.calc_router, dependencies=_perm("voltage"))
_api(voltage.current_efficiency_router, dependencies=_perm("voltage"))
_api(voltage.ce_calc_router, dependencies=_perm("voltage"))

# --- Lagerbestand (Access: frmLagerbestandAnoden/Kathoden/Membranen) ---
_api(storage_router_module.router)

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
