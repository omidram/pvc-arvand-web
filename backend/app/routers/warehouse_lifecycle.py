from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_any_form_access
from ..database import get_db
from ..warehouse_lifecycle import (
    LIFECYCLE_STATUSES,
    company_history,
    company_payload,
    dashboard,
    element_timeline,
    ensure_element_master,
    log_event,
    next_doc_no,
    refresh_dispatch_status,
    search_lifecycle,
    upsert_state,
    _stamp,
)

router = APIRouter(prefix="/warehouse-lifecycle", tags=["warehouse-lifecycle"])

_access = Depends(require_any_form_access("storage", "anodes", "cathodes"))


class CompanyIn(BaseModel):
    name: str
    is_coating: bool = False
    is_supplier: bool = False
    contact_person: str | None = None
    phone: str | None = None
    address: str | None = None
    contract_ref: str | None = None
    contract_valid_until: date | None = None
    remarks: str | None = None


class DispatchItemIn(BaseModel):
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str


class DispatchIn(BaseModel):
    company_id: int
    dispatch_date: date
    send_no: str | None = None
    remarks: str | None = None
    items: list[DispatchItemIn]


class ReceivingItemIn(BaseModel):
    dispatch_item_id: int | None = None
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str
    coating_status: str | None = None
    appearance_status: str | None = None
    qc_result: str | None = None
    vendor_report_no: str | None = None
    remarks: str | None = None


class ReceivingIn(BaseModel):
    dispatch_id: int | None = None
    receive_date: date
    receive_no: str | None = None
    remarks: str | None = None
    items: list[ReceivingItemIn]


class PurchaseIn(BaseModel):
    supplier_id: int
    purchase_date: date
    element_kind: str = Field(pattern="^(anode|cathode)$")
    purchase_no: str | None = None
    remarks: str | None = None
    serials: list[str]


class PunchIn(BaseModel):
    company_id: int | None = None
    dispatch_id: int | None = None
    send_no: str | None = None
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str
    punch_no: str | None = None
    punch_date: date | None = None
    remarks: str | None = None


class DecommissionIn(BaseModel):
    element_kind: str = Field(pattern="^(anode|cathode)$")
    serial: str
    decommission_date: date
    reason: str
    remarks: str | None = None


class StatePatchIn(BaseModel):
    lifecycle_status: str
    company_id: int | None = None


@router.get("/meta")
def lifecycle_meta(_: models.User = _access):
    return {"lifecycle_statuses": list(LIFECYCLE_STATUSES)}


@router.get("/dashboard")
def lifecycle_dashboard(db: Session = Depends(get_db), _: models.User = _access):
    return dashboard(db)


@router.get("/companies")
def list_companies(
    q: str | None = None,
    coating: bool | None = None,
    supplier: bool | None = None,
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    query = db.query(models.WhCompany).order_by(models.WhCompany.name)
    if coating is True:
        query = query.filter(models.WhCompany.is_coating.is_(True))
    if supplier is True:
        query = query.filter(models.WhCompany.is_supplier.is_(True))
    rows = query.all()
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in (r.name or "").lower()]
    return [company_payload(r) for r in rows]


