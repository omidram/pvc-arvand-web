"""HTTP-level smoke test of /un-ce/* on the synthetic data set (temp SQLite, no auth)."""
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.database import get_db  # noqa: E402
from app.routers import un_ce  # noqa: E402
import _ucv_compare as C  # noqa: E402
import _ucv_dataset as DS  # noqa: E402

path = os.path.join(tempfile.gettempdir(), "ucv_api.db")
if os.path.exists(path):
    os.remove(path)
engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
models.Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
with Session() as db:
    C.load_dataset(db, DS.build())
    C.apply_scenario(db, "default", C.ORACLE["scenarios"]["default"])

app = FastAPI()
app.include_router(un_ce.router)


def override():
    db = Session()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override
client = TestClient(app)

checks = [
    ("GET", "/un-ce/settings", None),
    ("GET", "/un-ce/options", None),
    ("GET", "/un-ce/un", {"scope": "plant", "table": "1"}),
    ("GET", "/un-ce/un", {"scope": "train", "calc": "all", "table": "2"}),
    ("GET", "/un-ce/un", {"scope": "electrolyzer", "calc": "individual", "electrolyzers": "A1"}),
    ("GET", "/un-ce/un", {"scope": "group", "calc": "several", "groups": "1,2"}),
    ("GET", "/un-ce/un", {"scope": "element", "calc": "individual", "elements": "A1:5"}),
    ("GET", "/un-ce/un", {"scope": "element", "calc": "individual", "table": "2"}),
    ("GET", "/un-ce/ce", {"scope": "plant", "basis": "anodic"}),
    ("GET", "/un-ce/ce", {"scope": "electrolyzer", "basis": "anodic"}),
    ("GET", "/un-ce/ce", {"scope": "train", "basis": "naoh"}),
    ("GET", "/un-ce/ce", {"scope": "group", "basis": "anodic"}),
    ("GET", "/un-ce/ce", {"scope": "element", "basis": "anodic", "calc": "several", "elements": "A1:5,A2:7"}),
    ("GET", "/un-ce/spc", {"scope": "electrolyzer"}),
    ("GET", "/un-ce/spc", {"scope": "plant"}),
]
bad = 0
for method, url, params in checks:
    r = client.request(method, url, params=params)
    body = r.json()
    n = len(body["rows"]) if isinstance(body, dict) and "rows" in body else "-"
    print(r.status_code, url, params, "rows:", n)
    bad += r.status_code != 200

r = client.get("/un-ce/ce", params={"scope": "group", "calc": "individual"})
print(r.status_code, r.json(), "(expected 422)")
r = client.put("/un-ce/settings", json={"iref": 4, "area_m2": 2.72, "umin": 0.2, "anodic_correction": 0.05, "clo_analysis": 1, "temp_correction_element": 1, "acidified": False})
print(r.status_code, {k: r.json()[k] for k in ("iref", "tkorr", "ckorr", "clo_analysis", "acidified", "temp_correction_element")})
sys.exit(1 if bad else 0)
