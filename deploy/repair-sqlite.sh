#!/usr/bin/env bash
# Repair a live SQLite file that fails startup with:
#   malformed database schema (K1)
#
#   bash deploy/repair-sqlite.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${1:-$ROOT/backend/instance/pvc_arvand.db}"
BACKUPS="$(dirname "$DB")/backups"

if [[ ! -f "$DB" ]]; then
  echo "Database not found: $DB" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "Installing sqlite3 (needed to drop the broken K1 schema object) ..."
  sudo apt-get update -y
  sudo apt-get install -y sqlite3
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
cp -a "$DB" "${DB}.before-repair-${STAMP}"
echo "Copy of live DB: ${DB}.before-repair-${STAMP}"

# Access leftover object named K1 makes SQLite refuse to parse sqlite_master.
sqlite3 "$DB" <<'SQL'
PRAGMA writable_schema=ON;
DELETE FROM sqlite_master WHERE name='K1';
PRAGMA writable_schema=OFF;
SQL

if sqlite3 "$DB" "SELECT name FROM sqlite_master LIMIT 1;" >/dev/null 2>&1; then
  echo "Database opens after dropping K1. Restart the API."
  exit 0
fi

echo "Still unreadable. Trying sqlite3 .recover ..."
RECOVERED="${DB}.recovered-${STAMP}"
if sqlite3 "$DB" ".recover" | sqlite3 "$RECOVERED" && sqlite3 "$RECOVERED" "SELECT count(*) FROM sqlite_master WHERE type='table';" >/dev/null 2>&1; then
  mv -f "$RECOVERED" "$DB"
  echo "Replaced live DB with recovered file. Restart the API."
  exit 0
fi
rm -f "$RECOVERED"

LATEST="$(ls -1t "$BACKUPS"/pvc_arvand_backup_*.db 2>/dev/null | head -n 1 || true)"
if [[ -z "$LATEST" ]]; then
  echo "No pvc_arvand_backup_*.db in $BACKUPS" >&2
  echo "Restore a known-good copy over $DB and restart." >&2
  exit 1
fi

echo "Restoring backup: $LATEST"
cp -a "$LATEST" "$DB"
sqlite3 "$DB" <<'SQL'
PRAGMA writable_schema=ON;
DELETE FROM sqlite_master WHERE name='K1';
PRAGMA writable_schema=OFF;
SQL
echo "Restored $LATEST over $DB (K1 dropped if present). Restart the API."
