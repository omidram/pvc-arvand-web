import sqlite3
from pathlib import Path
from statistics import mean, pstdev

c = sqlite3.connect(Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db")
for t in [
    "acc_tblgewelektrolyseureuncespc",
    "acc_tblgewelementeuncespc",
    "acc_tblgewgruppenuncespc",
]:
    cols = [r[1] for r in c.execute(f"PRAGMA table_info({t})")]
    n = c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    print(t, n, cols)
    for r in c.execute(f"SELECT * FROM {t} LIMIT 3").fetchall():
        print(" ", r)

# Sample stats from normalizations for power form
rows = c.execute(
    """
    SELECT electrolyzer, total_current, reference_current_density, total_voltage, element_count
    FROM electrolyzer_normalizations
    WHERE date IS NOT NULL AND electrolyzer IS NOT NULL
    LIMIT 5
    """
).fetchall()
print("norm sample", rows)