@router.post("/companies")
def create_company(body: CompanyIn, db: Session = Depends(get_db), _: models.User = _access):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    if db.query(models.WhCompany).filter(models.WhCompany.name == name).first():
        raise HTTPException(409, "Company already exists")
    data = body.model_dump()
    data["name"] = name[:200]
    row = models.WhCompany(created_at=_stamp(date.today()), **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return company_payload(row)


@router.put("/companies/{company_id}")
def update_company(company_id: int, body: CompanyIn, db: Session = Depends(get_db), _: models.User = _access):
    row = db.get(models.WhCompany, company_id)
    if not row:
        raise HTTPException(404, "Not found")
    name = body.name.strip()
    if name != row.name and db.query(models.WhCompany).filter(models.WhCompany.name == name).first():
        raise HTTPException(409, "Company name taken")
    for k, v in body.model_dump().items():
        setattr(row, k, name[:200] if k == "name" else v)
    db.commit()
    db.refresh(row)
    return company_payload(row)


@router.get("/companies/{company_id}/history")
def get_company_history(company_id: int, db: Session = Depends(get_db), _: models.User = _access):
    try:
        return company_history(db, company_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/elements/state")
def list_element_states(
    kind: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = Query(default=500, ge=1, le=5000),
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    query = db.query(models.WhElementState)
    if kind in ("anode", "cathode"):
        query = query.filter(models.WhElementState.element_kind == kind)
    if status:
        query = query.filter(models.WhElementState.lifecycle_status == status)
    rows = query.order_by(models.WhElementState.serial).limit(limit).all()
    if q:
        needle = q.strip().lower()
        rows = [r for r in rows if needle in r.serial.lower()]
    out = []
    for r in rows:
        co_name = None
        if r.company_id:
            co = db.get(models.WhCompany, r.company_id)
            co_name = co.name if co else None
        out.append(
            {
                "element_kind": r.element_kind,
                "serial": r.serial,
                "lifecycle_status": r.lifecycle_status,
                "company_id": r.company_id,
                "company_name": co_name,
                "coating_status": r.coating_status,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
        )
    return out


@router.patch("/elements/{kind}/{serial}/state")
def patch_element_state(
    kind: str,
    serial: str,
    body: StatePatchIn,
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    if kind not in ("anode", "cathode") or body.lifecycle_status not in LIFECYCLE_STATUSES:
        raise HTTPException(400, "Invalid kind or status")
    row = upsert_state(db, kind, serial, lifecycle_status=body.lifecycle_status, company_id=body.company_id)
    db.commit()
    return {"serial": row.serial, "lifecycle_status": row.lifecycle_status}


@router.get("/elements/{kind}/{serial}/timeline")
def get_element_timeline(kind: str, serial: str, db: Session = Depends(get_db), _: models.User = _access):
    if kind not in ("anode", "cathode"):
        raise HTTPException(400, "Invalid kind")
    return element_timeline(db, kind, serial)


def _dispatch_detail(db: Session, dispatch: models.WhCoatingDispatch) -> dict:
    co = db.get(models.WhCompany, dispatch.company_id)
    items = db.query(models.WhCoatingDispatchItem).filter_by(dispatch_id=dispatch.id).all()
    return {
        "id": dispatch.id,
        "send_no": dispatch.send_no,
        "company_id": dispatch.company_id,
        "company_name": co.name if co else None,
        "dispatch_date": dispatch.dispatch_date.isoformat(),
        "status": dispatch.status,
        "remarks": dispatch.remarks,
        "items": [
            {"id": i.id, "element_kind": i.element_kind, "serial": i.serial, "received": i.received}
            for i in items
        ],
    }


@router.get("/dispatches")
def list_dispatches(
    status: str | None = None,
    company_id: int | None = None,
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    q = db.query(models.WhCoatingDispatch).order_by(models.WhCoatingDispatch.dispatch_date.desc())
    if status:
        q = q.filter(models.WhCoatingDispatch.status == status)
    if company_id:
        q = q.filter(models.WhCoatingDispatch.company_id == company_id)
    return [_dispatch_detail(db, d) for d in q.limit(300).all()]


@router.post("/dispatches")
def create_dispatch(body: DispatchIn, db: Session = Depends(get_db), _: models.User = _access):
    if not body.items:
        raise HTTPException(400, "At least one item required")
    co = db.get(models.WhCompany, body.company_id)
    if not co or not co.is_coating:
        raise HTTPException(400, "Coating company required")
    send_no = (body.send_no or "").strip() or next_doc_no(db, "CO", body.dispatch_date)
    if db.query(models.WhCoatingDispatch).filter_by(send_no=send_no).first():
        raise HTTPException(409, "Send number already used")
    dispatch = models.WhCoatingDispatch(
        send_no=send_no,
        company_id=body.company_id,
        dispatch_date=body.dispatch_date,
        status="sent",
        remarks=body.remarks,
        created_at=_stamp(body.dispatch_date),
    )
    db.add(dispatch)
    db.flush()
    for item in body.items:
        ensure_element_master(db, item.element_kind, item.serial)
        db.add(
            models.WhCoatingDispatchItem(
                dispatch_id=dispatch.id,
                element_kind=item.element_kind,
                serial=item.serial.strip()[:50],
                received=False,
            )
        )
        upsert_state(
            db,
            item.element_kind,
            item.serial,
            lifecycle_status="at_coater",
            company_id=body.company_id,
            open_dispatch_id=dispatch.id,
        )
        log_event(
            db,
            item.element_kind,
            item.serial,
            "dispatch",
            body.dispatch_date,
            f"Dispatch {send_no} → {co.name}",
            ref_kind="dispatch",
            ref_id=dispatch.id,
            details={"send_no": send_no, "company": co.name},
        )
    db.commit()
    db.refresh(dispatch)
    return _dispatch_detail(db, dispatch)


@router.get("/receivings")
def list_receivings(db: Session = Depends(get_db), _: models.User = _access):
    rows = db.query(models.WhCoatingReceiving).order_by(models.WhCoatingReceiving.receive_date.desc()).limit(300).all()
    out = []
    for r in rows:
        dispatch = db.get(models.WhCoatingDispatch, r.dispatch_id) if r.dispatch_id else None
        items = db.query(models.WhCoatingReceivingItem).filter_by(receiving_id=r.id).all()
        out.append(
            {
                "id": r.id,
                "receive_no": r.receive_no,
                "dispatch_id": r.dispatch_id,
                "send_no": dispatch.send_no if dispatch else None,
                "receive_date": r.receive_date.isoformat(),
                "remarks": r.remarks,
                "items": [
                    {
                        "id": i.id,
                        "element_kind": i.element_kind,
                        "serial": i.serial,
                        "coating_status": i.coating_status,
                        "qc_result": i.qc_result,
                    }
                    for i in items
                ],
            }
        )
    return out


@router.post("/receivings")
def create_receiving(body: ReceivingIn, db: Session = Depends(get_db), _: models.User = _access):
    if not body.items:
        raise HTTPException(400, "At least one item required")
    dispatch = db.get(models.WhCoatingDispatch, body.dispatch_id) if body.dispatch_id else None
    receive_no = (body.receive_no or "").strip() or next_doc_no(db, "RC", body.receive_date)
    if db.query(models.WhCoatingReceiving).filter_by(receive_no=receive_no).first():
        raise HTTPException(409, "Receive number already used")
    receiving = models.WhCoatingReceiving(
        receive_no=receive_no,
        dispatch_id=body.dispatch_id,
        receive_date=body.receive_date,
        remarks=body.remarks,
        created_at=_stamp(body.receive_date),
    )
    db.add(receiving)
    db.flush()
    co_id = dispatch.company_id if dispatch else None
    send_no = dispatch.send_no if dispatch else None
    for item in body.items:
        di = None
        if item.dispatch_item_id:
            di = db.get(models.WhCoatingDispatchItem, item.dispatch_item_id)
        elif dispatch:
            di = (
                db.query(models.WhCoatingDispatchItem)
                .filter_by(dispatch_id=dispatch.id, element_kind=item.element_kind, serial=item.serial.strip()[:50])
                .first()
            )
        if di:
            di.received = True
        db.add(
            models.WhCoatingReceivingItem(
                receiving_id=receiving.id,
                dispatch_item_id=di.id if di else item.dispatch_item_id,
                element_kind=item.element_kind,
                serial=item.serial.strip()[:50],
                coating_status=item.coating_status,
                appearance_status=item.appearance_status,
                qc_result=item.qc_result,
                vendor_report_no=item.vendor_report_no,
                remarks=item.remarks,
            )
        )
        upsert_state(
            db,
            item.element_kind,
            item.serial,
            lifecycle_status="in_plant",
            company_id=None,
            coating_status=item.coating_status,
            appearance_status=item.appearance_status,
            qc_result=item.qc_result,
            open_dispatch_id=None,
        )
        log_event(
            db,
            item.element_kind,
            item.serial,
            "receive",
            body.receive_date,
            f"Receive {receive_no}" + (f" (send {send_no})" if send_no else ""),
            ref_kind="receiving",
            ref_id=receiving.id,
            details={"receive_no": receive_no, "send_no": send_no, "qc_result": item.qc_result},
        )
    if dispatch:
        refresh_dispatch_status(db, dispatch.id)
    db.commit()
    db.refresh(receiving)
    return {"id": receiving.id, "receive_no": receiving.receive_no}


@router.get("/purchases")
def list_purchases(db: Session = Depends(get_db), _: models.User = _access):
    rows = db.query(models.WhPurchase).order_by(models.WhPurchase.purchase_date.desc()).limit(200).all()
    out = []
    for p in rows:
        sup = db.get(models.WhCompany, p.supplier_id)
        items = db.query(models.WhPurchaseItem).filter_by(purchase_id=p.id).all()
        out.append(
            {
                "id": p.id,
                "purchase_no": p.purchase_no,
                "supplier_id": p.supplier_id,
                "supplier_name": sup.name if sup else None,
                "purchase_date": p.purchase_date.isoformat(),
                "element_kind": p.element_kind,
                "remarks": p.remarks,
                "serials": [i.serial for i in items],
            }
        )
    return out


@router.post("/purchases")
def create_purchase(body: PurchaseIn, db: Session = Depends(get_db), _: models.User = _access):
    if not body.serials:
        raise HTTPException(400, "Serial list required")
    sup = db.get(models.WhCompany, body.supplier_id)
    if not sup or not sup.is_supplier:
        raise HTTPException(400, "Supplier company required")
    purchase_no = (body.purchase_no or "").strip() or next_doc_no(db, "PO", body.purchase_date)
    if db.query(models.WhPurchase).filter_by(purchase_no=purchase_no).first():
        raise HTTPException(409, "Purchase number already used")
    purchase = models.WhPurchase(
        purchase_no=purchase_no,
        supplier_id=body.supplier_id,
        purchase_date=body.purchase_date,
        element_kind=body.element_kind,
        remarks=body.remarks,
        created_at=_stamp(body.purchase_date),
    )
    db.add(purchase)
    db.flush()
    for serial in body.serials:
        s = serial.strip()[:50]
        if not s:
            continue
        ensure_element_master(db, body.element_kind, s)
        db.add(models.WhPurchaseItem(purchase_id=purchase.id, serial=s))
        upsert_state(db, body.element_kind, s, lifecycle_status="in_plant", company_id=None)
        log_event(
            db,
            body.element_kind,
            s,
            "purchase",
            body.purchase_date,
            f"Purchase {purchase_no} from {sup.name}",
            ref_kind="purchase",
            ref_id=purchase.id,
            details={"purchase_no": purchase_no, "supplier": sup.name},
        )
        log_event(
            db,
            body.element_kind,
            s,
            "plant_entry",
            body.purchase_date,
            "Entered plant inventory",
            ref_kind="purchase",
            ref_id=purchase.id,
            details={},
        )
    db.commit()
    return {"id": purchase.id, "purchase_no": purchase_no}


@router.get("/punches")
def list_punches(
    company_id: int | None = None,
    serial: str | None = None,
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    q = db.query(models.WhPunch).order_by(models.WhPunch.punch_date.desc(), models.WhPunch.id.desc())
    if company_id:
        q = q.filter(models.WhPunch.company_id == company_id)
    if serial:
        q = q.filter(models.WhPunch.serial.ilike(f"%{serial.strip()}%"))
    rows = q.limit(300).all()
    return [
        {
            "id": r.id,
            "company_id": r.company_id,
            "dispatch_id": r.dispatch_id,
            "send_no": r.send_no,
            "element_kind": r.element_kind,
            "serial": r.serial,
            "punch_no": r.punch_no,
            "punch_date": r.punch_date.isoformat() if r.punch_date else None,
            "remarks": r.remarks,
        }
        for r in rows
    ]


@router.post("/punches")
def create_punch(body: PunchIn, db: Session = Depends(get_db), _: models.User = _access):
    punch_date = body.punch_date or date.today()
    send_no = body.send_no
    if body.dispatch_id:
        d = db.get(models.WhCoatingDispatch, body.dispatch_id)
        if d:
            send_no = send_no or d.send_no
    row = models.WhPunch(
        company_id=body.company_id,
        dispatch_id=body.dispatch_id,
        send_no=send_no,
        element_kind=body.element_kind,
        serial=body.serial.strip()[:50],
        punch_no=body.punch_no,
        punch_date=punch_date,
        remarks=body.remarks,
        created_at=_stamp(punch_date),
    )
    db.add(row)
    db.flush()
    log_event(
        db,
        body.element_kind,
        body.serial,
        "punch",
        punch_date,
        f"Punch {body.punch_no or row.id}",
        ref_kind="punch",
        ref_id=row.id,
        details={"send_no": send_no, "punch_no": body.punch_no},
    )
    db.commit()
    return {"id": row.id}


@router.get("/decommissions")
def list_decommissions(db: Session = Depends(get_db), _: models.User = _access):
    rows = db.query(models.WhDecommission).order_by(models.WhDecommission.decommission_date.desc()).limit(200).all()
    return [
        {
            "id": r.id,
            "element_kind": r.element_kind,
            "serial": r.serial,
            "decommission_date": r.decommission_date.isoformat(),
            "reason": r.reason,
            "remarks": r.remarks,
        }
        for r in rows
    ]


@router.post("/decommissions")
def create_decommission(body: DecommissionIn, db: Session = Depends(get_db), _: models.User = _access):
    row = models.WhDecommission(
        element_kind=body.element_kind,
        serial=body.serial.strip()[:50],
        decommission_date=body.decommission_date,
        reason=body.reason[:40],
        remarks=body.remarks,
        created_at=_stamp(body.decommission_date),
    )
    db.add(row)
    if body.element_kind == "anode":
        master = db.get(models.Anode, body.serial.strip()[:50])
        if master:
            master.decommission_date = _stamp(body.decommission_date)
    else:
        master = db.get(models.Cathode, body.serial.strip()[:50])
        if master:
            master.decommission_date = _stamp(body.decommission_date)
    upsert_state(
        db,
        body.element_kind,
        body.serial,
        lifecycle_status="decommissioned",
        company_id=None,
        open_dispatch_id=None,
    )
    log_event(
        db,
        body.element_kind,
        body.serial,
        "decommission",
        body.decommission_date,
        f"Decommissioned — {body.reason}",
        ref_kind="decommission",
        ref_id=row.id,
        details={"reason": body.reason},
    )
    db.commit()
    return {"id": row.id}


@router.get("/search")
def lifecycle_search(
    element_kind: str | None = None,
    serial: str | None = None,
    lifecycle_status: str | None = None,
    company_id: int | None = None,
    send_no: str | None = None,
    receive_no: str | None = None,
    purchase_no: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    _: models.User = _access,
):
    return search_lifecycle(
        db,
        element_kind=element_kind,
        serial=serial,
        lifecycle_status=lifecycle_status,
        company_id=company_id,
        send_no=send_no,
        receive_no=receive_no,
        purchase_no=purchase_no,
        date_from=date_from,
        date_to=date_to,
    )
