#!/usr/bin/env bash
# Pull GitHub main and restart. Never delete or replace plant SQLite with an empty file.
#   bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .git ]]; then
  echo "This folder is not a git checkout. Clone the repo first." >&2
  exit 1
fi

command -v sqlite3 >/dev/null 2>&1 || sudo apt-get install -y sqlite3 || true

STAMP="$(date +%Y%m%d_%H%M%S)"
INSTANCE="$ROOT/backend/instance"
DB="$INSTANCE/pvc_arvand.db"
BACKUP_DIR="$INSTANCE/backups"
mkdir -p "$BACKUP_DIR"
SNAPSHOT="$BACKUP_DIR/pre_update_${STAMP}.db"

if [[ -f "$DB" ]]; then
  echo "Snapshot live DB → $SNAPSHOT"
  cp -a "$DB" "$SNAPSHOT"
  if sqlite3 "$SNAPSHOT" "SELECT count(*) FROM sqlite_master WHERE type='table';" >/dev/null 2>&1; then
    echo "Snapshot opens."
  else
    echo "Warning: live file already unreadable; snapshot kept anyway. Startup will try older backups."
  fi
fi

# Never let git track or overwrite the plant database on this machine.
mkdir -p "$ROOT/.git/info"
grep -qxF 'backend/instance/' "$ROOT/.git/info/exclude" 2>/dev/null || echo 'backend/instance/' >> "$ROOT/.git/info/exclude"

git fetch origin
git pull --ff-only origin main

SEED="$ROOT/docs/plant-data/pvc_arvand_plant_seed.db"
APPLY="$ROOT/deploy/apply_shutdown_tables.py"

load_shutdown_host() {
  if [[ -f "$DB" && -f "$SEED" ]]; then
    echo "Loading committed shutdown tables into $DB ..."
    python3 "$APPLY" "$DB" "$SEED" || "$ROOT/backend/venv/bin/python" "$APPLY" "$DB" "$SEED"
  fi
}

load_shutdown_docker() {
  local seed_in="/tmp/pvc_arvand_plant_seed.db"
  if [[ -f "$SEED" ]]; then
    echo "Copying shutdown seed into the container ..."
    docker compose cp "$SEED" "pvc-arvand:${seed_in}"
  else
    seed_in="/app/seed/pvc_arvand.db"
  fi
  echo "Loading committed shutdown tables into /data/pvc_arvand.db ..."
  docker compose exec -T pvc-arvand python -c "from app.shutdown_seed import apply_shutdown_tables; apply_shutdown_tables('/data/pvc_arvand.db', '${seed_in}')"
}

restore_snapshot() {
  if [[ -f "$SNAPSHOT" ]] && sqlite3 "$SNAPSHOT" "SELECT count(*) FROM sqlite_master WHERE type='table';" >/dev/null 2>&1; then
    echo "Update failed — restoring $SNAPSHOT"
    cp -a "$SNAPSHOT" "$DB"
    rm -f "${DB}-wal" "${DB}-shm"
    return 0
  fi
  return 1
}

health_ok() {
  local port="${APP_PUBLISH_PORT:-8080}"
  curl -fsS --max-time 8 "http://127.0.0.1:${port}/health" >/dev/null 2>&1
}

if docker compose ps --status running --services 2>/dev/null | grep -qx 'pvc-arvand'; then
  SNAPSHOT_IN="/data/backups/pre_update_${STAMP}.db"
  echo "Creating pre-update DB snapshot inside Docker ..."
  docker compose exec -T pvc-arvand python - <<PY || echo "Warning: could not snapshot DB before update."
from pathlib import Path
import shutil
src = Path("/data/pvc_arvand.db")
dst = Path("${SNAPSHOT_IN}")
dst.parent.mkdir(parents=True, exist_ok=True)
if src.is_file() and src.stat().st_size > 0:
    shutil.copy2(src, dst)
    print(f"wrote {dst}")
else:
    print("no live database to snapshot")
PY
  docker compose cp "pvc-arvand:${SNAPSHOT_IN}" "$BACKUP_DIR/" 2>/dev/null \
    && echo "Host copy: $BACKUP_DIR/pre_update_${STAMP}.db" \
    || echo "Snapshot kept inside container volume only."
  docker compose up -d --build
  load_shutdown_docker
  docker compose restart pvc-arvand
  docker compose ps
  echo "Update finished. Shutdown tables were loaded from docs/plant-data into the server database."
  echo "Never run: docker compose down -v"
  exit 0
fi

if [[ -x "$ROOT/backend/venv/bin/pip" ]]; then
  load_shutdown_host
  rm -f "${DB}-wal" "${DB}-shm"
  echo "Updating Python venv ..."
  "$ROOT/backend/venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  if [[ -d "$ROOT/frontend" && -f "$ROOT/frontend/package.json" ]]; then
    if command -v npm >/dev/null 2>&1; then
      (cd "$ROOT/frontend" && npm install --silent && npm run build) || echo "Frontend build skipped/failed; static files unchanged."
    fi
  fi
  if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^pvc-arvand'; then
    sudo systemctl restart pvc-arvand || sudo systemctl restart pvc-arvand.service || true
  elif systemctl list-unit-files --type=service 2>/dev/null | grep -q '^pvc-arvand-web'; then
    sudo systemctl restart pvc-arvand-web || true
  else
    echo "Restart the API process (uvicorn) now, then this script will health-check."
  fi
  sleep 3
  if health_ok; then
    echo "Update finished. Shutdown tables were replaced from the committed seed."
    exit 0
  fi
  echo "Health check failed after restart."
  restore_snapshot || true
  echo "If the API is still down, start it, then: bash deploy/repair-sqlite.sh"
  exit 1
fi

echo "No backend/venv and no running Docker service. Code was pulled; start the API yourself."
echo "Never run: git clean on backend/instance  (that deletes the plant database)"
