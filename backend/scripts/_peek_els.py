import sqlite3
from pathlib import Path

c = sqlite3.connect(Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db")
print("electrolyzers", [r[0] for r in c.execute("SELECT name FROM electrolyzers ORDER BY 1").fetchall()])
print("tables un/ce", [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND ("
    "name LIKE '%effic%' OR name LIKE '%normal%' OR name LIKE '%balance%' OR name LIKE '%un_%' OR name='voltage_readings')"
).fetchall()])
for t in ["current_efficiency_entries", "electrolyzer_normalizations", "voltage_readings"]:
    try:
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})")]
        n = c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(t, n, cols[:20])
        for r in c.execute(f"SELECT * FROM {t} LIMIT 2").fetchall():
            print(" ", r[:12])
    except Exception as e:
        print(t, e)
