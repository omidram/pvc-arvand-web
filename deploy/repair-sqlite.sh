#!/usr/bin/env bash
# Restore a readable SQLite file. Do not edit the live file in place (that can
# turn "bad schema" into "disk image is malformed").
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

command -v sqlite3 >/dev/null 2>&1 || sudo apt-get install -y sqlite3

opens() {
  sqlite3 "$1" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" >/dev/null 2>&1
}

if opens "$DB"; then
  echo "Live database already opens. Nothing to repair."
  exit 0
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
cp -a "$DB" "${DB}.broken-${STAMP}"
rm -f "${DB}-wal" "${DB}-shm"
echo "Live file is unreadable. Copy saved at ${DB}.broken-${STAMP}"

pick=""
for f in $(ls -1t "$BACKUPS"/pvc_arvand_backup_*.db "$BACKUPS"/pre_update_*.db "${DB}".malformed-* "${DB}".before-* "${DB}".broken-* 2>/dev/null || true); do
  [[ -f "$f" ]] || continue
  if opens "$f"; then
    pick="$f"
    break
  fi
  echo "Skipping unreadable $f"
done

if [[ -z "$pick" ]]; then
  echo "No readable backup found in $BACKUPS" >&2
  exit 1
fi

cp -a "$pick" "$DB"
rm -f "${DB}-wal" "${DB}-shm"
if opens "$DB"; then
  echo "Restored $pick over $DB. Restart the API."
  exit 0
fi
echo "Copy of $pick still unreadable." >&2
exit 1
