#!/usr/bin/env bash
# After git pull: merge laptop plant seed (shutdowns, elements, electrodes, …)
# into the Docker volume. Does NOT wipe voltage_readings or users.
#   bash deploy/restore-plant-seed.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SEED="docs/plant-data/pvc_arvand_plant_seed.db"
if [[ ! -f "$SEED" ]]; then
  echo "Missing $SEED — pull latest main from GitHub." >&2
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx 'pvc-arvand'; then
  echo "Container pvc-arvand is not running. Start with: docker compose up -d" >&2
  exit 1
fi

echo "Copying plant seed into container..."
docker compose cp "$SEED" pvc-arvand:/tmp/pvc_arvand_plant_seed.db

echo "Merging seed into live /data/pvc_arvand.db ..."
docker compose exec -T pvc-arvand python - <<'PY'
from pathlib import Path
import shutil
import sqlite3
from datetime import datetime

seed = Path("/tmp/pvc_arvand_plant_seed.db")
dest = Path("/data/pvc_arvand.db")
keep = {
    "users", "form_permissions", "app_roles", "role_permissions",
    "backup_settings", "voltage_sync_settings", "alert_rules", "sqlite_sequence",
}
protect = {"voltage_readings", "alert_events", "audit_logs"}

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup = Path(f"/data/backups/pre_plant_seed_{stamp}.db")
backup.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(dest, backup)
print(f"backup {backup}")

live = sqlite3.connect(dest)
live.execute("PRAGMA foreign_keys=OFF")
live.execute("ATTACH DATABASE ? AS seed", (str(seed),))
seed_tables = {r[0] for r in live.execute(
    "SELECT name FROM seed.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
)}
live_tables = {r[0] for r in live.execute(
    "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
)}
n = 0
for table in sorted(seed_tables):
    if table in keep or table in protect:
        continue
    if table not in live_tables:
        schema = live.execute(
            "SELECT sql FROM seed.sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        if schema and schema[0]:
            live.execute(schema[0])
        else:
            continue
    live.execute(f"DELETE FROM main.[{table}]")
    live.execute(f"INSERT INTO main.[{table}] SELECT * FROM seed.[{table}]")
    n += 1
live.commit()
live.execute("DETACH DATABASE seed")
live.execute("PRAGMA foreign_keys=ON")
live.close()
print(f"restored {n} tables")
# show shutdown count
c = sqlite3.connect(dest)
print("shutdowns", c.execute("select count(*) from shutdowns").fetchone()[0])
c.close()
PY

docker compose restart pvc-arvand
echo
echo "Done. Shutdown list and plant master data now match the laptop seed."
echo "Voltage readings on the server were kept (not in git — too large)."
echo "For a full laptop DB including voltages, copy backend/instance/pvc_arvand.db via scp — see docs/DEPLOY.md."
