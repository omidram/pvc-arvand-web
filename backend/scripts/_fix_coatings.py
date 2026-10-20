"""Rewrite shared «آند و کاتد …» coatings into anode-only and cathode-only phrases."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Element
from app.plant_import import split_coating_company

db = SessionLocal()
changed = 0
samples = []
for el in db.query(Element).all():
    anode = el.anode_coating
    cathode = el.cathode_coating
    new_anode = anode
    new_cathode = cathode
    if anode and "آند" in anode and "کاتد" in anode:
        side, _ = split_coating_company(anode)
        if side:
            new_anode = side
    if cathode and "آند" in cathode and "کاتد" in cathode:
        _, side = split_coating_company(cathode)
        if side:
            new_cathode = side
    if new_anode != anode or new_cathode != cathode:
        if len(samples) < 6:
            samples.append((anode, cathode, new_anode, new_cathode))
        el.anode_coating = new_anode
        el.cathode_coating = new_cathode
        changed += 1
db.commit()
left = (
    db.query(Element)
    .filter(Element.anode_coating.contains("آند و کاتد"))
    .count()
)
print("updated", changed, "still shared on anode", left)
for row in samples:
    print(row)
db.close()
