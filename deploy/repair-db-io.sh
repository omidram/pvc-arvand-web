#!/usr/bin/env bash
# The site answers "disk I/O error" when the Docker disk is full or SQLite
# was restarted in the middle of a write. This stops the API, frees the extra
# database copies inside the volume, and opens the plant file again.
# Plant rows are not deleted. A broken journal is only set aside when the
# file will not open at all.
#
#   bash deploy/repair-db-io.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cid="$(docker ps -aq --filter name='^pvc-arvand$' | head -n 1 || true)"
if [[ -z "$cid" ]]; then
  echo "Container pvc-arvand was not found." >&2
  exit 1
fi

echo "Stopping pvc-arvand ..."
docker compose stop pvc-arvand
image="$(docker inspect -f '{{.Config.Image}}' "$cid")"

set +e
docker run --rm -i --volumes-from "$cid" --entrypoint python "$image" - <<'PY'
from pathlib import Path
import shutil
import sqlite3

live = Path("/data/pvc_arvand.db")
backups = Path("/data/backups")

def free_mb() -> int:
    return shutil.disk_usage("/data").free // (1024 * 1024)

def opens(path: Path) -> bool:
    if not path.is_file():
        print(f"missing {path}")
        return False
    try:
        con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=20)
        try:
            users = con.execute("SELECT count(*) FROM users").fetchone()[0]
        finally:
            con.close()
    except Exception as exc:
        print(f"unreadable {path}: {exc}")
        return False
    print(f"readable {path} users={users}")
    return True

print(f"free_mb={free_mb()}")
if backups.is_dir() and free_mb() < 300:
    copies = sorted(backups.glob("pre_update_*.db"), key=lambda p: p.stat().st_mtime)
    for item in copies[:-1]:
        print(f"removing old in-volume snapshot {item} ({item.stat().st_size} bytes)")
        item.unlink()
    print(f"free_mb={free_mb()}")

if not live.is_file():
    raise SystemExit("no live database at /data/pvc_arvand.db")
if opens(live):
    raise SystemExit(0)

for suffix in ("-journal", "-wal", "-shm"):
    side = Path(str(live) + suffix)
    if not side.is_file():
        continue
    aside = Path(str(side) + ".aside")
    if aside.exists():
        aside.unlink()
    print(f"moving {side.name} aside")
    side.replace(aside)
    if opens(live):
        raise SystemExit(0)

candidates = []
if backups.is_dir():
    candidates.extend(backups.glob("pre_update_*.db"))
    candidates.extend(backups.glob("pvc_arvand_backup_*.db"))
candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
restored = False
for cand in candidates:
    if not opens(cand):
        continue
    broken = live.with_name(live.name + ".broken-io")
    print(f"restoring {cand}")
    if broken.exists():
        broken.unlink()
    live.replace(broken)
    cand.replace(live)
    restored = opens(live)
    break

if not restored:
    raise SystemExit(2)
# The replaced file is the one that would not open. Drop it so the disk can breathe.
broken = live.with_name(live.name + ".broken-io")
if broken.exists() and opens(live):
    print(f"removing unreadable copy {broken}")
    broken.unlink()
print(f"free_mb={free_mb()}")
PY
status=$?
set -e

echo "Starting pvc-arvand ..."
docker start "$cid" >/dev/null
if [[ "$status" -ne 0 ]]; then
  echo "Database is still unreadable. Do not run deploy/update.sh again." >&2
  exit "$status"
fi
echo "Database opens. Reload the site. Then run: bash deploy/update.sh"
