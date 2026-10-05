import ast
import json
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..excel_import import import_excel_bytes, read_xlsx
from ..import_jobs import spawn_import
from ..auth import require_admin
from ..export_utils import ExportFilters, _cell_value, build_export_meta, export_pdf, export_xlsx
from ..plant_import import parse_lab_analysis_excel

router = APIRouter(prefix="/analyses", tags=["analyses"])

ANALYSIS_META_FIELDS = [
    "id",
    "analysis_type",
    "scope",
    "date",
    "time",
    "electrolyzer",
    "position",
    "group_nr",
    "sub_plant",
]

# Identity columns that match the Access form for each scope (see frontend analysis-forms.ts).
ANALYSIS_IDENTITY_FIELDS: dict[str, list[str]] = {
    "total_plant": ["date", "time"],
    "sub_plant": ["sub_plant", "date", "time"],
    "electrolyzer": ["electrolyzer", "date", "time"],
    "group": ["group_nr", "date", "time"],
    "element": ["electrolyzer", "position", "date", "time"],
}

ANALYSIS_TYPES = [
    "anolyte",
    "catholyte",
    "chlorine_gas",
    "pure_brine",
    "demin_water",
    "hydrogen",
    "caustic_feed",
    "hcl",
]

# Display units from the Access forms. The entry screen uses a per-scope field
# list (frontend analysis-forms.ts); these are the shared units for /meta.
PARAMETER_UNITS: dict[str, dict[str, str]] = {
    "anolyte": {"NaCl": "g/l", "NaClO3": "g/l", "Na2SO4": "g/l", "NaOCl": "g/l", "HOCl": "g/l", "HCl": "g/l", "density_20C": "g/l", "temperature": "°C", "pH": "[/]"},
    "catholyte": {"make_up_water": "m³/h", "temperature": "°C", "NaOH": "wt.%", "NaCl": "ppm w", "NaClO3": "ppm w", "Na2SO4": "ppm w", "Fe": "ppm w"},
    "chlorine_gas": {"Cl2_CO2": "Vol.%", "restgas": "Vol.%", "O2": "Vol.%", "H2": "Vol.%", "N2": "Vol.%", "Br": "Vol. ppm"},
    "pure_brine": {
        "flow_rate": "m³/h", "temperature": "°C", "pH": "-", "density_20C": "g/l",
        "NaCl": "g/l", "NaClO3": "g/l", "Na2CO3": "g/l", "NaOH": "g/l", "Na2SO4": "g/l", "NaOCl": "g/l", "HCl": "g/l",
        "Ca+Mg": "ppb w", "Ba": "ppb w", "Sr": "ppb w", "Ni": "ppb w", "Fe": "ppb w", "Al": "ppb w",
        "SiO2": "ppb w", "I": "ppb w", "F": "ppb w", "Br": "ppb w", "Organics": "ppm w", "H2O2": "ppm w",
    },
    "demin_water": {"conductivity": "µS/cm", "Fe": "ppm w", "SiO2": "ppm w", "Cl": "ppm w", "O2_dissolved": "ppm w", "organics": "ppm w"},
    "hydrogen": {"H2": "vol. %", "O2": "ppm v"},
    "caustic_feed": {"flow_rate": "m³/h", "NaOH": "wt. %", "Fe": "ppm w", "temperature": "°C"},
    "hcl": {"flow_rate": "l/h", "HCl": "% w", "density": "g/l"},
}


def _parameters(item) -> dict:
    raw = getattr(item, "parameters", None)
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            try:
                parsed = ast.literal_eval(raw)
            except (TypeError, ValueError, SyntaxError):
                return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


# (storage_key, aliases, unit) — unit shown in Access as [unit] on the form.
AnalysisFieldDef = tuple[str, tuple[str, ...], str]


def _field(key: str, *aliases: str, unit: str = "") -> AnalysisFieldDef:
    return key, aliases, unit


