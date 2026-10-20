"""Look up the coating on the record opened in the form."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Element

db = SessionLocal()
rows = (
    db.query(Element)
    .filter(Element.element_nr == "5028", Element.anode_nr == "LA0683")
    .all()
)
for row in rows:
    print(row.id, row.anode_coating, "|", row.cathode_coating)
db.close()
