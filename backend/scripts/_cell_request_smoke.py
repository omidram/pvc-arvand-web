"""Cell removal workflow: operation -> cell shop, notifications, Assembly Data sync, element pipeline sync (temp SQLite DB)."""
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

from app import element_dashboard as dash  # noqa: E402
from app import models, workflow_models as wm  # noqa: E402
from app.auth import get_current_user  # noqa: E402
from app.database import get_db  # noqa: E402
from app.routers import element_dashboard as ed_router  # noqa: E402
from app.routers import elements as el_router  # noqa: E402
from app.routers import workflow as wf_router  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="cell_smoke_"))
engine = create_engine(f"sqlite:///{tmp / 'cell.db'}", connect_args={"check_same_thread": False})
models.Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
today = date.today()
old = today - timedelta(days=400)

with Session() as db:
    roles = {}
    for name, perms in {
        "op": {"elements": "view", "wf_operation": "edit"},
        "shop": {"elements": "view", "wf_cellshop": "edit"},
        "viewer": {"elements": "view"},
        "editor": {"elements": "edit"},
    }.items():
        role = models.AppRole(name=name)
        db.add(role)
        db.flush()
        for k, v in perms.items():
            db.add(models.RolePermission(role_id=role.id, form_key=k, level=v))
        roles[name] = role.id
        db.add(models.User(username=name, full_name=name.title(), password_hash="x", role="user", role_id=role.id, is_active=True))
    db.add(models.User(username="admin", full_name="Admin", password_hash="x", role="admin", is_active=True))
    db.add(models.GroupDefinition(group_nr="1"))
    for i in range(1, 6):
        db.add(models.Anode(anode_nr=f"A-{i}"))
        db.add(models.Cathode(cathode_nr=f"K-{i}"))
        db.add(models.Membrane(membrane_nr=f"M-{i}"))
    # 201 / 202 / 203 run in cells; 204 is waiting for start-up; 205 is already dismantled
    for nr, cell, extra in (
        ("201", ("A1", "001"), {"commissioning_date": old}),
        ("202", ("A1", "002"), {"commissioning_date": old}),
        ("203", ("A1", "003"), {"commissioning_date": old}),
        ("204", ("A1", "004"), {}),
        ("205", ("A1", "005"), {"commissioning_date": old, "decommissioning_date": old + timedelta(days=5), "disassembly_date": old + timedelta(days=9)}),
    ):
        i = nr[-1]
        db.add(models.Element(element_nr=nr, electrolyzer=cell[0], position=cell[1], group_nr="1", anode_nr=f"A-{i}", cathode_nr=f"K-{i}", membrane_nr=f"M-{i}", assembly_date=old, **extra))
    db.commit()
    ids = {u.username: u.id for u in db.query(models.User).all()}

app = FastAPI()
for r in (wf_router.router, ed_router.router, el_router.router):
    app.include_router(r)
current = {"name": "op"}


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


def as_(name):
    current["name"] = name
    return client


def unread(name):
    with Session() as db:
        return db.query(wm.WfNotification).filter_by(user_id=ids[name], read_at=None).count()


def element(nr):
    dash.clear_cache()
    return as_("admin").get("/element-dashboard/shop", params={"state": "all", "element_nr": nr}).json()["items"][0]


# ---------------- who may ask
assert as_("viewer").post("/workflow/cell", json={"element_nr": "201", "reason": "high voltage"}).status_code == 403
assert as_("shop").post("/workflow/cell", json={"element_nr": "201", "reason": "high voltage"}).status_code == 403
assert as_("op").post("/workflow/cell", json={"element_nr": "205", "reason": "x"}).status_code == 409  # dismantled
assert as_("op").post("/workflow/cell", json={"element_nr": "999", "reason": "x"}).status_code == 404
meta = as_("op").get("/workflow/meta").json()
assert meta["can_request_cell"] and meta["can_view_cell"] and not meta["can_view"] and meta["groups"] == ["operation"]

# ---------------- 201: request -> operation switches off -> shop receives -> shop decides (disassemble)
r = as_("op").post("/workflow/cell", json={"element_nr": "201", "reason": "High voltage", "urgent": True, "problem": "U = 3.6 V", "planned_date": today.isoformat()})
assert r.status_code == 200, r.text
req = r.json()
assert req["status"] == "await_shutdown" and req["code"].startswith("CR-") and req["electrolyzer"] == "A1" and req["urgent"]
assert unread("shop") == 1 and unread("op") == 0  # the cell shop is told right away; the requester is the actor
assert as_("op").post("/workflow/cell", json={"element_nr": "201", "reason": "again"}).status_code == 409  # one open request per element
assert element("201")["state"] == "in_service"
assert as_("shop").post(f"/workflow/cell/{req['id']}/shutdown", json={"date": today.isoformat()}).status_code == 403
assert as_("op").post(f"/workflow/cell/{req['id']}/shutdown", json={"date": (old - timedelta(days=1)).isoformat()}).status_code == 400
assert as_("op").post(f"/workflow/cell/{req['id']}/shutdown", json={"date": (today + timedelta(days=1)).isoformat()}).status_code == 400
r = as_("op").post(f"/workflow/cell/{req['id']}/shutdown", json={"date": today.isoformat(), "note": "switched off"})
assert r.status_code == 200 and r.json()["status"] == "await_shop", r.text
with Session() as db:
    el = db.query(models.Element).filter_by(element_nr="201").one()
    assert el.decommissioning_date == today and el.decommission_reason == "High voltage" and el.disassembly_date is None
