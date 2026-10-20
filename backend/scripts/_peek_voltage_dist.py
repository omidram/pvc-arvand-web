from sqlalchemy import func, text

from app.database import SessionLocal
from app import models
from app.routers.voltage import high_deviation_elements, voltage_distribution

db = SessionLocal()
print(
    "els",
    db.query(models.VoltageReading.electrolyzer, func.count())
    .filter(models.VoltageReading.voltage.isnot(None))
    .group_by(models.VoltageReading.electrolyzer)
    .order_by(func.count().desc())
    .limit(15)
    .all(),
)
print(
    "with Un",
    db.query(func.count()).filter(models.VoltageReading.standardized_voltage.isnot(None)).scalar(),
)
print(
    "with voltage",
    db.query(func.count()).filter(models.VoltageReading.voltage.isnot(None)).scalar(),
)
print("sample", db.query(models.VoltageReading).filter(models.VoltageReading.voltage.isnot(None)).limit(3).all())
for el in (None, "1A", "A", "H"):
    d = voltage_distribution(electrolyzer=el, db=db)
    print("dist", el, "total", d["total_readings"], "nonzero buckets", sum(1 for b in d["buckets"] if b["count"]))
h = high_deviation_elements(electrolyzer="1A", db=db)
print("high 1A", h["average"], "flagged", len(h["flagged"]))
# latest norms for 1A
norms = (
    db.query(models.ElectrolyzerNormalization)
    .filter(models.ElectrolyzerNormalization.electrolyzer == "1A")
    .order_by(models.ElectrolyzerNormalization.date.desc())
    .limit(3)
    .all()
)
print("norms 1A", [(n.normalization_nr, n.date, n.total_voltage, n.element_count) for n in norms])
db.close()
