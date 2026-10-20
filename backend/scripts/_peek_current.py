import sqlite3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
print("db", p.exists(), p.stat().st_size)
con = sqlite3.connect(str(p))
cur = con.cursor()
print(
    "tables",
    [
        r[0]
        for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%norm%' OR name LIKE '%rect%' OR name LIKE '%voltage%')"
        ).fetchall()
    ],
)
print("--- normalizations ---")
print(cur.execute("SELECT COUNT(*) FROM electrolyzer_normalizations").fetchone()[0], "rows")
print(
    "with current",
    cur.execute(
        "SELECT COUNT(*) FROM electrolyzer_normalizations WHERE total_current IS NOT NULL AND total_current>0"
    ).fetchone()[0],
)
print(
    "with total_v",
    cur.execute(
        "SELECT COUNT(*) FROM electrolyzer_normalizations WHERE total_voltage IS NOT NULL AND total_voltage>0"
    ).fetchone()[0],
)
print(
    "els",
    cur.execute(
        """
        SELECT electrolyzer, COUNT(*) n,
               SUM(CASE WHEN total_current>0 THEN 1 ELSE 0 END) cur,
               MIN(date), MAX(date)
        FROM electrolyzer_normalizations
        GROUP BY electrolyzer
        ORDER BY electrolyzer
        """
    ).fetchall(),
)
print(
    "sample with current",
    cur.execute(
        """
        SELECT electrolyzer, date, time, total_voltage, total_current, anolyte_temp
        FROM electrolyzer_normalizations
        WHERE total_current>0
        ORDER BY date DESC
        LIMIT 8
        """
    ).fetchall(),
)
print("--- rectifier ---")
try:
    print("rows", cur.execute("SELECT COUNT(*) FROM rectifier_readings").fetchone()[0])
    print(
        "with ka",
        cur.execute("SELECT COUNT(*) FROM rectifier_readings WHERE current_ka>0").fetchone()[0],
    )
    print(
        cur.execute(
            """
            SELECT electrolyzer, COUNT(*),
                   SUM(CASE WHEN current_ka>0 THEN 1 ELSE 0 END),
                   MIN(date), MAX(date)
            FROM rectifier_readings
            GROUP BY electrolyzer
            ORDER BY electrolyzer
            """
        ).fetchall()
    )
    print(
        cur.execute(
            """
            SELECT electrolyzer, date, time, voltage_vdc, current_ka
            FROM rectifier_readings
            WHERE current_ka>0
            ORDER BY date DESC
            LIMIT 8
            """
        ).fetchall()
    )
except Exception as exc:
    print("rect err", exc)
con.close()
