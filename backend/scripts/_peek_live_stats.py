"""Validate live snapshot after same-day filter + online field."""
from app.database import SessionLocal
from app.alerts_engine import voltage_live_stats, build_snapshot
from app.schemas import MonitoringSnapshot

db = SessionLocal()
stats = voltage_live_stats(db)
print("DASH", stats.get("plant_total_ka"), "kA", stats.get("plant_energy_kwh_24h"), "kWh", "cells", stats.get("cell_count"), "online", stats.get("online_count"))
print("  voltage_shown", stats.get("plant_total_voltage"), "(API leftover, UI hidden)")

data = build_snapshot(db, evaluate=False)
snap = MonitoringSnapshot.model_validate(data)
print("SNAP ka", snap.voltage.get("current_ka"), "kWh", snap.voltage.get("energy_kwh_24h"), "cells", snap.voltage.get("cell_count"))
for name in ("A1", "M1", "A2", "K2", "L2", "M2"):
    block = next((b for b in snap.electrolyzers if b.electrolyzer == name), None)
    if not block:
        print(" missing", name)
        continue
    print(
        f"  {name} online={block.online} cells={block.cell_count} "
        f"kA={block.current_ka} avgV={block.avg_voltage} kWh={block.energy_kwh_24h}"
    )
db.close()