def _export_header(key: str, unit: str | None = None) -> str:
    text = (unit or "").strip()
    if not text:
        return key
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1].strip()
    return f"{key} [{text}]" if text else key


def _anolyte_fields(plant: bool) -> list[AnalysisFieldDef]:
    suffix = "" if plant else " An"
    return [
        _field(f"NaCl{suffix}", *(["NaCl An"] if plant else ["NaCl"]), unit="g/l"),
        _field(f"NaClO3{suffix}", *(["NaClO3 An"] if plant else ["NaClO3"]), unit="g/l"),
        _field(f"Na2SO4{suffix}", *(["Na2SO4 An"] if plant else ["Na2SO4"]), unit="g/l"),
        _field(f"NaOCl{suffix}", *(["NaOCl An"] if plant else ["NaOCl"]), unit="g/l"),
        _field("HCl" if plant else "HCl An", *(["HCl An"] if plant else ["HCl"]), unit="g/l"),
        _field(
            "density at 20°" if plant else "density at 20° An",
            "Density at 20° An",
            "density at 20°",
            "density_20C",
            unit="g/l",
        ),
        _field(
            "temperature" if plant else "temperature An",
            *(["temperature An"] if plant else ["temperature"]),
            unit="°C",
        ),
        _field("pH" if plant else "pH An", *(["pH An"] if plant else ["pH"]), unit="/"),
    ]


def _catholyte_fields() -> list[AnalysisFieldDef]:
    return [
        _field("make-up water", "make_up_water", "make up water", unit="m³/h"),
        _field("temperature", unit="°C"),
        _field("NaOH", unit="wt.%"),
        _field("NaCl", unit="ppm w"),
        _field("NaClO3", unit="ppm w"),
        _field("Na2SO4", unit="ppm w"),
        _field("Fe", unit="ppm w"),
    ]


def _chlorine_fields(plant: bool) -> list[AnalysisFieldDef]:
    if plant:
        return [
            _field("Cl2 + CO2", "Cl2 + CO2 Cl", "Cl2_CO2", unit="Vol.%"),
            _field("Restgas", "restgas Cl", "restgas", unit="Vol.%"),
            _field("O2", "O2 Cl", unit="Vol.%"),
            _field("H2", "H2 Cl", unit="Vol.%"),
            _field("N2", "N2 Cl", unit="Vol.%"),
            _field("Br", "Br Cl", unit="Vol. ppm"),
        ]
    return [
        _field("Cl2 + CO2 Cl", "Cl2 + CO2", "Cl2_CO2", unit="Vol.%"),
        _field("restgas Cl", "Restgas", "restgas", unit="Vol.%"),
        _field("O2 Cl", "O2", unit="Vol.%"),
        _field("H2 Cl", "H2", unit="Vol.%"),
        _field("N2 Cl", "N2", unit="Vol.%"),
        _field("Br Cl", "Br", unit="Vol.%"),
    ]


def _brine_fields(plant: bool) -> list[AnalysisFieldDef]:
    salt = lambda name: name if plant else f"{name} Pb"
    salt_alias = lambda name: (f"{name} Pb",) if plant else (name,)
    return [
        _field("flow rate", "flow_rate", unit="m³/h"),
        _field("temperature", unit="°C"),
        _field("pH", unit="-"),
        _field("density at 20 °C", "density_20C", "density at 20°", "density at 20° An", unit="g/l"),
        _field(salt("NaCl"), *salt_alias("NaCl"), unit="g/l"),
        _field(salt("NaClO3"), *salt_alias("NaClO3"), unit="g/l"),
        _field(salt("Na2CO3"), *salt_alias("Na2CO3"), unit="g/l"),
        _field(salt("NaOH"), *salt_alias("NaOH"), unit="g/l"),
        _field(salt("Na2SO4"), *salt_alias("Na2SO4"), unit="g/l"),
        _field(salt("NaOCl"), *salt_alias("NaOCl"), "HOCl", unit="g/l"),
        _field(salt("HCl"), *salt_alias("HCl"), unit="g/l"),
        _field("Ca +Mg", "Ca+Mg", unit="ppb w"),
        _field("Ba", unit="ppb w"),
        _field("Sr", unit="ppb w"),
        _field("Ni", unit="ppb w"),
        _field("Fe", unit="ppb w"),
        _field("Al", unit="ppb w"),
        _field("SiO2", unit="ppb w"),
        _field("I", unit="ppb w"),
        _field("F", unit="ppb w"),
        _field("Br", unit="ppb w"),
        _field("Organics", "organics", unit="ppm w"),
        _field("H2O2", unit="ppm w"),
    ]


