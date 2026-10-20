from sqlalchemy import text

from app.database import SessionLocal
from app.routers.voltage import _filter_electrolyzer, _latest_readings
from app import models
from sqlalchemy import func, or_

db = SessionLocal()
print(
    db.execute(
        text(
            """
            SELECT date, COUNT(1) AS c
            FROM voltage_readings
            WHERE UPPER(electrolyzer) IN ('1A','A1') AND voltage IS NOT NULL
            GROUP BY date
            ORDER BY date DESC
            LIMIT 5
            """
        )
    ).fetchall()
)
print(
    db.execute(
        text(
            """
            SELECT electrolyzer, date, voltage, standardized_voltage
            FROM voltage_readings
            WHERE UPPER(electrolyzer) IN ('1A','A1')
            ORDER BY date DESC
            LIMIT 5
            """
        )
    ).fetchall()
)
max_date = (
    db.query(func.max(models.VoltageReading.date))
    .filter(
        or_(
            models.VoltageReading.standardized_voltage.isnot(None),
            models.VoltageReading.voltage.isnot(None),
        )
    )
)
max_date = _filter_electrolyzer(max_date, models.VoltageReading.electrolyzer, "1A").scalar()
print("orm max", max_date, type(max_date))
q = db.query(models.VoltageReading).filter(
    or_(
        models.VoltageReading.standardized_voltage.isnot(None),
        models.VoltageReading.voltage.isnot(None),
    )
)
q = _filter_electrolyzer(q, models.VoltageReading.electrolyzer, "1A")
print("orm count all", q.count())
if max_date is not None:
    print("orm count on max", q.filter(models.VoltageReading.date == max_date).count())
    print("orm count date date()", q.filter(func.date(models.VoltageReading.date) == func.date(max_date)).count())
dte, rows = _latest_readings(db, "1A")
print("helper", dte, len(rows))
db.close()
