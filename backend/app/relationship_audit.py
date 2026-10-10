"""Audit (and repair) the links between tables.

Tables are tied together by value - an anode number in Assembly Data must exist in Anode Details, a group in
Assembly Data must exist in Group Definition, and so on. This module lists every such link, counts

  * ``spelling``  values that do exist in the parent but are written differently ("UA 12" vs "UA12"),
  * ``orphans``   values that have no parent row at all,

and can fix them: spellings are rewritten to the parent's spelling and missing masters (anode / cathode /
membrane / group / shutdown cause / category) are created. Orphans that cannot be created safely
(an element number without an assembly row, an unknown electrolyzer) are only reported.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import func, update
from sqlalchemy.orm import Session

from . import models
from .plant_topology import all_electrolyzers, format_electrolyzer_name, is_valid_electrolyzer_name
from .relations_sync import MASTERS, PLACEHOLDERS, is_junk_serial
from .warehouse import _life_key, compact_nr, ensure_indexed

Normalizer = Callable[[Any], str]
ParentLoader = Callable[[Session], dict[str, str]]
Creator = Callable[[Session, str], bool]


def _electrolyzer_key(value: Any) -> str:
    return format_electrolyzer_name(None if value is None else str(value))


def _fold(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


@dataclass
class Rel:
    name: str
    label: str
    child: Any  # model
    field: str
    parent_label: str
    parent: ParentLoader  # key -> canonical spelling
    norm: Normalizer = compact_nr
    where: Callable[[], Any] | None = None  # extra filter on the child model
    create: Creator | None = None  # makes a missing parent row
    rename: bool = True  # may rewrite a differently-spelled value
    severity: str = "error"  # error | warning | info
    group: str = "components"
    serial: bool = False  # anode / cathode / membrane number: free text and "XXXXX" are not part numbers


# ---------------------------------------------------------------- parents


def _parent_serials(model, column: str) -> ParentLoader:
    def load(db: Session) -> dict[str, str]:
        out: dict[str, str] = {}
        for (value,) in db.query(getattr(model, column)).all():
            key = compact_nr(value)
            if key and key not in out:
                out[key] = str(value)
        return out

    return load


def _parent_union(*loaders: ParentLoader) -> ParentLoader:
    def load(db: Session) -> dict[str, str]:
        out: dict[str, str] = {}
        for loader in loaders:
            for key, value in loader(db).items():
                out.setdefault(key, value)
        return out

    return load


def _parent_electrolyzers(db: Session) -> dict[str, str]:
    out = {name: name for name in all_electrolyzers()}
    for (raw,) in db.query(models.Electrolyzer.name).all():
        key = _electrolyzer_key(raw)
        if key:
            out.setdefault(key, key)
    return out


def _parent_text(model, column: str) -> ParentLoader:
    def load(db: Session) -> dict[str, str]:
        out: dict[str, str] = {}
        for (value,) in db.query(getattr(model, column)).all():
            text = " ".join(str(value or "").split())
            if text and text.casefold() not in out:
                out[text.casefold()] = text
        return out

    return load


# ---------------------------------------------------------------- creators


def _creator(kind: str) -> Creator:
    model, column = MASTERS[kind]

    def create(db: Session, raw: str) -> bool:
        return bool(ensure_indexed(db, model, column, raw, None))

    return create


def _create_group(db: Session, raw: str) -> bool:
    text = str(raw).strip()[:50]
    if not text:
        return False
    db.add(models.GroupDefinition(group_nr=text, remarks="Added automatically - used by other tables, specification not defined yet."))
    return True


def _create_cause(db: Session, raw: str) -> bool:
    db.add(models.ShutdownCause(cause=str(raw).strip()[:200]))
    return True


def _create_category(db: Session, raw: str) -> bool:
    db.add(models.ShutdownCategory(category=str(raw).strip()[:100]))
    return True


def _by_kind(model, kind_field: str, kind: str):
    return lambda: getattr(model, kind_field) == kind


# ---------------------------------------------------------------- the relations

ANODES = _parent_serials(models.Anode, "anode_nr")
CATHODES = _parent_serials(models.Cathode, "cathode_nr")
MEMBRANES = _parent_serials(models.Membrane, "membrane_nr")
ELECTRODES = _parent_union(ANODES, CATHODES)
ELEMENTS = _parent_serials(models.Element, "element_nr")
GROUPS = _parent_serials(models.GroupDefinition, "group_nr")


def _build_relations() -> list[Rel]:
    rels: list[Rel] = []

    def add(**kw):
        kw.setdefault("serial", kw.get("parent") in (ANODES, CATHODES, MEMBRANES, ELECTRODES))
        rels.append(Rel(**kw))

    # --- Assembly Data -> catalogues
    add(name="el-anode", label="Assembly Data - Anode Nr", child=models.Element, field="anode_nr", parent_label="Anode Details", parent=ANODES, create=_creator("anode"), group="assembly")
    add(name="el-cathode", label="Assembly Data - Cathode Nr", child=models.Element, field="cathode_nr", parent_label="Cathode Details", parent=CATHODES, create=_creator("cathode"), group="assembly")
    add(name="el-membrane", label="Assembly Data - Membrane Nr", child=models.Element, field="membrane_nr", parent_label="Membrane Details", parent=MEMBRANES, create=_creator("membrane"), group="assembly")
    add(name="el-group", label="Assembly Data - Group", child=models.Element, field="group_nr", parent_label="Group Definition", parent=GROUPS, create=_create_group, group="assembly")
    add(name="el-electrolyzer", label="Assembly Data - Electrolyzer", child=models.Element, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, group="assembly")

    # --- anode / cathode / membrane sub-records
    for model, fld, parent, kind, nice in (
        (models.AnodeMaintenance, "anode_nr", ANODES, "anode", "Anode Maintenance"),
        (models.AnodeRecoating, "anode_nr", ANODES, "anode", "Anode Recoating"),
        (models.AnodeCoatingCheck, "anode_nr", ANODES, "anode", "Anode Coating Check"),
        (models.CathodeMaintenance, "cathode_nr", CATHODES, "cathode", "Cathode Maintenance"),
        (models.CathodeRecoating, "cathode_nr", CATHODES, "cathode", "Cathode Recoating"),
        (models.CathodeCoatingCheck, "cathode_nr", CATHODES, "cathode", "Cathode Coating Check"),
        (models.MembraneMaintenance, "membrane_nr", MEMBRANES, "membrane", "Membrane Maintenance"),
    ):
        add(name=f"{model.__tablename__}-{fld}", label=f"{nice} - {fld}", child=model, field=fld, parent_label=f"{kind.title()} Details", parent=parent, create=_creator(kind), group="components")

    # --- inspections
    for model, nice, tag in ((models.InspectionReport, "Element Inspection", "insp"), (models.AssemblyInspectionReport, "Assembly Inspection", "ainsp")):
        add(name=f"{tag}-anode", label=f"{nice} - Anode Nr", child=model, field="anode_nr", parent_label="Anode Details", parent=ANODES, create=_creator("anode"), group="inspections")
        add(name=f"{tag}-cathode", label=f"{nice} - Cathode Nr", child=model, field="cathode_nr", parent_label="Cathode Details", parent=CATHODES, create=_creator("cathode"), group="inspections")
        add(name=f"{tag}-membrane", label=f"{nice} - Membrane Nr", child=model, field="membrane_nr", parent_label="Membrane Details", parent=MEMBRANES, create=_creator("membrane"), group="inspections")
        add(name=f"{tag}-electrolyzer", label=f"{nice} - Electrolyzer", child=model, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, group="inspections")
    add(name="insp-element", label="Element Inspection - Element Nr", child=models.InspectionReport, field="element_nr", parent_label="Assembly Data (element)", parent=ELEMENTS, severity="warning", group="inspections")
    add(name="ainsp-element", label="Assembly Inspection - Element Nr", child=models.AssemblyInspectionReport, field="element_nr", parent_label="Assembly Data (element)", parent=ELEMENTS, severity="info", group="inspections")
    add(name="ainsp-group", label="Assembly Inspection - Group", child=models.AssemblyInspectionReport, field="group_nr", parent_label="Group Definition", parent=GROUPS, create=_create_group, group="inspections")
    add(name="grid-element", label="Inspection defect maps - Element Nr", child=models.InspectionHalfshellGrid, field="element_nr", parent_label="Assembly Data (element)", parent=ELEMENTS, severity="warning", group="inspections")

    # --- segregation / TAFKIK
    seg = models.ElectrodeSegregation
    add(name="seg-anode", label="Electrode Segregation - Anode serial", child=seg, field="serial_nr", parent_label="Anode Details", parent=ANODES, where=_by_kind(seg, "electrode_kind", "anode"), create=_creator("anode"), group="segregation")
    add(name="seg-cathode", label="Electrode Segregation - Cathode serial", child=seg, field="serial_nr", parent_label="Cathode Details", parent=CATHODES, where=_by_kind(seg, "electrode_kind", "cathode"), create=_creator("cathode"), group="segregation")
    add(name="seg-unknown", label="Electrode Segregation - serial (kind unknown)", child=seg, field="serial_nr", parent_label="Anode / Cathode Details", parent=ELECTRODES, where=lambda: seg.electrode_kind.notin_(["anode", "cathode"]) | seg.electrode_kind.is_(None), severity="warning", group="segregation")

    # --- maintenance report uploads
    for kind, parent in (("anode", ANODES), ("cathode", CATHODES), ("membrane", MEMBRANES)):
        add(name=f"mreport-{kind}", label=f"Maintenance Reports ({kind}) - component", child=models.MaintenanceReport, field="component_nr", parent_label=f"{kind.title()} Details", parent=parent, where=_by_kind(models.MaintenanceReport, "kind", kind), create=_creator(kind), group="components")

    # --- warehouse / coating lifecycle
    for model, nice, tag in (
        (models.WhElementState, "Warehouse state", "whstate"),
        (models.WhLifecycleEvent, "Warehouse event", "whevent"),
        (models.WhCoatingDispatchItem, "Coating dispatch item", "whdisp"),
        (models.WhCoatingReceivingItem, "Coating receiving item", "whrecv"),
        (models.WhPunch, "Punch record", "whpunch"),
        (models.WhDecommission, "Decommission record", "whdecom"),
    ):
        for kind, parent in (("anode", ANODES), ("cathode", CATHODES)):
            add(name=f"{tag}-{kind}", label=f"{nice} ({kind}) - serial", child=model, field="serial", parent_label=f"{kind.title()} Details", parent=parent, where=_by_kind(model, "element_kind", kind), create=_creator(kind), group="warehouse")
    add(name="wh-purchase-item", label="Purchase item - serial", child=models.WhPurchaseItem, field="serial", parent_label="Anode / Cathode Details", parent=ELECTRODES, severity="warning", group="warehouse")

    # --- voltage / analyses
    add(name="volt-electrolyzer", label="Voltage readings - Electrolyzer", child=models.VoltageReading, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, group="voltage")
    add(name="norm-electrolyzer", label="Normalizations - Electrolyzer", child=models.ElectrolyzerNormalization, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, group="voltage")
    add(name="un-el-electrolyzer", label="Un element input - Electrolyzer", child=models.VoltageUnElementInput, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, group="voltage")
    add(name="un-group", label="Un group input - Group", child=models.VoltageUnGroupInput, field="group_nr", parent_label="Group Definition", parent=GROUPS, create=_create_group, group="voltage")
    add(name="analysis-electrolyzer", label="Analyses - Electrolyzer", child=models.AnalysisSample, field="electrolyzer", parent_label="Electrolyzers", parent=_parent_electrolyzers, norm=_electrolyzer_key, severity="warning", group="analyses")
    add(name="analysis-group", label="Analyses - Group", child=models.AnalysisSample, field="group_nr", parent_label="Group Definition", parent=GROUPS, create=_create_group, severity="warning", group="analyses")

    # --- shutdowns
    add(name="shut-cause", label="Shutdowns - Cause", child=models.Shutdown, field="cause", parent_label="Shutdown Causes", parent=_parent_text(models.ShutdownCause, "cause"), norm=_fold, create=_create_cause, severity="warning", group="shutdowns")
    add(name="shut-category", label="Shutdowns - Category", child=models.Shutdown, field="category", parent_label="Shutdown Categories", parent=_parent_text(models.ShutdownCategory, "category"), norm=_fold, create=_create_category, severity="warning", group="shutdowns")
    add(name="cause-category", label="Shutdown Causes - Category", child=models.ShutdownCause, field="category", parent_label="Shutdown Categories", parent=_parent_text(models.ShutdownCategory, "category"), norm=_fold, create=_create_category, severity="warning", group="shutdowns")

    return rels


RELATIONS = _build_relations()

# integer-key links that must resolve (child model, field, parent model, parent field, label)
ID_LINKS = [
    (models.WhCoatingDispatchItem, "dispatch_id", models.WhCoatingDispatch, "id", "Dispatch item -> dispatch"),
    (models.WhCoatingDispatch, "company_id", models.WhCompany, "id", "Dispatch -> company"),
    (models.WhCoatingReceiving, "dispatch_id", models.WhCoatingDispatch, "id", "Receiving -> dispatch"),
    (models.WhCoatingReceivingItem, "receiving_id", models.WhCoatingReceiving, "id", "Receiving item -> receiving"),
    (models.WhCoatingReceivingItem, "dispatch_item_id", models.WhCoatingDispatchItem, "id", "Receiving item -> dispatch item"),
    (models.WhPurchase, "supplier_id", models.WhCompany, "id", "Purchase -> supplier"),
    (models.WhPurchaseItem, "purchase_id", models.WhPurchase, "id", "Purchase item -> purchase"),
    (models.WhPunch, "company_id", models.WhCompany, "id", "Punch -> company"),
    (models.WhPunch, "dispatch_id", models.WhCoatingDispatch, "id", "Punch -> dispatch"),
    (models.WhElementState, "company_id", models.WhCompany, "id", "State -> company"),
    (models.WhElementState, "open_dispatch_id", models.WhCoatingDispatch, "id", "State -> open dispatch"),
    (models.MaintenanceReportFile, "report_id", models.MaintenanceReport, "id", "Report file -> report"),
]


# ---------------------------------------------------------------- audit


def _distinct_counts(db: Session, rel: Rel) -> list[tuple[Any, int]]:
    col = getattr(rel.child, rel.field)
    query = db.query(col, func.count()).filter(col.isnot(None))
    if rel.where is not None:
        query = query.filter(rel.where())
    return query.group_by(col).all()


def _skip(raw: Any, rel: Rel) -> bool:
    text = str(raw or "").strip()
    if not text:
        return True
    if rel.norm is _electrolyzer_key:
        return not is_valid_electrolyzer_name(text)
    if rel.serial:
        return is_junk_serial(text)
    return text.upper() in PLACEHOLDERS


def audit_relation(db: Session, rel: Rel, sample: int = 12) -> dict[str, Any]:
    parents = rel.parent(db)
    ok_rows = 0
    spelling: list[dict] = []
    orphans: list[dict] = []
    for raw, count in _distinct_counts(db, rel):
        if _skip(raw, rel):
            continue
        key = rel.norm(raw)
        if not key:
            continue
        canonical = parents.get(key)
        if canonical is None:
            orphans.append({"value": str(raw), "rows": int(count)})
        elif str(raw) != canonical:
            spelling.append({"value": str(raw), "should_be": canonical, "rows": int(count)})
        else:
            ok_rows += int(count)
    spelling.sort(key=lambda r: -r["rows"])
    orphans.sort(key=lambda r: -r["rows"])
    problems = len(spelling) + len(orphans)
    return {
        "name": rel.name,
        "group": rel.group,
        "label": rel.label,
        "child": f"{rel.child.__tablename__}.{rel.field}",
        "parent": rel.parent_label,
        "severity": rel.severity,
        "ok_rows": ok_rows,
        "spelling_values": len(spelling),
        "spelling_rows": sum(r["rows"] for r in spelling),
        "orphan_values": len(orphans),
        "orphan_rows": sum(r["rows"] for r in orphans),
        "spelling": spelling[:sample],
        "orphans": orphans[:sample],
        "fixable": bool((spelling and rel.rename) or (orphans and rel.create)),
        "status": "ok" if not problems else rel.severity,
    }


def audit_id_links(db: Session) -> list[dict[str, Any]]:
    out = []
    for child, fld, parent, pfld, label in ID_LINKS:
        col = getattr(child, fld)
        ids = {i for (i,) in db.query(getattr(parent, pfld)).all()}
        broken = [(i, n) for i, n in db.query(col, func.count()).filter(col.isnot(None)).group_by(col).all() if i not in ids]
        out.append(
            {
                "label": label,
                "child": f"{child.__tablename__}.{fld}",
                "parent": f"{parent.__tablename__}.{pfld}",
                "broken_values": len(broken),
                "broken_rows": sum(n for _i, n in broken),
                "examples": [str(i) for i, _n in broken[:10]],
                "status": "ok" if not broken else "error",
            }
        )
    return out


def _check(name: str, label: str, examples: list[str], status_if_bad: str, fixable: bool = False) -> dict[str, Any]:
    return {
        "name": name,
        "label": label,
        "count": len(examples),
        "examples": examples[:8],
        "status": "ok" if not examples else status_if_bad,
        "fixable": fixable and bool(examples),
    }


def _consistency(db: Session) -> list[dict[str, Any]]:
    """Cross-table facts that should agree (reported, not rewritten)."""
    checks: list[dict[str, Any]] = []
    elements = db.query(models.Element).all()

    # 0. The same number twice in a master list (differing only by case / spaces).
    for label, model, column in (
        ("Anode Details", models.Anode, "anode_nr"),
        ("Cathode Details", models.Cathode, "cathode_nr"),
        ("Membrane Details", models.Membrane, "membrane_nr"),
        ("Group Definition", models.GroupDefinition, "group_nr"),
    ):
        groups: dict[str, list[str]] = {}
        for (value,) in db.query(getattr(model, column)).all():
            key = compact_nr(value)
            if key:
                groups.setdefault(key, []).append(str(value))
        twins = [" | ".join(v) for v in groups.values() if len(v) > 1]
        checks.append(_check(f"twins-{column}", f"{label}: same number listed more than once", twins, "error"))

    # 1. A part must not be mounted in two cells at once.
    for kind, fld in (("anode", "anode_nr"), ("cathode", "cathode_nr"), ("membrane", "membrane_nr")):
        seen: dict[str, set[str]] = {}
        for el in elements:
            key = compact_nr(getattr(el, fld))
            if key and not is_junk_serial(getattr(el, fld)) and el.disassembly_date is None:
                seen.setdefault(key, set()).add(str(el.element_nr or "?"))
        dup = [f"{k} -> {', '.join(sorted(v))}" for k, v in seen.items() if len(v) > 1]
        checks.append(_check(f"dup-{kind}", f"{kind.title()} mounted in more than one cell", dup, "error"))

    # 2. Type / coating written on the installation vs the master.
    spec = (
        ("membrane", models.Membrane, "membrane_nr", "membrane_type", "membrane_type", "Membrane type"),
        ("anode", models.Anode, "anode_nr", "coating", "anode_coating", "Anode coating"),
        ("cathode", models.Cathode, "cathode_nr", "coating", "cathode_coating", "Cathode coating"),
    )
    for kind, model, key_field, master_field, el_field, nice in spec:
        masters = {compact_nr(getattr(m, key_field)): m for m in db.query(model).all()}
        diff: list[str] = []
        blank: list[str] = []
        newest: dict[str, models.Element] = {}  # only the current installation of each part is compared
        for el in elements:
            k = compact_nr(getattr(el, key_field))
            if k and (k not in newest or _life_key(el) >= _life_key(newest[k])):
                newest[k] = el
        for el in newest.values():
            master = masters.get(compact_nr(getattr(el, key_field)))
            value = _fold(getattr(el, el_field))
            if master is None or not value:
                continue
            m_value = _fold(getattr(master, master_field))
            if not m_value:
                blank.append(str(getattr(el, key_field)))
            elif m_value != value:
                diff.append(f"{getattr(el, key_field)}: {getattr(el, el_field)} / {getattr(master, master_field)}")
        checks.append(_check(f"{kind}-spec-differs", f"{nice} differs between Assembly Data and {kind.title()} Details", diff, "info"))
        checks.append(_check(f"{kind}-spec-blank", f"{nice} empty in {kind.title()} Details but known from Assembly Data", sorted(set(blank)), "warning", fixable=True))

    # 3. Decommissioned in the master but still mounted.
    for kind, model, key_field in (("anode", models.Anode, "anode_nr"), ("cathode", models.Cathode, "cathode_nr"), ("membrane", models.Membrane, "membrane_nr")):
        dead = {compact_nr(getattr(m, key_field)) for m in db.query(model).filter(model.decommission_date.isnot(None)).all()}
        mounted = [
            f"{getattr(el, key_field)} (element {el.element_nr})"
            for el in elements
            if el.disassembly_date is None and el.decommissioning_date is None and compact_nr(getattr(el, key_field)) in dead
        ]
        checks.append(_check(f"dead-{kind}", f"{kind.title()} marked decommissioned in its master but still in service", mounted, "error"))

    # 4. Contradictory installation dates.
    bad = []
    for el in elements:
        for a, b in (("assembly_date", "commissioning_date"), ("commissioning_date", "decommissioning_date"), ("assembly_date", "disassembly_date")):
            da, dd = getattr(el, a), getattr(el, b)
            if da and dd and dd < da:
                bad.append(f"element {el.element_nr}: {b} before {a}")
                break
    checks.append(_check("dates", "Installation dates out of order", bad, "warning"))

    # 5. An open coater job in Warehouse that Anode / Cathode Recoating does not know about (and vice versa).
    for kind, rec_model, rec_field in (("anode", models.AnodeRecoating, "anode_nr"), ("cathode", models.CathodeRecoating, "cathode_nr")):
        at_coater = {compact_nr(s.serial) for s in db.query(models.WhElementState).filter_by(element_kind=kind, lifecycle_status="at_coater").all()}
        open_jobs = {
            compact_nr(getattr(r, rec_field))
            for r in db.query(rec_model).filter(rec_model.dispatch_date.isnot(None), rec_model.return_date.is_(None)).all()
        }
        only_wh = sorted(at_coater - open_jobs)
        checks.append(_check(f"coater-{kind}", f"{kind.title()}s at the coater in Warehouse without an open {kind.title()} Recoating row", only_wh, "info"))
    return checks


def is_placeholder_text(value: Any) -> bool:
    return str(value or "").strip().upper() in PLACEHOLDERS


def run_audit(db: Session) -> dict[str, Any]:
    relations = [audit_relation(db, rel) for rel in RELATIONS]
    id_links = audit_id_links(db)
    consistency = _consistency(db)
    problems = [r for r in relations if r["status"] != "ok"]
    summary = {
        "relations": len(relations),
        "relations_ok": len(relations) - len(problems),
        "relations_with_problems": len(problems),
        "spelling_rows": sum(r["spelling_rows"] for r in relations),
        "orphan_rows": sum(r["orphan_rows"] for r in relations),
        "fixable": sum(1 for r in relations if r["fixable"]) + sum(1 for c in consistency if c.get("fixable")),
        "id_links_broken": sum(1 for i in id_links if i["status"] != "ok"),
        "consistency_issues": sum(1 for c in consistency if c["status"] not in ("ok", "info")),
    }
    return {"summary": summary, "relations": relations, "id_links": id_links, "consistency": consistency}


# ---------------------------------------------------------------- repair


def repair_relation(db: Session, rel: Rel) -> dict[str, int]:
    parents = rel.parent(db)
    renamed = created = 0
    col = getattr(rel.child, rel.field)
    for raw, _count in _distinct_counts(db, rel):
        if _skip(raw, rel):
            continue
        key = rel.norm(raw)
        if not key:
            continue
        canonical = parents.get(key)
        if canonical is None:
            if rel.create is not None and rel.create(db, str(raw).strip()):
                created += 1
                parents[key] = str(raw).strip()
                db.flush()
            continue
        if str(raw) != canonical and rel.rename:
            if rel.child is models.WhElementState and (
                db.query(models.WhElementState).filter(models.WhElementState.serial == canonical, rel.where()).first()
                is not None
            ):
                continue  # unique (kind, serial): the correctly spelled row already exists - leave this one for a person
            stmt = update(rel.child).where(col == raw)
            if rel.where is not None:
                stmt = stmt.where(rel.where())
            renamed += db.execute(stmt.values({rel.field: canonical})).rowcount or 0
    return {"renamed_rows": renamed, "created_masters": created}


def fill_blank_masters(db: Session) -> int:
    """Anode / cathode / membrane masters learn coating / type from their latest installation when blank."""
    filled = 0
    spec = (
        (models.Anode, "anode_nr", "coating", "anode_coating"),
        (models.Cathode, "cathode_nr", "coating", "cathode_coating"),
        (models.Membrane, "membrane_nr", "membrane_type", "membrane_type"),
    )
    elements = sorted(db.query(models.Element).all(), key=_life_key)  # newest installation last
    for model, key_field, master_field, el_field in spec:
        masters = {compact_nr(getattr(m, key_field)): m for m in db.query(model).all()}
        latest: dict[str, str] = {}
        for el in elements:
            key = compact_nr(getattr(el, key_field))
            value = (getattr(el, el_field) or "").strip()
            if key and value:
                latest[key] = value
        for key, value in latest.items():
            master = masters.get(key)
            if master is not None and not (getattr(master, master_field) or "").strip():
                setattr(master, master_field, value[: 50 if master_field == "coating" else 100])
                filled += 1
    return filled


def run_repair(db: Session, only: list[str] | None = None, mode: str = "all") -> dict[str, Any]:
    """Apply the safe fixes.

    mode "links": rewrite spellings and create missing master rows;
    mode "fill":  fill empty coating / membrane type in the masters from Assembly Data;
    mode "all":   both. One audit-log row summarises the run (instead of one per touched row).
    """
    from .audit import write_audit

    db.info["skip_audit"] = True
    done: list[dict[str, Any]] = []
    if mode in ("links", "all"):
        for rel in RELATIONS:
            if only and rel.name not in only:
                continue
            result = repair_relation(db, rel)
            if result["renamed_rows"] or result["created_masters"]:
                done.append({"name": rel.name, "label": rel.label, **result})
            db.flush()
    filled = fill_blank_masters(db) if mode in ("fill", "all") and not only else 0
    db.commit()
    out = {
        "changed": done,
        "renamed_rows": sum(d["renamed_rows"] for d in done),
        "created_masters": sum(d["created_masters"] for d in done),
        "masters_filled": filled,
    }
    write_audit(
        action="update",
        resource="table_links",
        summary=f"Table-link repair ({mode}): {out['renamed_rows']} rows respelled, {out['created_masters']} master rows created, {filled} master fields filled",
        after_data={k: v for k, v in out.items() if k != "changed"},
    )
    return out