ANALYSIS_FORM_FIELDS: dict[tuple[str, str], list[AnalysisFieldDef]] = {}


def _register_analysis_form_fields() -> None:
    scopes = ("total_plant", "sub_plant", "electrolyzer", "group", "element")
    for scope in scopes:
        plant = scope == "total_plant"
        ANALYSIS_FORM_FIELDS[("anolyte", scope)] = _anolyte_fields(plant)
        ANALYSIS_FORM_FIELDS[("catholyte", scope)] = _catholyte_fields()
        ANALYSIS_FORM_FIELDS[("pure_brine", scope)] = _brine_fields(plant)
        ANALYSIS_FORM_FIELDS[("chlorine_gas", scope)] = _chlorine_fields(plant)
        # Element/group chlorine Br unit differs in Access (ppm vs Vol.%); keep Vol.% for plant, Vol.% for electrolyzer per UI.
    hydrogen = [_field("H2", unit="vol. %"), _field("O2", unit="ppm v")]
    demin = [
        _field("el  conductivity", "conductivity", "el conductivity", unit="µS/cm"),
        _field("Fe", unit="ppm w"),
        _field("SiO2", unit="ppm w"),
        _field("Cl minus", "Cl", unit="ppm w"),
        _field("Oxygen dissolved", "O2_dissolved", unit="ppm w"),
        _field("Organics", "organics", unit="ppm w"),
    ]
    caustic = [
        _field("flow rate", "flow_rate", unit="m³/h"),
        _field("NaOH", unit="wt. %"),
        _field("Fe", unit="ppm w"),
        _field("temperature", unit="°C"),
    ]
    hcl_flow = [_field("flow rate", "flow_rate", unit="l/h"), _field("HCl", unit="% w")]
    ANALYSIS_FORM_FIELDS[("hydrogen", "total_plant")] = hydrogen
    ANALYSIS_FORM_FIELDS[("demin_water", "total_plant")] = demin
    ANALYSIS_FORM_FIELDS[("caustic_feed", "total_plant")] = caustic
    ANALYSIS_FORM_FIELDS[("caustic_feed", "sub_plant")] = caustic
    ANALYSIS_FORM_FIELDS[("hcl", "total_plant")] = hcl_flow
    ANALYSIS_FORM_FIELDS[("hcl", "sub_plant")] = hcl_flow
    ANALYSIS_FORM_FIELDS[("hcl", "electrolyzer")] = [
        *hcl_flow,
        _field("Dichte", "density", "density_20C", unit="g/l"),
    ]


_register_analysis_form_fields()


def _normalize_scope(scope: str | None) -> str | None:
    if scope == "plant":
        return "total_plant"
    return scope


def _param_value(params: dict, key: str, aliases: tuple[str, ...] = ()) -> object:
    for name in (key, *aliases):
        if name in params and params[name] not in (None, ""):
            return params[name]
    return None


