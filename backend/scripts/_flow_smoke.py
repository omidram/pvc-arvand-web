"""Element Workflow flowchart: decommission decision, relocation, segregation classification, cross-checks (temp SQLite DB)."""
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
from app import element_flow, models, workflow_models  # noqa: E402,F401
from app.auth import get_current_user  # noqa: E402
from app.database import get_db  # noqa: E402
from app.routers import element_dashboard as router  # noqa: E402
from app.segregation_flow import classify  # noqa: E402

# ---------------- classifier
c = classify("قابل استفاده", None, None, "قابل استفاده - کیفیت خوب")
assert (c["outcome"], c["quality"], c["destination"]) == ("reusable", "good", "assembly"), c
assert classify(None, None, None, "قابل استفاده - کیفیت متوسط")["quality"] == "medium"
assert classify(None, None, None, "قابل استقاده - پوشش متوسط")["outcome"] == "reusable"  # typo in the data
c = classify("گارانتی دنورا", "گارانتی", None, "پوشش مجدد")
assert (c["outcome"], c["warranty"], c["vendor"], c["destination"]) == ("coating_problem", True, "Denora", "vendor"), c
assert c["steps"] == ["segregation", "not_reusable", "coating", "warranty", "vendor", "warehouse"]
c = classify("گارانتی آتیه پردازان", None, None, None)
assert c["vendor"] == "Atiyeh Pardazan Sharif"
c = classify("بدون گارانتی", "بدون گارانتی", None, "پوشش مجدد")
assert (c["outcome"], c["warranty"], c["destination"]) == ("coating_problem", False, "warehouse")
c = classify("تعمیر مکانیکی", None, None, None)
assert (c["outcome"], c["warranty"]) == ("mechanical_problem", None) and c["steps"][-2:] == ["no_warranty", "warehouse"]
c = classify("گارانتی دنورا", None, None, "پوشش تحت گارانتی دنورا - مکانیکی غیرگارانتی")
assert (c["outcome"], c["warranty"]) == ("mechanical_problem", False), c
assert classify("بدنه خارج از رده", None, None, "RATE OFF")["outcome"] == "rate_off"
assert classify("بلاتکلیف", None, None, None)["outcome"] == "undecided"
assert classify(None, None, None, None)["outcome"] == "undecided"

# ---------------- temp database
tmp = Path(tempfile.mkdtemp(prefix="flow_smoke_"))
engine = create_engine(f"sqlite:///{tmp / 'flow.db'}", connect_args={"check_same_thread": False})
models.Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
today = date.today()
old = today - timedelta(days=400)
with Session() as db:
    db.add(models.User(username="u", full_name="U", password_hash="x", role="admin"))
    db.add(models.GroupDefinition(group_nr="1"))
    for n in ("A-1", "A-2", "A-3", "A-4"):
        db.add(models.Anode(anode_nr=n))
    for n in ("K-1", "K-2", "K-3", "K-4"):
        db.add(models.Cathode(cathode_nr=n))
    for n in ("M-1", "M-2", "M-3", "M-4"):
        db.add(models.Membrane(membrane_nr=n))
    # E1: switched off yesterday (healthy cell)  E2: running in a cell we will move E1 to  E3: switched off + disassembled recently
    db.add(models.Element(element_nr="101", electrolyzer="A1", position="001", group_nr="1", anode_nr="A-1", cathode_nr="K-1", membrane_nr="M-1", assembly_date=old, commissioning_date=old, decommissioning_date=today - timedelta(days=1)))
    db.add(models.Element(element_nr="102", electrolyzer="B1", position="002", group_nr="1", anode_nr="A-2", cathode_nr="K-2", membrane_nr="M-2", assembly_date=old, commissioning_date=old))
    db.add(models.Element(element_nr="103", electrolyzer="C1", position="003", group_nr="1", anode_nr="A-3", cathode_nr="K-3", membrane_nr="M-3", assembly_date=old, commissioning_date=old, decommissioning_date=today - timedelta(days=30), disassembly_date=today - timedelta(days=20)))
    # segregation: A-3 needs recoating without warranty, K-3 reusable good; A-4 under warranty without a vendor name
    db.add(models.ElectrodeSegregation(serial_nr="A-3", electrode_kind="anode", disassemble_date=today - timedelta(days=20), inspection_date=today - timedelta(days=10), decision="بدون گارانتی", segregation="پوشش مجدد"))
    db.add(models.ElectrodeSegregation(serial_nr="A-4", electrode_kind="anode", inspection_date=today - timedelta(days=10), decision="گارانتی", segregation="پوشش مجدد"))
    db.commit()

