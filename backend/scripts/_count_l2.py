import json
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
conn = sqlite3.connect(DB)
data = {
    "elements": conn.execute("select count(*) from elements").fetchone()[0],
    "norms": conn.execute("select count(*) from electrolyzer_normalizations").fetchone()[0],
    "readings": conn.execute("select count(*) from voltage_readings").fetchone()[0],
}
conn.close()

print("elements", data["elements"])
print("norms", data["norms"])
print("readings", data["readings"])

Path(__file__).resolve().parents[1].joinpath("instance", "_check_counts.json").write_text(
    json.dumps(data), encoding="utf-8"
)
