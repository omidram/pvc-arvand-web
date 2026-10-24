"""Element inspection workflow + cartable deadlines (temp SQLite DB)."""
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models, workflow_models as wm  # noqa: E402,F401
from app.auth import get_current_user  # noqa: E402
from app.database import get_db  # noqa: E402
from app.routers import elements as el_router  # noqa: E402
from app.routers import inspections as insp_router  # noqa: E402
from app.routers import storage as st_router  # noqa: E402
from app.routers import workflow as wf_router  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="insp_smoke_"))
engine = create_engine(f"sqlite:///{tmp / 'i.db'}", connect_args={"check_same_thread": False})
models.Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
today = date.today()
old = today - timedelta(days=400)

with Session() as db:
    for name, perms in {
        "c90": {"elements": "edit", "storage": "edit", "wf_c90": "edit"},
        "insp": {"inspections": "edit", "wf_inspection": "edit"},
        "proc": {"storage": "view", "wf_procurement": "edit"},
    }.items():
        role = models.AppRole(name=name)
        db.add(role)
        db.flush()
        for k, v in perms.items():
            db.add(models.RolePermission(role_id=role.id, form_key=k, level=v))
        db.add(models.User(username=name, full_name=name.title(), password_hash="x", role="user", role_id=role.id, is_active=True))
    db.add(models.User(username="admin", full_name="Admin", password_hash="x", role="admin", is_active=True))
    for i in range(1, 7):
        db.add(models.Anode(anode_nr=f"A-{i}"))
        db.add(models.Cathode(cathode_nr=f"K-{i}"))
    db.add(models.Element(element_nr="301", electrolyzer="A1", position="001", anode_nr="A-1", cathode_nr="K-1", assembly_date=old, commissioning_date=old))
    db.add(models.Element(element_nr="302", electrolyzer="A1", position="002", anode_nr="A-2", cathode_nr="K-2", assembly_date=old, commissioning_date=old,
                          disassembly_date=old + timedelta(days=30)))
    db.add(models.WhCompany(name="CoatCo", is_coating=True, is_supplier=False))
    db.commit()
    e301 = db.query(models.Element).filter_by(element_nr="301").one().id

app = FastAPI()
for r in (el_router.router, insp_router.router, st_router.router, wf_router.router):
    app.include_router(r)
current = {"name": "c90"}


def _db():
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _user():
    with Session() as db:
        u = db.query(models.User).filter_by(username=current["name"]).first()
        db.expunge(u)
        return u


app.dependency_overrides[get_db] = _db
app.dependency_overrides[get_current_user] = _user
client = TestClient(app)


def ok(res, code=200):
    assert res.status_code == code, (res.status_code, res.text)
    return res.json()


def cart(flow="inspection"):
    return [r for r in ok(client.get("/workflow/cartable")) if r["flow"] == flow]


# dismantling in Assembly Data puts an inspection request in C-90's cartable
ok(client.put(f"/elements/{e301}", json={"decommissioning_date": (today - timedelta(days=2)).isoformat(), "disassembly_date": today.isoformat()}))
mine = cart()
assert len(mine) == 1 and mine[0]["status"] == "await_request" and mine[0]["anode_nr"] == "A-1", mine
req = mine[0]
assert req["sla_state"] == "ok" and req["due_at"], req
current["name"] = "insp"
assert cart() == [], "inspection does not see it before C-90 sends it"
current["name"] = "c90"
ok(client.put(f"/elements/{e301}", json={"remarks": "x"}))
assert len(ok(client.get("/workflow/inspection", params={"open_only": True}))) == 1, "no duplicate on a later save"
print("dismantling -> C-90 cartable:", req["code"])

detail = ok(client.post(f"/workflow/inspection/{req['id']}/send", json={"note": "please inspect"}))
assert detail["status"] == "await_inspection", detail
current["name"] = "insp"
assert [r["id"] for r in cart()] == [req["id"]]
assert ok(client.get("/workflow/summary"))["unread"] >= 1
assert set(ok(client.get(f"/workflow/inspection/{req['id']}"))["actions"]) >= {"fill", "link"}
print("C-90 send -> inspection cartable + notification")

