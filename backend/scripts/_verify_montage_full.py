"""Confirm a pre-1395 montage row and the new totals landed in Assembly Data."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Element
from app.warehouse import compact_eq

db = SessionLocal()
total = db.query(Element).count()
old = db.query(Element).filter(Element.assembly_date < "2016-03-20").count()  # before 1395-01-01
print("total", total, "assembly before 1395", old)
row = (
    db.query(Element)
    .filter(compact_eq(Element.anode_nr, "UA30064"), Element.electrolyzer == "B2")
    .first()
)
if row:
    print(
        "UA30064",
        row.element_nr,
        row.position,
        row.assembly_date,
        row.commissioning_date,
        row.disassembly_date,
        row.remarks,
        row.decommission_reason,
        row.membrane_nr,
        row.anode_shell,
    )
l2 = db.query(Element).filter(Element.electrolyzer == "L2", Element.anode_shell.isnot(None)).first()
if l2:
    print("L2 shell", l2.anode_shell, l2.cathode_shell, l2.element_nr)
db.close()