def flatten_analysis_export(
    items: list,
    analysis_type: str | None = None,
    scope: str | None = None,
) -> tuple[list[dict], list[str]]:
    """One Excel/PDF column per form identity field and per analysis parameter.

    Parameter headers include Access units, e.g. ``H2 [Vol.%]``, ``NaCl An [g/l]``.
    """
    scope = _normalize_scope(scope)
    catalog = ANALYSIS_FORM_FIELDS.get((analysis_type or "", scope or ""), [])
    identity = ANALYSIS_IDENTITY_FIELDS.get(
        scope or "", ["date", "time", "electrolyzer", "position", "group_nr", "sub_plant"]
    )

    if catalog:
        param_headers: list[str] = []
        key_to_header: dict[str, str] = {}
        for key, aliases, unit in catalog:
            header = _export_header(key, unit)
            param_headers.append(header)
            key_to_header[key] = header

        fields = ["id", "analysis_type", "scope", *identity, *param_headers]
        seen: set[str] = set()
        ordered: list[str] = []
        for field in fields:
            if field in seen:
                continue
            seen.add(field)
            ordered.append(field)
        fields = ordered

        rows: list[dict] = []
        for item in items:
            row: dict = {
                "id": _cell_value(getattr(item, "id", None)),
                "analysis_type": _cell_value(getattr(item, "analysis_type", None)),
                "scope": _cell_value(getattr(item, "scope", None)),
            }
            for field in identity:
                row[field] = _cell_value(getattr(item, field, None))
            params = _parameters(item)
            for key, aliases, _unit in catalog:
                header = key_to_header[key]
                value = _param_value(params, key, aliases)
                row[header] = _cell_value(value) if value is not None else None
            rows.append(row)
        return rows, fields

    # Unknown form: keep legacy wide export from whatever keys exist in the payload.
    extra_keys: list[str] = []
    seen_extra: set[str] = set()
    units_map = PARAMETER_UNITS.get(analysis_type or "", {})
    for item in items:
        for key in _parameters(item):
            name = str(key).strip()
            if not name or name.startswith("_") or name in seen_extra:
                continue
            seen_extra.add(name)
            extra_keys.append(name)
    extra_keys.sort(key=str.lower)
    headers = [_export_header(key, units_map.get(key) or units_map.get(key.replace(" ", "_"))) for key in extra_keys]
    fields = [*ANALYSIS_META_FIELDS, *headers]
    rows = []
    for item in items:
        row = {field: _cell_value(getattr(item, field, None)) for field in ANALYSIS_META_FIELDS}
        params = _parameters(item)
        for key, header in zip(extra_keys, headers):
            value = params.get(key)
            row[header] = _cell_value(value) if value is not None else None
        rows.append(row)
    return rows, fields


@router.get("/meta")
def analysis_meta():
    return {"types": ANALYSIS_TYPES, "parameter_units": PARAMETER_UNITS}


@router.post("/import-lab-excel")
async def import_lab_excel(_admin=Depends(require_admin), file: UploadFile = File(...)):
    """Import hierarchical LIMS / plant lab Excel (Caustic Train sample format)."""
    content = await file.read()
    parsed = parse_lab_analysis_excel(content)

    def work(db: Session, progress):
        samples = parsed.get("samples") or []
        total = len(samples)
        if progress:
            progress(0, total)
        created = 0
        for done, sample in enumerate(samples, start=1):
            dt = None
            if sample.get("date"):
                try:
                    dt = datetime.fromisoformat(sample["date"])
                except ValueError:
                    dt = None
            db.add(
                models.AnalysisSample(
                    analysis_type=sample["analysis_type"],
                    scope=sample.get("scope") or "sub_plant",
                    sub_plant=sample.get("sub_plant"),
                    date=dt,
                    time=sample.get("time"),
                    parameters=sample.get("parameters") or {},
                )
            )
            created += 1
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        db.commit()
        return {"imported_samples": created, "preview": samples[:3]}

    return spawn_import(work)


