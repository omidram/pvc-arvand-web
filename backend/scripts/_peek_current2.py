import sqlite3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
con = sqlite3.connect(str(p))
cur = con.cursor()
print("times", cur.execute("SELECT time, COUNT(*) FROM electrolyzer_normalizations WHERE electrolyzer IN ('A1','A2') GROUP BY time ORDER BY 2 DESC").fetchall())
print("A1 last dates", cur.execute("SELECT date, time, total_voltage, total_current FROM electrolyzer_normalizations WHERE electrolyzer='A1' ORDER BY date DESC, time DESC LIMIT 12").fetchall())
print("A2 last dates", cur.execute("SELECT date, time, total_voltage, total_current FROM electrolyzer_normalizations WHERE electrolyzer='A2' ORDER BY date DESC, time DESC LIMIT 8").fetchall())
print("current range", cur.execute("SELECT MIN(total_current), MAX(total_current), AVG(total_current) FROM electrolyzer_normalizations WHERE total_current>1").fetchone())
print("voltage range", cur.execute("SELECT MIN(total_voltage), MAX(total_voltage), AVG(total_voltage) FROM electrolyzer_normalizations WHERE total_voltage>50").fetchone())
print("readings A1 sample positions", cur.execute("SELECT MIN(CAST(position AS INT)), MAX(CAST(position AS INT)), COUNT(*) FROM voltage_readings WHERE electrolyzer='A1' AND date>='2026-06-01'").fetchone())
print("train1 latest", cur.execute("SELECT electrolyzer, MAX(date) FROM electrolyzer_normalizations WHERE electrolyzer LIKE '%1' AND length(electrolyzer)=2 GROUP BY electrolyzer").fetchall())
con.close()
