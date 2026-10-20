import sqlite3

con = sqlite3.connect(r"C:\Users\Omid\Downloads\pvc_arvand_web\backend\instance\pvc_arvand.db")
cur = con.cursor()
tabs = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("el table cols", [r[1] for r in cur.execute("PRAGMA table_info(electrolyzers)")])
print("names", cur.execute("SELECT name FROM electrolyzers ORDER BY name").fetchall())
for t in tabs:
    if "setting" in t.lower() or t == "plant_settings":
        print("tab", t, [r[1] for r in cur.execute(f"PRAGMA table_info({t})")])
        print(cur.execute(f"SELECT * FROM {t} LIMIT 1").fetchone())
# sample voltage electrolyzer values
print("voltage els", cur.execute("SELECT DISTINCT electrolyzer FROM voltage_readings ORDER BY electrolyzer LIMIT 40").fetchall())
