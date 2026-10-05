#!/usr/bin/env bash
# Pull the latest GitHub main and rebuild. Database volume is kept.
#   bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "This folder is not a git checkout. Clone the repo first." >&2
  exit 1
fi

BACKUP_DIR="${PVC_UPDATE_BACKUP_DIR:-$ROOT/deploy/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
SNAPSHOT="/data/backups/pre_update_${STAMP}.db"

if docker compose ps --status running --services 2>/dev/null | grep -qx 'pvc-arvand'; then
  echo "Creating pre-update DB snapshot ..."
  if docker compose exec -T pvc-arvand python - <<PY
from pathlib import Path
import shutil
src = Path("/data/pvc_arvand.db")
dst = Path("${SNAPSHOT}")
dst.parent.mkdir(parents=True, exist_ok=True)
if src.is_file() and src.stat().st_size > 0:
    shutil.copy2(src, dst)
    print(f"wrote {dst}")
else:
    print("no live database to snapshot")
PY
  then
    docker compose cp "pvc-arvand:${SNAPSHOT}" "$BACKUP_DIR/" 2>/dev/null \
      && echo "Host copy: $BACKUP_DIR/pre_update_${STAMP}.db" \
      || echo "Snapshot kept inside container volume only."
  else
    echo "Warning: could not snapshot DB before update."
  fi
fi

git fetch origin
git pull --ff-only origin main

# Rebuild image only — never use `docker compose down -v` (wipes plant data).
docker compose up -d --build
docker compose ps
echo
echo "Update finished. Named volume pvc_arvand_data was preserved."
echo "Never run: docker compose down -v"
