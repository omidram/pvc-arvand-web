import sqlite3
from pathlib import Path

db = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
con = sqlite3.connect(db)
cur = con.cursor()
print("tables", [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%shutdown%'"
).fetchall()])
for t in ["shutdown_causes", "shutdown_categories", "shutdowns"]:
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})")]
    n = cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    print(t, cols, "count", n)
    for r in cur.execute(f"SELECT * FROM {t} LIMIT 40").fetchall():
        print(" ", r)
print("plant_parts", cur.execute(
    "SELECT DISTINCT plant_part FROM shutdowns ORDER BY 1"
).fetchall())
try:
    print("settings", cur.execute("SELECT * FROM plant_settings").fetchall())
except Exception as e:
    print("settings err", e)
