import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ucv_dataset as DS

data = DS.build()
S = DS.SCENARIOS["default"]
IREF, TK, CK = 6.0, 0.02, 0.04
rows = []
for s in data["slots"]:
    if None in (s["I"], s["Cc"], s["tAn"], s["tKa"]):
        continue
    if s["date"].isoformat() != "2016-06-01":
        continue
    i = s["I"] / 2.72
    tm = (s["tAn"] + s["tKa"]) / 2
    for r in s["readings"]:
        if r["ui"] <= 0.2:
            continue
        un = 2.42 + (IREF / i) * (r["ui"] - 2.42) - (90 - tm) * TK + (32 - s["Cc"]) * CK
        grp = DS.group_of(r["pos"])
        rows.append((grp, s["acc_el"], s["time"], r["pos"], r["ui"], i, un))
g1 = [r for r in rows if r[0] == 1]
print("group1 readings", len(g1), "avg un", sum(r[6] for r in g1) / len(g1), "avg i", sum(r[5] for r in g1) / len(g1))
# distinct on (un,i)
d = {}
for r in g1:
    d[(round(r[6], 9), round(r[5], 9))] = r
print("distinct", len(d), "avg un", sum(k[0] for k in d) / len(d), "avg i", sum(k[1] for k in d) / len(d))
# per electrolyzer
for el in ("1A", "1B", "2A"):
    sub = [r for r in g1 if r[1] == el]
    print(el, len(sub), sum(r[6] for r in sub) / max(1, len(sub)))
for s in data["slots"]:
    if s["date"].isoformat() == "2016-06-01":
        print(s["acc_el"], s["time"], s["I"], s["Cc"], s["tAn"], s["tKa"], s["nr"])
