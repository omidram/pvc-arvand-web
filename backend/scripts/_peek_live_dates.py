"""Latest AriaORMS / voltage dates for live-day filtering."""
from collections import Counter
from datetime import datetime

from sqlalchemy import func

from app.database import SessionLocal
from app.models import ElectrolyzerNormalization, VoltageReading

db = SessionLocal()
today = datetime.utcnow().date()
print("utc today", today)

print("\nvoltage_readings latest date per electrolyzer")
rows = (
    db.query(
        VoltageReading.electrolyzer,
        func.max(VoltageReading.date),
        func.count(VoltageReading.id),
    )
    .filter(VoltageReading.voltage.isnot(None))
    .group_by(VoltageReading.electrolyzer)
    .all()
)
for el, mx, n in sorted(rows, key=lambda r: str(r[0])):
    day = mx.date() if hasattr(mx, "date") else mx
    print(f"  {el:4} last={day} n={n} today={day == today if day else None}")

print("\nnormalizations latest date/current")
rows = (
    db.query(
        ElectrolyzerNormalization.electrolyzer,
        func.max(ElectrolyzerNormalization.date),
        func.max(ElectrolyzerNormalization.total_current),
    )
    .group_by(ElectrolyzerNormalization.electrolyzer)
    .all()
)
for el, mx, ka in sorted(rows, key=lambda r: str(r[0] or "")):
    day = mx.date() if hasattr(mx, "date") else mx
    print(f"  {el:4} last={day} max_ka={ka} today={day == today if day else None}")

for el in ("L2", "M2"):
    print(f"\n{el} last 5 norms")
    for row in (
        db.query(ElectrolyzerNormalization)
        .filter(ElectrolyzerNormalization.electrolyzer == el)
        .order_by(ElectrolyzerNormalization.date.desc(), ElectrolyzerNormalization.time.desc())
        .limit(5)
    ):
        print(" ", row.date, row.time, "V", row.total_voltage, "kA", row.total_current)

print("\nvoltage_readings last date overall", db.query(func.max(VoltageReading.date)).scalar())
print("norms last date overall", db.query(func.max(ElectrolyzerNormalization.date)).scalar())
db.close()