app = FastAPI()
app.include_router(router.router)


def _db():
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _user():
    with Session() as db:
        u = db.query(models.User).first()
        db.expunge(u)
        return u


app.dependency_overrides[get_db] = _db
app.dependency_overrides[get_current_user] = _user
client = TestClient(app)


def item(nr):
    dash.clear_cache()
    r = client.get("/element-dashboard/shop", params={"state": "all", "element_nr": nr}).json()
    return r["items"][0]


# ---------------- decommission decision
assert item("101")["state"] == "decommissioned" and item("101")["source"] == "derived"  # no longer auto-moved to disassembly
assert client.post("/element-dashboard/shop/advance", json={"element_nr": "101"}).status_code == 400  # must choose keep / relocate / disassemble
assert client.post("/element-dashboard/shop/decide", json={"element_nr": "102", "choice": "keep"}).status_code == 400  # still running
assert client.post("/element-dashboard/shop/decide", json={"element_nr": "101", "choice": "maybe"}).status_code == 400
assert client.post("/element-dashboard/shop/decide", json={"element_nr": "101", "choice": "keep"}).status_code == 200
assert item("101")["state"] == "ready" and item("101")["base_state"] == "decommissioned"
assert client.post("/element-dashboard/shop/decide", json={"element_nr": "101", "choice": "disassemble"}).status_code == 200
assert item("101")["state"] == "awaiting_disassembly"
assert client.post("/element-dashboard/shop/decide", json={"element_nr": "101", "choice": "keep"}).status_code == 200

# ---------------- relocation of the healthy cell to a new position
base = {"element_nr": "101", "date": today.isoformat()}
r = client.post("/element-dashboard/shop/relocate", json={**base, "electrolyzer": "B1", "position": "002"})
assert r.status_code == 409 and "occupied" in r.json()["detail"], r.text
assert client.post("/element-dashboard/shop/relocate", json={**base, "electrolyzer": "ZZ", "position": "005"}).status_code == 400
assert client.post("/element-dashboard/shop/relocate", json={**base, "electrolyzer": "D1", "position": "500"}).status_code == 400
assert client.post("/element-dashboard/shop/relocate", json={"element_nr": "102", "electrolyzer": "D1", "position": "005"}).status_code == 400  # running element
r = client.post("/element-dashboard/shop/relocate", json={**base, "electrolyzer": "D1", "position": "5", "note": "balancing"})
assert r.status_code == 200, r.text
with Session() as db:
    rows = db.query(models.Element).filter_by(element_nr="101").order_by(models.Element.id).all()
    assert len(rows) == 2
    first, second = rows
    assert first.disassembly_date == today and first.decommissioning_date is not None
    assert (second.electrolyzer, second.position, second.anode_nr, second.cathode_nr, second.membrane_nr) == ("D1", "005", "A-1", "K-1", "M-1")
    assert second.assembly_date == today and second.disassembly_date is None and second.decommissioning_date is None
    assert db.query(models.ElementShopState).count() == 0
    assert db.query(models.ElementShopEvent).filter_by(to_stage="relocated").count() == 1
assert item("101")["state"] == "installed"  # assigned, waits for start-up

# ---------------- flow overview and checks
dash.clear_cache()
ov = client.get("/element-dashboard/flow").json()
assert ov["electrodes"]["coating_no_warranty"]["anode"] == 1, ov["electrodes"]
assert ov["electrodes"]["coating_warranty"]["anode"] == 1
assert ov["issues"]["warranty_no_vendor"] == 1, ov["issues"]
lst = client.get("/element-dashboard/flow/list", params={"node": "coating_no_warranty"}).json()
assert [i["serial"] for i in lst["items"]] == ["A-3"] and lst["items"][0]["steps"][-1] == "warehouse"
# 103 was taken apart 20 days ago; K-3 has no decision -> flagged, A-3 has one -> not flagged
miss = client.get("/element-dashboard/flow/list", params={"node": "issue:disassembled_no_decision"}).json()["items"]
assert {i["serial"] for i in miss} >= {"K-3"} and "A-3" not in {i["serial"] for i in miss}, miss
# A-3 needs recoating, yet the warehouse board must not call it OK any more
with Session() as db:
    row = next(r for r in dash.electrode_rows(db, "anode")[0] if r["key"] == "A-3")
    assert row["bucket"] == "not_ok" and row["reason"] == "segregation", row
    cand = dash.coating_overview(db, "anode")["candidates"]
    assert any(c["key"] == "A-3" and "segregation_problem" in c["reasons"] for c in cand), cand

print("ALL ELEMENT FLOW CHECKS PASSED")
