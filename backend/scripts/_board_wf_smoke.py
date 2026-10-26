"""Live board <-> recoating workflow link (temp SQLite DB)."""
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
from app.routers import storage as st_router  # noqa: E402
from app.routers import workflow as wf_router  # noqa: E402
from app.routers import warehouse_lifecycle as wl_router  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="board_smoke_"))
engine = create_engine(f"sqlite:///{tmp / 'b.db'}", connect_args={"check_same_thread": False})
models.Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
today = date.today()
old = today - timedelta(days=400)

with Session() as db:
    for name, perms in {
        "store": {"storage": "edit", "wf_warehouse": "edit"},
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
    db.add(models.Element(element_nr="201", electrolyzer="A1", position="001", anode_nr="A-1", cathode_nr="K-1", assembly_date=old, commissioning_date=old))
    db.add(models.Element(element_nr="205", electrolyzer="A1", position="005", anode_nr="A-5", cathode_nr="K-5", assembly_date=old, commissioning_date=old, disassembly_date=old + timedelta(days=30)))
    db.add(models.WhCompany(name="CoatCo", is_coating=True, is_supplier=False))
    db.commit()
    proc_id = db.query(models.User).filter_by(username="proc").one().id

app = FastAPI()
for r in (st_router.router, wf_router.router, wl_router.router):
    app.include_router(r)
current = {"name": "store"}


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


def board_item(kind, serial):
    data = ok(client.get("/storage/board", params={"kind": kind, "bucket": "all"}))
    return next(i for i in data["items"] if i["serial"] == serial)


def move(serial, action, kind="anode", code=200, note=None):
    return ok(client.post("/storage/board/move", json={"kind": kind, "serial": serial, "action": action, "note": note}), code)


# mounted pieces cannot go out
assert "mounted" in move("A-1", "dispatch_recoating", code=400)["detail"]

first = move("A-5", "dispatch_recoating", note="coating worn")
assert first["wf_code"] and first["added"] is False, first
second = move("A-6", "dispatch_recoating")
assert second["wf_id"] == first["wf_id"] and second["added"] is True, second
again = move("A-5", "dispatch_recoating")
assert again["already"] and again["wf_code"] == first["wf_code"]
cath = move("K-6", "dispatch_recoating", kind="cathode")
assert cath["wf_id"] == first["wf_id"] and cath["wf_code"] != first["wf_code"], "cathodes go on their own pallet"

item = board_item("anode", "A-5")
assert item["wf_code"] == first["wf_code"] and item["wf_status"] == "await_company", item
print("board shows request:", item["wf_code"], item["bucket"])

current["name"] = "proc"
cart = ok(client.get("/workflow/cartable"))
assert any(r["flow"] == "coating" and r["id"] == first["wf_id"] for r in cart), cart
assert ok(client.get("/workflow/summary"))["unread"] >= 1
detail = ok(client.get(f"/workflow/coating/{first['wf_id']}"))
assert detail["anode_count"] == 2 and detail["cathode_count"] == 1, detail
assert any(e["action"] == "board_add" for e in detail["events"])
print("cartable + notification for procurement OK")

current["name"] = "admin"
wid = first["wf_id"]
with Session() as db:
    co = db.query(models.WhCompany).first().id
    for a, c in (("A-5", None), ("A-6", "K-6")):
        db.add(models.InspectionReport(anode_nr=a, cathode_nr=c, inspection_date=today))
    db.commit()
ok(client.post(f"/workflow/coating/{wid}/company", json={"company_id": co}))
ok(client.post(f"/workflow/coating/{wid}/indent", json={"indent_no": "IND-1"}))
ok(client.post(f"/workflow/coating/{wid}/dispatch", json={"dispatch_date": today.isoformat(), "expected_return_date": (today + timedelta(days=20)).isoformat()}))
item = board_item("anode", "A-5")
assert item["bucket"] == "out_repair" and item["repair"] == "recoating", item
assert "cartable" in move("A-5", "return", code=400)["detail"].lower()
ok(client.post(f"/workflow/coating/{wid}/receive", json={"actual_date": today.isoformat(), "warranty_start": today.isoformat()}))
assert board_item("anode", "A-5")["bucket"] == "pending"
print("board follows the workflow: at coater -> out_repair, received -> pending")

current["name"] = "store"
move("K-4", "dispatch_maintenance", kind="cathode")
tl = ok(client.get("/warehouse-lifecycle/elements/cathode/K-4/timeline"))
assert any(e["event_type"] == "maintenance_dispatch" for e in tl["events"]), tl
print("board actions show in element history")
print("ALL OK")
