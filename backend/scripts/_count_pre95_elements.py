"""Count Assembly Data rows before Jalali 1395-01-01 (C90 / assembly_date)."""
from collections import Counter
from datetime import date

from app.database import SessionLocal
from app.models import Element
from app.plant_import import jalali_to_gregorian

cutoff = jalali_to_gregorian(1395, 1, 1)
print("cutoff jalali 1395/01/01 =", cutoff)

db = SessionLocal()
rows = db.query(Element.id, Element.element_nr, Element.assembly_date, Element.electrolyzer).all()
total = len(rows)
null_date = 0
before = []
on_or_after = 0
years = Counter()
for rid, nr, ad, elz in rows:
    if ad is None:
        null_date += 1
        continue
    years[ad.year] += 1
    if ad < cutoff:
        before.append((rid, nr, ad, elz))
    else:
        on_or_after += 1

print("total", total)
print("null assembly_date", null_date)
print("before 1395", len(before))
print("from 1395+", on_or_after)
print("gregorian years", dict(sorted(years.items())))
print("earliest before", min((r[2] for r in before), default=None), "latest before", max((r[2] for r in before), default=None))
print("sample before", before[:8])
db.close()
