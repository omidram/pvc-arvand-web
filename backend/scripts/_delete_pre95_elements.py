"""Delete Assembly Data rows whose C90/assembly date is before Jalali 1395."""
from datetime import date

from app.database import SessionLocal
from app.models import Element
from app.plant_import import jalali_to_gregorian

cutoff = jalali_to_gregorian(1395, 1, 1)
db = SessionLocal()
before = db.query(Element).filter(Element.assembly_date.isnot(None), Element.assembly_date < cutoff)
n = before.count()
print("deleting", n, "rows with assembly_date <", cutoff)
before.delete(synchronize_session=False)
db.commit()
left = db.query(Element).count()
nulls = db.query(Element).filter(Element.assembly_date.is_(None)).count()
kept = db.query(Element).filter(Element.assembly_date >= cutoff).count()
print("remaining total", left, "kept from 1395+", kept, "null date", nulls)
db.close()