assert element("201")["state"] == "decommissioned"
assert unread("shop") == 2
cart = as_("shop").get("/workflow/cartable").json()
assert [c["id"] for c in cart if c["flow"] == "cell"] == [req["id"]]
assert as_("op").get("/workflow/cartable").json() == []
assert as_("viewer").post(f"/workflow/cell/{req['id']}/comment", json={"note": "hi"}).status_code == 403
r = as_("shop").post(f"/workflow/cell/{req['id']}/comment", json={"note": "we pick it up at 10:00"})
assert r.status_code == 200 and unread("op") >= 1
assert as_("op").post(f"/workflow/cell/{req['id']}/cancel", json={}).status_code == 409  # switched off already
assert as_("shop").post(f"/workflow/cell/{req['id']}/receive", json={"date": (today - timedelta(days=1)).isoformat()}).status_code == 400
r = as_("shop").post(f"/workflow/cell/{req['id']}/receive", json={"date": today.isoformat()})
assert r.status_code == 200 and r.json()["status"] == "in_shop" and "decide" in r.json()["actions"]
r = as_("shop").post(f"/workflow/cell/{req['id']}/decide", json={"choice": "disassemble", "note": "membrane damaged"})
assert r.status_code == 200 and r.json()["status"] == "completed" and r.json()["decision"] == "disassemble", r.text
assert element("201")["state"] == "awaiting_disassembly"
assert as_("admin").get(f"/workflow/cell/{req['id']}").json()["actions"] == []
assert len(as_("viewer").get("/workflow/cell", params={"element_nr": "201"}).json()) == 1

# ---------------- 202: already switched off when asked; shop decides from the element pipeline (relocate) -> request closes
r = as_("editor").post("/workflow/cell", json={"element_nr": "202", "reason": "Leak", "decommission_date": today.isoformat()})
assert r.status_code == 200 and r.json()["status"] == "await_shop", r.text
req2 = r.json()
r = as_("admin").post("/element-dashboard/shop/relocate", json={"element_nr": "202", "electrolyzer": "B1", "position": "010", "date": today.isoformat()})
assert r.status_code == 200, r.text
d = as_("admin").get(f"/workflow/cell/{req2['id']}").json()
assert d["status"] == "completed" and d["decision"] == "relocated" and d["events"][-1]["data"]["cell"] == "B1-010", d["events"]

# ---------------- 203: switch-off typed straight into Assembly Data opens a request for the cell shop by itself
with Session() as db:
    row203 = db.query(models.Element).filter_by(element_nr="203").one()
    payload = {"element_nr": "203", "decommissioning_date": today.isoformat(), "decommission_reason": "Low CE"}
before = unread("shop")
r = as_("editor").put(f"/elements/{row203.id}", json=payload)
assert r.status_code == 200, r.text
auto = as_("shop").get("/workflow/cell", params={"element_nr": "203", "open_only": True}).json()
assert len(auto) == 1 and auto[0]["status"] == "await_shop" and auto[0]["reason"] == "Low CE", auto
assert unread("shop") == before + 1
# the shop keeps it as a healthy cell from the element cartable -> request done
assert as_("admin").post("/element-dashboard/shop/decide", json={"element_nr": "203", "choice": "keep"}).status_code == 200
assert as_("admin").get(f"/workflow/cell/{auto[0]['id']}").json()["decision"] == "keep"

# ---------------- 204 (installed, not started): request then cancel; then Assembly Data switch-off moves an open request on
r = as_("op").post("/workflow/cell", json={"element_nr": "204", "reason": "Wrong gasket"})
req4 = r.json()
assert as_("shop").post(f"/workflow/cell/{req4['id']}/cancel", json={}).status_code == 409
assert as_("op").post(f"/workflow/cell/{req4['id']}/cancel", json={"note": "fixed"}).json()["status"] == "cancelled"
req4b = as_("op").post("/workflow/cell", json={"element_nr": "204", "reason": "Wrong gasket"}).json()
with Session() as db:
    row204 = db.query(models.Element).filter_by(element_nr="204").one()
r = as_("editor").put(f"/elements/{row204.id}", json={"element_nr": "204", "decommissioning_date": today.isoformat()})
assert r.status_code == 200, r.text
d = as_("op").get(f"/workflow/cell/{req4b['id']}").json()
assert d["status"] == "await_shop" and d["decommission_date"] == today.isoformat(), d
assert len(as_("op").get("/workflow/cell", params={"element_nr": "204", "open_only": True}).json()) == 1  # no duplicate auto-request

# ---------------- coating/purchase lists stay closed to element-only users
assert as_("viewer").get("/workflow/coating").status_code == 403
assert as_("viewer").get("/workflow/summary").status_code == 200

print("ALL CELL REQUEST CHECKS PASSED")