@router.get("", response_model=list[schemas.AnalysisSampleRead])
def list_analyses(
    analysis_type: str | None = None,
    scope: str | None = None,
    electrolyzer: str | None = None,
    skip: int = 0,
    limit: int = Query(default=500, le=5000),
    db: Session = Depends(get_db),
):
    query = db.query(models.AnalysisSample)
    if analysis_type:
        query = query.filter(models.AnalysisSample.analysis_type == analysis_type)
    if scope in ("plant", "total_plant"):
        query = query.filter(models.AnalysisSample.scope.in_(("plant", "total_plant")))
    elif scope:
        query = query.filter(models.AnalysisSample.scope == scope)
    if electrolyzer:
        query = query.filter(models.AnalysisSample.electrolyzer == electrolyzer)
    return query.order_by(models.AnalysisSample.date.desc()).offset(skip).limit(limit).all()


@router.get("/export.meta", include_in_schema=False)
def export_analyses_meta(
    analysis_type: str | None = None,
    scope: str | None = None,
    db: Session = Depends(get_db),
):
    scope = _normalize_scope(scope)
    # Catalog-driven even when this form has no rows yet.
    _, fields = flatten_analysis_export([], analysis_type=analysis_type, scope=scope)
    if not fields or (not analysis_type and not scope):
        items = list_analyses(analysis_type=analysis_type, scope=scope, limit=1, db=db)
        _, fields = flatten_analysis_export(items, analysis_type=analysis_type, scope=scope)
    if not fields:
        fields = ["date", "time", "analysis_type", "scope", "electrolyzer", "position"]
    return build_export_meta(fields)


@router.get("/export.xlsx", include_in_schema=False)
def export_analyses_xlsx(
    analysis_type: str | None = None,
    scope: str | None = None,
    electrolyzer: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_analyses(analysis_type=analysis_type, scope=scope, electrolyzer=electrolyzer, limit=20000, db=db)
    rows, fields = flatten_analysis_export(items, analysis_type=analysis_type, scope=scope)
    rows, fields = filters.apply(rows, fields)
    title = "-".join(part for part in ("analyses", analysis_type, scope) if part)
    return export_xlsx(rows, fields, title[:31] or "analyses")


@router.get("/export.pdf", include_in_schema=False)
def export_analyses_pdf(
    analysis_type: str | None = None,
    scope: str | None = None,
    electrolyzer: str | None = None,
    filters: ExportFilters = Depends(),
    db: Session = Depends(get_db),
):
    items = list_analyses(analysis_type=analysis_type, scope=scope, electrolyzer=electrolyzer, limit=2000, db=db)
    rows, fields = flatten_analysis_export(items, analysis_type=analysis_type, scope=scope)
    rows, fields = filters.apply(rows, fields)
    title = "-".join(part for part in ("analyses", analysis_type, scope) if part)
    return export_pdf(rows, fields, title[:31] or "analyses")


@router.post("/import.xlsx", include_in_schema=False)
async def import_analyses(_admin=Depends(require_admin), file: UploadFile = File(...)):
    content = await read_xlsx(file)
    return spawn_import(
        lambda db, progress: import_excel_bytes(
            db, models.AnalysisSample, schemas.AnalysisSampleBase, content, pk_field="id", progress=progress
        )
    )


@router.get("/{item_id}", response_model=schemas.AnalysisSampleRead)
def get_analysis(item_id: int, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    return obj


@router.post("", response_model=schemas.AnalysisSampleRead, status_code=201)
def create_analysis(payload: schemas.AnalysisSampleBase, db: Session = Depends(get_db)):
    obj = models.AnalysisSample(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.put("/{item_id}", response_model=schemas.AnalysisSampleRead)
def update_analysis(item_id: int, payload: schemas.AnalysisSampleBase, db: Session = Depends(get_db)):
    from fastapi import HTTPException

    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/{item_id}", status_code=204)
def delete_analysis(item_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.AnalysisSample).filter(models.AnalysisSample.id == item_id).first()
    if obj:
        db.delete(obj)
        db.commit()
    return None