# saving a form filled through the signature closes the request
def filled_form(**over):
    body = {
        "client": "PVC",
        "electrolyzer": "E1",
        "position": "1",
        "operation_days": "10",
        "membrane_nr": "M",
        "membrane_type": "N2030",
        "electrode_nr_anode": "EA",
        "electrode_nr_cathode": "EC",
        "inspection_reason": "Dismantled",
        "blister_anode_area": "0",
        "blister_periphery_top": "0",
        "blister_periphery_bottom": "0",
        "blister_periphery_side": "0",
        "blister_corners": "0",
        "folds": "0",
        "pressure_marks": "0",
        "visible_holes": "0",
        "cracks": "0",
        "xrf_anode": "0",
        "xrf_cathode": "0",
        "deformation_pan": "0",
        "deformation_electrode": "0",
        "coloured_area": "0",
        "coloured_electrode": "0",
        "coloured_pan": "0",
        "leakage_pan": "0",
        "leakage_web": "0",
        "leakage_corner": "0",
        "leakage_outlet": "0",
        "leakage_inlet": "0",
        "sample_cathode_note": "-",
        "sample_anode_note": "-",
        "sample_membrane_note": "-",
        "anode_tube_remark": "-",
        "cathode_tube_remark": "-",
        "anode_spacer_remark": "-",
        "cathode_spacer_remark": "-",
        "frame_gasket_remark": "-",
        "inspector_name": "Insp",
        "sign_insp_name": "Insp",
        "sign_insp_image": "data:image/png;base64,aa",
        "inspection_date": today.isoformat(),
    }
    body.update(over)
    return body

bare = client.post("/inspections", json={"element_nr": "301", "anode_nr": "A-1", "cathode_nr": "K-1"})
assert bare.status_code == 422 and "Signature" in bare.json()["detail"], bare.text
rep = ok(client.post("/inspections", json=filled_form(element_nr="301", anode_nr="A-1", cathode_nr="K-1")), 201)
done = ok(client.get(f"/workflow/inspection/{req['id']}"))
assert done["report"]["id"] == rep["id"] and done["status"] == "await_inspection", done
assert any(ev["action"] == "report_filled" for ev in done["events"])
print("form saved -> report attached; request stays open until both sides confirm")

# recoating pallet: dispatch needs one form per piece
current["name"] = "admin"
for s in ("A-1", "A-2"):
    ok(client.post("/storage/board/move", json={"kind": "anode", "serial": s, "action": "dispatch_recoating"}))
wid = next(r["id"] for r in cart("coating"))
d = ok(client.get(f"/workflow/coating/{wid}"))
assert d["inspections_total"] == 2 and d["inspections_done"] == 1, d
with Session() as db:
    co = db.query(models.WhCompany).first().id
ok(client.post(f"/workflow/coating/{wid}/company", json={"company_id": co}))
ok(client.post(f"/workflow/coating/{wid}/indent", json={"indent_no": "IND-1"}))
body = {"dispatch_date": today.isoformat(), "expected_return_date": (today + timedelta(days=20)).isoformat()}
err = ok(client.post(f"/workflow/coating/{wid}/dispatch", json=body), 409)
assert "A-2" in err["detail"] and "A-1" not in err["detail"].split(":")[-1], err
asked = ok(client.post(f"/workflow/coating/{wid}/request_inspections", json={"note": "pallet"}))
assert asked["created"] == 1, asked
item = next(i for p in asked["detail"]["packages"] for i in p["items"] if i["serial"] == "A-2")
assert item["inspection_request"], item
ok(client.post("/inspections", json=filled_form(element_nr="302", anode_nr="A-2", cathode_nr="K-2")), 201)
ok(client.post(f"/workflow/coating/{wid}/dispatch", json=body))
print("pallet dispatch blocked until every piece has its form")

# deadlines are editable in the settings and turn late
conf = ok(client.get("/workflow/settings"))
assert conf["hours"]["inspection"]["await_request"] == 24, conf
conf["hours"]["inspection"]["await_inspection"] = 1
ok(client.put("/workflow/settings", json={"hours": conf["hours"], "warn_percent": 30}))
current["name"] = "c90"
r2 = ok(client.post("/workflow/inspection", json={"anode_nr": "A-3", "reason": "check"}))
assert r2["status"] == "await_inspection", r2
with Session() as db:
    back = wf_router._now() - timedelta(hours=3)
    db.get(wm.WfInspectionRequest, r2["id"]).created_at = back
    for ev in db.query(wm.WfEvent).filter_by(flow="inspection", record_id=r2["id"]):
        ev.created_at = back
    db.commit()
current["name"] = "insp"
late = next(r for r in cart() if r["id"] == r2["id"])
assert late["sla_state"] == "late" and late["sla_hours"] == 1, late
assert ok(client.get("/workflow/summary"))["late"] >= 1
current["name"] = "proc"
ok(client.put("/workflow/settings", json={"hours": conf["hours"], "warn_percent": 30}), 403)
print("settings deadline -> late badge")
print("ALL OK")
