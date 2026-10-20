import sqlite3

con = sqlite3.connect(r"C:\Users\Omid\Downloads\pvc_arvand_web\backend\instance\pvc_arvand.db")
cur = con.cursor()
tabs = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print([t for t in tabs if "set" in t.lower() or "plant" in t.lower()])
for t in tabs:
    if "setting" in t.lower() or t in ("plant_settings", "app_settings"):
        cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})")]
        print("TABLE", t, cols)
        print(cur.execute(f"SELECT * FROM {t} LIMIT 5").fetchall())
# electrolyzer names sample
for t in tabs:
    if "electrolyzer" in t.lower() and not t.startswith("acc_"):
        cols = [r[1] for r in cur.execute(f"PRAGMA table_info({t})")]
        print("EL", t, cols)
        try:
            print(cur.execute(f"SELECT name FROM {t} LIMIT 30").fetchall())
        except Exception as e:
            print(e)
