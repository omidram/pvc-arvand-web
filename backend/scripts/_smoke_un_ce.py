"""Smoke-run the Un / CE engine against the local DB (read-only)."""
import json
import time

from app.database import SessionLocal
from app import un_ce_engine as eng

db = SessionLocal()
cfg = eng.load_cfg(db)
print("cfg", cfg)
d0, d1 = eng.parse_day("2026-09-25"), eng.parse_day("2026-10-12")


def show(name, fn):
    t = time.time()
    res = fn()
    print(f"{name}: {len(res.rows)} rows in {time.time() - t:.2f}s")
    for r in res.rows[:3]:
        print("   ", json.dumps(r, ensure_ascii=False))


show("un electrolyzer t1", lambda: eng.un_electrolyzer_rows(db, cfg, table="1", d0=d0, d1=d1, els=None))
show("un electrolyzer t2", lambda: eng.un_electrolyzer_rows(db, cfg, table="2", d0=d0, d1=d1, els=None))
show("un plant t1", lambda: eng.un_plant_rows(db, cfg, table="1", d0=d0, d1=d1))
show("un plant t2", lambda: eng.un_plant_rows(db, cfg, table="2", d0=d0, d1=d1))
show("un train t1", lambda: eng.un_train_rows(db, cfg, table="1", d0=d0, d1=d1, trains=None))
show("un element t1 A2:5", lambda: eng.un_element_rows(db, cfg, table="1", d0=d0, d1=d1, elements={("A2", "5")}))
show("un group t1 all", lambda: eng.un_group_rows(db, cfg, table="1", calc="all", d0=d0, d1=d1, groups=None))
show("ce electrolyzer", lambda: eng.ce_electrolyzer_rows(db, cfg, d0=None, d1=None, els=None))
show("ce plant", lambda: eng.ce_plant_rows(db, cfg, d0=None, d1=None))
show("ce train", lambda: eng.ce_train_rows(db, cfg, d0=None, d1=None, trains=None))
show("ce naoh plant", lambda: eng.ce_naoh_rows(db, cfg, scope="electrolyzer", d0=None, d1=None, refs=None))
show("spc electrolyzer", lambda: eng.spc_electrolyzer_rows(db, cfg, un_table="1", ce_basis="anodic", d0=None, d1=None, els=None))
