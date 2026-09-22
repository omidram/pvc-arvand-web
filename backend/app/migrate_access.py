"""
Migrates real plant data out of the original Uhde Administrator Access
database into the new normalized SQLite schema.

Of the 322 raw tables in the .mdb file, most are either:
  - Access-internal UI/query state (e.g. tblGewDaten, tblMontagedatenFormat)
  - Duplicated staging/import tables (tblImport*, tlbImportMontage)
  - Corrupted-import artifacts (200+ "Rapport$_ImportErrors*", "Paste Errors",
    "Conversion Errors", "Einfuegefehler")
  - Legacy per-cell wide-format voltage import dumps with ambiguous column
    headers (tblEingeleseneUElemente / *3 / *4 / *Alt) - preserved nowhere
    because the column meaning cannot be reconstructed reliably.

This script migrates every table that holds genuine, unambiguous plant data.
Run it with the backend venv active:

    python -m app.migrate_access
"""
from __future__ import annotations

import decimal
from datetime import date, datetime

try:
    import pyodbc
except ImportError:  # pragma: no cover - optional on Linux/Docker images
    pyodbc = None  # type: ignore[assignment]

from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import Base, SessionLocal, engine


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def get_access_connection(db_path: str | None = None):
    if pyodbc is None:
        raise RuntimeError(
            "Access (.mdb) import requires pyodbc and the Microsoft Access ODBC driver. "
            "This is available on Windows workstations; use Excel import on the Docker/Linux server."
        )
    # Text columns in this .mdb are Unicode (SQL_WCHAR) and contain a mix of
    # German and Farsi text. pyodbc's default decoding already handles this
    # correctly (native UTF-16LE); forcing cp1252 here would mangle any
    # non-Latin-1 (e.g. Farsi) characters into '?'. Only override SQL_CHAR,
    # in case any legacy ANSI byte columns exist, and leave SQL_WCHAR alone.
    conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + (db_path or settings.ACCESS_DB_PATH)
    conn = pyodbc.connect(conn_str)
    conn.setdecoding(pyodbc.SQL_CHAR, encoding="cp1252")
    return conn


def fetch_rows(cursor: pyodbc.Cursor, table: str) -> list[dict]:
    cursor.execute(f"SELECT * FROM [{table}]")
    cols = [c[0] for c in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def to_date(v):
    if v is None:
        return None
    return v.date() if hasattr(v, "date") else v


def to_str(v):
    if v is None or v == "":
        return None
    if isinstance(v, decimal.Decimal):
        v = float(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def to_int(v):
    if v in (None, ""):
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def to_float(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def to_bool(v):
    return bool(v) if v is not None else False


def jsonable(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, bytes):
        return None
    return v


# --------------------------------------------------------------------------
# Plant configuration / lookups
# --------------------------------------------------------------------------

def migrate_lookups(cur, db: Session):
    for r in fetch_rows(cur, "tblElektrolyseurbezeichnung"):
        db.merge(models.Electrolyzer(nr=to_int(r["Nr"]), name=to_str(r.get("Bezeichnung"))))
    for r in fetch_rows(cur, "tblTeilanlagenbezeichnung"):
        db.merge(models.SubPlant(nr=to_int(r["Nr"]), name=to_str(r.get("Bezeichnung"))))
    for r in fetch_rows(cur, "tblGesamtanlagenbezeichnung"):
        db.merge(models.FullPlant(id=to_int(r["ID"]), language_id=to_int(r.get("IDSprache")), name=to_str(r.get("Bezeichnung"))))
    for r in fetch_rows(cur, "tblGleichrichterbezeichnung"):
        db.merge(models.Rectifier(nr=to_int(r["Nr"]), name=to_str(r.get("Bezeichnung"))))
    for r in fetch_rows(cur, "tblTransformatorbezeichnung"):
        db.merge(models.Transformer(nr=to_int(r["Nr"]), name=to_str(r.get("Bezeichnung"))))
    for r in fetch_rows(cur, "tblElektrolyseuranordnung"):
        db.add(
            models.ElectrolyzerArrangement(
                name=to_str(r.get("Bezeichnung")),
                sub_plant=to_str(r.get("Teilanlage")),
                transformer=to_str(r.get("Transformator")),
                rectifier=to_str(r.get("Gleichrichter")),
                block=to_str(r.get("Block")),
                start_position=to_str(r.get("Anfangsposition")),
                end_position=to_str(r.get("Endposition")),
            )
        )
    for r in fetch_rows(cur, "tblReserveplaetze"):
        db.add(models.ReservePosition(position=to_str(r.get("Position"))))
    db.commit()
    print("  lookups migrated")


def migrate_settings(cur, db: Session):
    rows = fetch_rows(cur, "tblBasisdaten")
    for r in rows:
        plant_type_raw = to_int(r.get("Anlagentyp"))
        db.add(
            models.PlantSettings(
                customer=to_str(r.get("Kunde")),
                uan=to_str(r.get("UAN")),
                version=to_str(r.get("Version")),
                plant_type_raw=plant_type_raw,
                plant_type="KOH" if plant_type_raw == 1 else "NaOH",
                date=r.get("Datum"),
            )
        )
    for r in fetch_rows(cur, "tblUnKorrekturfaktoren"):
        db.add(
            models.CorrectionFactor(
                reference_current_density=to_float(r.get("iRef")),
                temp_correction=to_float(r.get("tKorrektur")),
                conc_correction=to_float(r.get("cKorrektur")),
            )
        )
    for r in fetch_rows(cur, "tblElementflaeche"):
        db.add(models.ElectrodeArea(area_m2=to_float(r.get("Flaeche"))))
    for r in fetch_rows(cur, "tblKlassenVerteilungUnElemente"):
        db.add(
            models.VoltageDistributionClass(
                lower_bound=to_float(r.get("Untergrenze")),
                upper_bound=to_float(r.get("Obergrenze")),
                label=to_str(r.get("Klasse")),
            )
        )
    for r in fetch_rows(cur, "tblBemerkungen"):
        db.add(models.Remark(date=r.get("Datum"), text=to_str(r.get("Bemerkung"))))
    db.commit()
    print("  settings migrated")


# --------------------------------------------------------------------------
# Element administration (core module)
# --------------------------------------------------------------------------

def migrate_elements(cur, db: Session):
    rows = fetch_rows(cur, "Montage")
    for r in rows:
        db.add(
            models.Element(
                element_nr=to_str(r.get("Element Nr")),
                electrolyzer=to_str(r.get("Elektrolyseur")),
                position=to_str(r.get("Position")),
                group_nr=to_str(r.get("Gruppe")),
                generation=to_str(r.get("Generation")),
                anode_nr=to_str(r.get("Anoden Nr")),
                cathode_nr=to_str(r.get("Kathoden Nr")),
                membrane_nr=to_str(r.get("Membran Nr")),
                membrane_type=to_str(r.get("Membrantyp")),
                gap_mm=to_str(r.get("Elektroden Abstand")),
                assembly_date=to_date(r.get("Montage Datum")),
                commissioning_date=to_date(r.get("Einschalt Datum")),
                decommissioning_date=to_date(r.get("Ausschalt Datum")),
                disassembly_date=to_date(r.get("Demontage Datum")),
                dol_days=to_int(r.get("DOL")),
                decommission_reason=to_str(r.get("Abschaltgrund")),
                ispb=to_str(r.get("ISPB")),
                anode_coating=to_str(r.get("Anode Coating")),
                anode_electrode=to_str(r.get("Anode Electrode")),
                anode_shell=to_str(r.get("Anode Shell")),
                cathode_coating=to_str(r.get("Cathode Coating")),
                cathode_electrode=to_str(r.get("Cathode Electrode")),
                cathode_shell=to_str(r.get("Cathode Shell")),
                membrane_info=to_str(r.get("Info Membrane")),
                remarks=to_str(r.get("Remarks")),
            )
        )
    db.commit()
    print(f"  {len(rows)} elements (assembly data) migrated")

    for r in fetch_rows(cur, "Gruppenmerkmale"):
        group_nr = to_str(r.get("Gruppe"))
        if not group_nr:
            continue
        db.merge(
            models.GroupDefinition(
                group_nr=group_nr,
                anode_coating=to_str(r.get("Anodencoating")),
                cathode_coating=to_str(r.get("Kathodencoating")),
                membrane_type=to_str(r.get("Membrantyp")),
                gap_mm=to_str(r.get("Elektrodenabstand")),
                remarks=to_str(r.get("Bemerkungen")),
            )
        )
    for r in fetch_rows(cur, "tblInspektionsgruende"):
        db.add(
            models.InspectionReason(
                language_id=to_int(r.get("IDSprache")),
                code=to_str(r.get("Code")),
                reason=to_str(r.get("Inspektionsgrund")),
                selected=to_bool(r.get("Gewaehlt")),
                count=to_int(r.get("Anzahl")),
            )
        )
    for r in fetch_rows(cur, "tblInspektionsberichtBefunde"):
        db.add(
            models.InspectionFinding(
                language_id=to_int(r.get("IDSprache")),
                code=to_str(r.get("Code")),
                text=to_str(r.get("Inspektionsgrund")),
                selected=to_bool(r.get("Gewaehlt")),
                count=to_int(r.get("Anzahl")),
            )
        )
    for r in fetch_rows(cur, "Einzelteile"):
        db.add(
            models.CellComponent(
                part_nr=to_str(r.get("Teil Nr")),
                name=to_str(r.get("Benennung")),
                drawing_nr=to_str(r.get("Zeichnungs Nr")),
                revision=to_str(r.get("Revision")),
                parts_per_element=to_float(r.get("Teile pro Element")),
                element_count=to_float(r.get("Elementzahl")),
                total_parts=to_float(r.get("Summe Einzelteile")),
                reserve_index=to_float(r.get("Reserve Index")),
            )
        )
    db.commit()
    print("  group definitions, inspection reasons/findings, cell components migrated")


def migrate_inspections(cur, db: Session):
    rows = fetch_rows(cur, "tblInspektionsbericht")
    for r in rows:
        db.add(
            models.InspectionReport(
                element_nr=to_str(r.get("Element Nr")),
                inspection_reason=to_str(r.get("Inspektionsgrund")),
                blister_anode_area=to_str(r.get("BlisterAnodenflaeche")),
                blister_periphery_top=to_str(r.get("BlisterPeripherieOben")),
                blister_periphery_bottom=to_str(r.get("BlisterPeripherieUnten")),
                blister_periphery_side=to_str(r.get("BlisterPeripherieSeite")),
                blister_corners=to_str(r.get("BlisterEcken")),
                folds=to_str(r.get("Falten")),
                pressure_marks=to_str(r.get("Druckstellen")),
                visible_holes=to_str(r.get("SichtbareLoecher")),
                cracks=to_str(r.get("Risse")),
                blister_remarks=to_str(r.get("BlisterBemerkungen")),
                sample_cathode=to_bool(r.get("ProbeKathode")),
                sample_anode=to_bool(r.get("ProbeAnode")),
                sample_membrane=to_bool(r.get("ProbeMembran")),
                anode_tube_ok=to_bool(r.get("EinsteckrohrAnodeOK")),
                anode_tube_remark=to_str(r.get("EinsteckrohrAnodeBemerkung")),
                cathode_tube_ok=to_bool(r.get("EinsteckrohrKathodeOK")),
                cathode_tube_remark=to_str(r.get("EinsteckrohrKathodeBemerkung")),
                anode_spacer_ok=to_bool(r.get("DistanzsteifenAnodeOK")),
                anode_spacer_remark=to_str(r.get("DistanzstreifenAnodeBemerkung")),
                cathode_spacer_ok=to_bool(r.get("DistanzstreifenKathodeOK")),
                cathode_spacer_remark=to_str(r.get("DistanzstreifenKathodeBemerkung")),
                frame_gasket_ok=to_bool(r.get("RahmendichtungOK")),
                frame_gasket_remark=to_str(r.get("RahmendichtungBemerkung")),
                inspector_name=to_str(r.get("Name")),
                inspection_date=r.get("Date"),
                general_remarks=to_str(r.get("BemerkungenInspektionsbericht")),
            )
        )
    db.commit()
    print(f"  {len(rows)} inspection reports migrated")


# --------------------------------------------------------------------------
# Anodes / Cathodes / Membranes
# --------------------------------------------------------------------------

def migrate_components(cur, db: Session):
    for r in fetch_rows(cur, "tblAnodendetails"):
        nr = to_str(r.get("Anodennummer"))
        if not nr:
            continue
        db.merge(
            models.Anode(
                anode_nr=nr,
                assembly_group=to_str(r.get("Baugruppe")),
                component_nr=to_str(r.get("Bauteil Nr")),
                customer_drawing_nr=to_str(r.get("U Zeichnungs Nr")),
                manufacturer=to_str(r.get("Hersteller")),
                manufacturer_order_nr=to_str(r.get("H Auftrags Nr")),
                manufacturer_drawing_nr=to_str(r.get("H Zeichnungs Nr")),
                manufacturer_date=r.get("H Datum"),
                tank=to_str(r.get("Wanne")),
                contact_strip=to_str(r.get("Kontaktstreifen")),
                electrode_support=to_str(r.get("Elektrodenunterst\u00fctzung")),
                electrode_shape=to_str(r.get("Elektrodenform")),
                coating=to_str(r.get("Coating")),
                baffle_plate=to_str(r.get("Baffleplate")),
                downcomer=to_str(r.get("Downcomer")),
                inlet_system=to_str(r.get("Einlaufsystem")),
                standpipe_diameter=to_str(r.get("Standrohr Di")),
                flange_width=to_str(r.get("Flanschbreite")),
                received_date=r.get("Eingangsdatum"),
                remarks=to_str(r.get("Bemerkung")),
                decommission_date=r.get("Stillegungsdatum"),
                batch=to_str(r.get("Batch")),
                generation=to_str(r.get("Generation")),
            )
        )
    for r in fetch_rows(cur, "tblKathodendetails"):
        nr = to_str(r.get("Kathodennummer"))
        if not nr:
            continue
        db.merge(
            models.Cathode(
                cathode_nr=nr,
                assembly_group=to_str(r.get("Baugruppe")),
                component_nr=to_str(r.get("Bauteil Nr")),
                customer_drawing_nr=to_str(r.get("U Zeichnungs Nr")),
                manufacturer=to_str(r.get("Hersteller")),
                manufacturer_order_nr=to_str(r.get("H Auftrags Nr")),
                manufacturer_drawing_nr=to_str(r.get("H Zeichnungs Nr")),
                manufacturer_date=r.get("H Datum"),
                tank=to_str(r.get("Wanne")),
                contact_strip=to_str(r.get("Kontaktstreifen")),
                electrode_support=to_str(r.get("Elektrodenunterst\u00fctzung")),
                electrode_shape=to_str(r.get("Elektrodenform")),
                coating=to_str(r.get("Coating")),
                inlet_system=to_str(r.get("Einlaufsystem")),
                standpipe_diameter=to_str(r.get("Standrohr Di")),
                flange_width=to_str(r.get("Flanschbreite")),
                received_date=r.get("Eingangsdatum"),
                remarks=to_str(r.get("Bemerkung")),
                decommission_date=r.get("Stillegungsdatum"),
                batch=to_str(r.get("Batch")),
                generation=to_str(r.get("Generation")),
            )
        )
    for r in fetch_rows(cur, "tblMembrandetails"):
        nr = to_str(r.get("Membrannummer"))
        if not nr:
            continue
        db.merge(
            models.Membrane(
                membrane_nr=nr,
                membrane_type=to_str(r.get("Membrantyp")),
                received_date=r.get("Eingangsdatum"),
                remarks=to_str(r.get("Bemerkung")),
                decommission_date=r.get("Stillegungsdatum"),
                batch=to_str(r.get("Batch")),
            )
        )
    db.commit()

    for r in fetch_rows(cur, "tblAnodeninstandhaltung"):
        db.add(
            models.AnodeMaintenance(
                anode_nr=to_str(r.get("Anoden Nr")),
                date=r.get("Datum"),
                finding=to_str(r.get("Befund")),
                action=to_str(r.get("Aktion")),
                dispatch_date=r.get("Versanddatum"),
                return_date=r.get("R\u00fccklieferung"),
            )
        )
    for r in fetch_rows(cur, "tblKathodeninstandhaltung"):
        db.add(
            models.CathodeMaintenance(
                cathode_nr=to_str(r.get("Kathoden Nr")),
                date=r.get("Datum"),
                finding=to_str(r.get("Befund")),
                action=to_str(r.get("Aktion")),
                dispatch_date=r.get("Versanddatum"),
                return_date=r.get("R\u00fccklieferung"),
            )
        )
    for r in fetch_rows(cur, "tblMembraninstandhaltung"):
        db.add(
            models.MembraneMaintenance(
                membrane_nr=to_str(r.get("Membrannummer")),
                date=r.get("Reparaturdatum"),
                repair_work=to_str(r.get("Reparatur")),
            )
        )
    for r in fetch_rows(cur, "tblAnodenrecoating"):
        db.add(
            models.AnodeRecoating(
                anode_nr=to_str(r.get("Anodennummer")),
                coating_nr=to_str(r.get("Anodencoatingnummer")),
                dispatch_date=r.get("Versanddatum"),
                return_date=r.get("R\u00fccklieferdatum"),
                manufacturer=to_str(r.get("Hersteller")),
                recoating_number=to_str(r.get("x-tes Recoating")),
                remarks=to_str(r.get("Bemerkung")),
            )
        )
    for r in fetch_rows(cur, "tblKathodenrecoating"):
        db.add(
            models.CathodeRecoating(
                cathode_nr=to_str(r.get("Kathodennummer")),
                dispatch_date=r.get("Versanddatum"),
                return_date=r.get("R\u00fccklieferdatum"),
                manufacturer=to_str(r.get("Hersteller")),
                remarks=to_str(r.get("Bemerkung")),
            )
        )
    for r in fetch_rows(cur, "tblAnodencoatingpruefung"):
        db.add(
            models.AnodeCoatingCheck(
                anode_nr=to_str(r.get("Anodennummer")),
                coating_nr=to_str(r.get("Anodencoatingnummer")),
                dol_days=to_int(r.get("DOL")),
                check_date=r.get("Pr\u00fcfdatum"),
                inspector=to_str(r.get("Pr\u00fcfer")),
                residual_thickness=to_float(r.get("Restschichtdicke")),
                potential=to_float(r.get("Potential")),
                remarks=to_str(r.get("Bemerkung")),
            )
        )
    for r in fetch_rows(cur, "tblKathodencoatingpruefung"):
        db.add(
            models.CathodeCoatingCheck(
                cathode_nr=to_str(r.get("Kathodennummer")),
                check_date=r.get("Pr\u00fcfdatum"),
                inspector=to_str(r.get("Pr\u00fcfer")),
                residual_thickness=to_float(r.get("Restschichtdicke")),
                potential=to_float(r.get("Potential")),
                remarks=to_str(r.get("Bemerkung")),
            )
        )
    db.commit()
    print("  anodes, cathodes, membranes + maintenance/recoating/coating-checks migrated")


# --------------------------------------------------------------------------
# Shutdowns
# --------------------------------------------------------------------------

def migrate_shutdowns(cur, db: Session):
    for r in fetch_rows(cur, "tblAbschaltungskategorien"):
        db.add(models.ShutdownCategory(category=to_str(r.get("Kategorie"))))
    for r in fetch_rows(cur, "tblAbschaltungsursachen"):
        db.add(
            models.ShutdownCause(
                language_id=to_int(r.get("IDSprache")),
                code=to_str(r.get("Code")),
                cause=to_str(r.get("Abschaltungsursache")),
                category=to_str(r.get("Kategorie")),
            )
        )
    rows = fetch_rows(cur, "tblAbschaltungen")
    for r in rows:
        db.add(
            models.Shutdown(
                plant_part=to_str(r.get("Anlagenteil")),
                shutdown_time=r.get("Abschaltzeitpunkt"),
                startup_time=r.get("Einschaltzeitpunkt"),
                remarks=to_str(r.get("Bemerkung")),
                code=to_str(r.get("Code")),
                category=to_str(r.get("Kategorie")),
                cause=to_str(r.get("Ursache")),
            )
        )
    db.commit()
    print(f"  {len(rows)} shutdowns migrated")


# --------------------------------------------------------------------------
# Voltage / Current efficiency
# --------------------------------------------------------------------------

def migrate_voltage(cur, db: Session):
    rows = fetch_rows(cur, "NormElek")
    for r in rows:
        db.add(
            models.ElectrolyzerNormalization(
                normalization_nr=to_int(r.get("Normierung")),
                electrolyzer=to_str(r.get("Elektrolyseur")),
                date=r.get("Datum"),
                time=to_str(r.get("Zeit")),
                total_current=to_float(r.get("I Gesamt")),
                reference_current_density=to_float(r.get("Cc")),
                anolyte_temp=to_float(r.get("t An")),
                catholyte_temp=to_float(r.get("t Ka")),
                zero_voltage=to_float(r.get("Uo")),
                total_voltage=to_float(r.get("U Gesamt")),
                element_count=to_int(r.get("Elementzahl")),
                cl2_pct=to_float(r.get("Cl2")),
                h2_pct=to_float(r.get("H2")),
                delta_p=to_float(r.get("delta P")),
            )
        )
    print(f"  {len(rows)} electrolyzer normalization batches migrated")

    rows = fetch_rows(cur, "Spannungen")
    for r in rows:
        db.add(
            models.VoltageReading(
                normalization_nr=to_int(r.get("Normierung")),
                electrolyzer=to_str(r.get("Elektrolyseur")),
                position=to_str(r.get("Position")),
                date=r.get("Datum"),
                time=to_str(r.get("Zeit")),
                voltage=to_float(r.get("Ui")),
                voltage_prev=to_float(r.get("Uk")),
            )
        )
    print(f"  {len(rows)} voltage readings migrated")
    db.commit()

    ce_tables = [
        ("tblEingabeCEElementNaOH", "element"),
        ("tblEingabeCEElektrolyseurNaOH", "electrolyzer"),
        ("tblEingabeCETeilanlageNaOH", "sub_plant"),
    ]
    total_ce = 0
    for table, scope in ce_tables:
        rows = fetch_rows(cur, table)
        for r in rows:
            scope_ref = to_str(r.get("Elektrolyseur") or r.get("Teilanlage"))
            db.add(
                models.CurrentEfficiencyEntry(
                    scope=scope,
                    scope_ref=scope_ref,
                    position=to_str(r.get("Position")),
                    date=r.get("Datum"),
                    value_pct=to_float(r.get("CE")),
                )
            )
        total_ce += len(rows)
    db.commit()
    print(f"  {total_ce} current efficiency entries migrated")


# --------------------------------------------------------------------------
# Analyses (unified table)
# --------------------------------------------------------------------------

ANALYSIS_TABLES = [
    ("Analyse Anolyt Element", "anolyte", "element"),
    ("Analyse Anolyt Gruppe", "anolyte", "group"),
    ("Analyse Anolyt Teilanlage", "anolyte", "sub_plant"),
    ("Analyse anolyt", "anolyte", "electrolyzer"),
    ("Analyse anolyt Ges", "anolyte", "total_plant"),
    ("Analyse Catholyt Element", "catholyte", "element"),
    ("Analyse Catholyt Gruppe", "catholyte", "group"),
    ("Analyse Catholyt Teilanlage", "catholyte", "sub_plant"),
    ("Analyse catholyt", "catholyte", "electrolyzer"),
    ("Analyse catholyt Ges", "catholyte", "total_plant"),
    ("Analyse Chlorgas Element", "chlorine_gas", "element"),
    ("Analyse Chlorgas Gruppe", "chlorine_gas", "group"),
    ("Analyse Chlorgas Teilanlage", "chlorine_gas", "sub_plant"),
    ("Analyse Chlorgas", "chlorine_gas", "electrolyzer"),
    ("Analyse Chlorgas Ges", "chlorine_gas", "total_plant"),
    ("Analyse Pure Brine Element", "pure_brine", "element"),
    ("Analyse pure brine gruppe", "pure_brine", "group"),
    ("Analyse pure brine Teilanlage", "pure_brine", "sub_plant"),
    ("Analyse pure brine", "pure_brine", "electrolyzer"),
    ("Analyse pure brine Ges", "pure_brine", "total_plant"),
    ("Analyse demin water", "demin_water", "total_plant"),
    ("Analyse hydrogen", "hydrogen", "total_plant"),
    ("Analyse caustic feed", "caustic_feed", "total_plant"),
    ("Analyse caustic feed Teilanlage", "caustic_feed", "sub_plant"),
    ("tblAnalyseHClElektrolyseur", "hcl", "electrolyzer"),
    ("tblAnalyseHClGesamtanlage", "hcl", "total_plant"),
    ("tblAnalyseHClTeilanlage", "hcl", "sub_plant"),
]

SCOPE_COLUMNS = {"Elektrolyseur", "Position", "Positon", "Gruppe", "Teilanlage", "Datum", "Zeit"}


def migrate_analyses(cur, db: Session):
    total = 0
    for table, analysis_type, scope in ANALYSIS_TABLES:
        rows = fetch_rows(cur, table)
        for r in rows:
            params = {k: jsonable(v) for k, v in r.items() if k not in SCOPE_COLUMNS and v is not None}
            db.add(
                models.AnalysisSample(
                    analysis_type=analysis_type,
                    scope=scope,
                    electrolyzer=to_str(r.get("Elektrolyseur")),
                    position=to_str(r.get("Position") or r.get("Positon")),
                    group_nr=to_str(r.get("Gruppe")),
                    sub_plant=to_str(r.get("Teilanlage")),
                    date=r.get("Datum"),
                    time=to_str(r.get("Zeit")),
                    parameters=params,
                )
            )
        total += len(rows)
    db.commit()
    print(f"  {total} analysis samples migrated across {len(ANALYSIS_TABLES)} source tables")


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------

DATA_TABLES = [
    models.Electrolyzer, models.SubPlant, models.FullPlant, models.Rectifier, models.Transformer,
    models.ElectrolyzerArrangement, models.ReservePosition, models.PlantSettings, models.CorrectionFactor,
    models.ElectrodeArea, models.VoltageDistributionClass, models.Remark, models.GroupDefinition,
    models.InspectionReason, models.InspectionFinding, models.Element, models.InspectionReport,
    models.InspectionHalfshellGrid, models.CellComponent, models.Anode, models.Cathode, models.Membrane,
    models.AnodeMaintenance, models.CathodeMaintenance, models.MembraneMaintenance, models.AnodeRecoating,
    models.CathodeRecoating, models.AnodeCoatingCheck, models.CathodeCoatingCheck, models.ShutdownCategory,
    models.ShutdownCause, models.Shutdown, models.ElectrolyzerNormalization, models.VoltageReading,
    models.CurrentEfficiencyEntry, models.AnalysisSample,
]


def run_migration(db_path: str | None = None, mode: str = "replace", progress=print) -> dict:
    """
    mode="replace": wipes every plant-data table (NOT users/permissions) before importing.
    mode="merge": imports on top of existing data (lookup tables are upserted by key,
    everything else is appended - matches the original per-table migrate_* behavior).
    """
    source = db_path or settings.ACCESS_DB_PATH
    progress("=" * 70)
    progress("PVC Arvand - migrating data from an Uhde Access database")
    progress(f"Source: {source}")
    progress(f"Target: {settings.DATABASE_URL}")
    progress(f"Mode: {mode}")
    progress("=" * 70)

    Base.metadata.create_all(bind=engine)

    conn = get_access_connection(source)
    cur = conn.cursor()
    db = SessionLocal()
    try:
        if mode == "replace":
            for table in reversed(DATA_TABLES):
                db.query(table).delete()
            db.commit()

        progress("[1/7] Plant configuration & lookups")
        migrate_lookups(cur, db)
        progress("[2/7] Settings & reference data")
        migrate_settings(cur, db)
        progress("[3/7] Elements (assembly data) & related lookups")
        migrate_elements(cur, db)
        progress("[4/7] Inspection reports")
        migrate_inspections(cur, db)
        progress("[5/7] Anodes, cathodes, membranes")
        migrate_components(cur, db)
        progress("[6/7] Shutdowns")
        migrate_shutdowns(cur, db)
        progress("[7/8] Voltage, current efficiency & analyses")
        migrate_voltage(cur, db)
        migrate_analyses(cur, db)
    finally:
        db.close()
        conn.close()

    from .access_archive import sync_access_archive

    progress("[8/8] Archiving all 126 Access tables for the All Tables page")
    archive = sync_access_archive(source, progress=progress)
    progress("Migration complete.")
    return {"mode": mode, "source": source, "archived_tables": archive["tables"]}


if __name__ == "__main__":
    run_migration(mode="replace")
